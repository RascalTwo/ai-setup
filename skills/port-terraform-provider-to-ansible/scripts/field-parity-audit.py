#!/usr/bin/env python3
"""Field-parity audit: diff the provider's schema against every module's options.

Preferred mode (exact, covers composed schemas):
    terraform providers schema -json > schema.json   # in a dir with the provider required
    field-parity-audit.py --schema-json schema.json

Fallback mode (static Go parse; composed schemas flagged NEEDS-MANUAL):
    field-parity-audit.py --provider-src /path/to/terraform-provider-keycloak

The schema-json mode audits data sources too (module <name>_info). Computed-only
fields are outputs (module end_state), not options, and are excluded.
"""
import argparse
import ast
import json
import re
import sys
from pathlib import Path

EQUIV = {'realm_id': 'realm'}
# provider fields with no Ansible meaning (TF plan/state mechanics)
IGNORE_GO = {'import', 'client_secret_wo', 'client_secret_wo_version',
             'client_secret_regenerate_when_changed'}
SUSPICIOUS_EXTRACTION = 1


def norm(fields):
    return {EQUIV.get(f, f) for f in fields}


def py_option_fields(path):
    """argument_spec keys via AST, unioned with DOCUMENTATION options keys."""
    src = path.read_text()
    tree = ast.parse(src)
    keys = set()
    doc = re.search(r"DOCUMENTATION = r?'''(.*?)'''", src, re.S)
    if doc:
        opts = re.search(r'\noptions:\n(.*?)(?=\nextends_documentation_fragment:|\nauthor:|\nrequirements:|$)',
                         doc.group(1), re.S)
        if opts:
            keys |= set(re.findall(r'^  (\w+):', opts.group(1), re.M))

    def dict_keys(node):
        out = set()
        if isinstance(node, ast.Call) and getattr(node.func, 'id', '') == 'dict':
            out |= {kw.arg for kw in node.keywords if kw.arg}
        if isinstance(node, ast.Dict):
            out |= {k.value for k in node.keys if isinstance(k, ast.Constant)}
        return out

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            targets = [getattr(t, 'id', getattr(t, 'attr', '')) for t in node.targets]
            if any(t == 'argument_spec' for t in targets):
                keys |= dict_keys(node.value)
        if isinstance(node, ast.Call) and getattr(node.func, 'attr', '') == 'update':
            if getattr(node.func.value, 'id', '') in ('spec', 'argument_spec'):
                keys |= {kw.arg for kw in node.keywords if kw.arg}
    return keys


# data-source schema fields declared optional but never read in the DS read
# path (verified against the Go source) — declaration artifacts, not inputs
DS_ARTIFACTS = {
    'keycloak_group': {'description'},
    # DS read path fetches by realm_id+client_id only (data_source_keycloak_openid_client.go:274)
    'keycloak_openid_client': {'always_display_in_console', 'consent_screen_text',
                               'display_on_consent_screen', 'oauth2_device_authorization_grant_enabled',
                               'oauth2_device_code_lifespan', 'oauth2_device_polling_interval',
                               'oauth2_jwt_authorization_grant_enabled', 'oauth2_jwt_authorization_grant_idp'},
    'keycloak_realm': {'display_name_html', 'attributes',
                       'default_default_client_scopes', 'default_optional_client_scopes'},
    'keycloak_openid_client_scope': {'extra_config'},
    'keycloak_saml_client_scope': {'extra_config'},
}


def schema_json_inputs(block, data_source=False):
    """Input fields of one resource/data-source schema block from
    `terraform providers schema -json` (attributes + nested block_types).
    In data sources, optional+computed attributes are output mirrors of the
    resource schema, not lookup inputs."""
    fields = set()
    for name, attr in (block.get('attributes') or {}).items():
        if attr.get('required'):
            fields.add(name)
        elif attr.get('optional') and not (data_source and attr.get('computed')):
            fields.add(name)
    for name in (block.get('block_types') or {}):
        if not data_source:
            fields.add(name)
    return fields


# Nested blocks the provider enumerates but that the port deliberately keeps as
# freeform passthrough dicts, with rationale (a dynamic-key map, a whole-document
# JSON export, a TF-operation mechanic — nothing a static Ansible argspec can
# faithfully express). Fill in per port, like DS_ARTIFACTS: {tf_name: {block, ...}}.
NESTED_EXCEPTIONS = {}


def _block_input_names(block, data_source):
    """Immediate input field names of a schema block (nested_type or block)."""
    names = set()
    for name, attr in (block.get('attributes') or {}).items():
        if attr.get('required') or (attr.get('optional') and not (data_source and attr.get('computed'))):
            names.add(name)
    for name in (block.get('block_types') or {}):
        if not data_source:
            names.add(name)
    return names


def schema_nested_tree(block, data_source=False):
    """Tree of ONLY the options the provider itself enumerates (has nested_type
    or block_types). Opaque object/map attrs have neither, so a freeform module
    dict for them is correct, not a gap — this enforces 'enumerate only where the
    provider enumerates' mechanically."""
    tree = {}
    for name, attr in (block.get('attributes') or {}).items():
        nt = attr.get('nested_type')
        if not nt:
            continue
        if not (attr.get('required') or (attr.get('optional') and not (data_source and attr.get('computed')))):
            continue
        tree[name] = {'children': _block_input_names(nt, data_source),
                      'sub': schema_nested_tree(nt, data_source)}
    for name, bt in (block.get('block_types') or {}).items():
        if data_source:
            continue
        blk = bt.get('block') or {}
        tree[name] = {'children': _block_input_names(blk, data_source),
                      'sub': schema_nested_tree(blk, data_source)}
    return tree


def _dict_call_keywords(node):
    """{kw_name: value_node} for a dict(...) call or {..} literal, else {}."""
    out = {}
    if isinstance(node, ast.Call) and getattr(node.func, 'id', '') == 'dict':
        for kw in node.keywords:
            if kw.arg:
                out[kw.arg] = kw.value
    elif isinstance(node, ast.Dict):
        for k, v in zip(node.keys, node.values):
            if isinstance(k, ast.Constant):
                out[k.value] = v
    return out


def _py_field_tree(value_node):
    """Suboption names + recursive trees of a field spec via its `options=` kwarg
    (None when the field declares no nested options — i.e. freeform/scalar)."""
    kw = _dict_call_keywords(value_node)
    opts = kw.get('options')
    if opts is None:
        return None
    sub_specs = _dict_call_keywords(opts)
    sub = {}
    for cname, cnode in sub_specs.items():
        t = _py_field_tree(cnode)
        if t is not None:
            sub[cname] = t
    return {'children': set(sub_specs), 'sub': sub}


def py_nested_tree(path):
    """Parse a module's argument_spec into {field: {children, sub}} for fields
    that declare nested `options=` (fields without it are absent = freeform)."""
    tree = {}
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Assign):
            targets = [getattr(t, 'id', getattr(t, 'attr', '')) for t in node.targets]
            if any(t == 'argument_spec' for t in targets):
                for fname, fnode in _dict_call_keywords(node.value).items():
                    t = _py_field_tree(fnode)
                    if t is not None:
                        tree[fname] = t
    return tree


def compare_nested(schema_tree, py_tree, module_name, path=''):
    """Nested gaps: FREEFORM (provider enumerates, module is a passthrough dict)
    or MISSING-SUB (some sub-fields absent). Recurses matched sub-trees."""
    gaps = []
    for opt, snode in schema_tree.items():
        here = '%s.%s' % (path, opt) if path else opt
        pnode = py_tree.get(opt)
        if pnode is None:
            if snode['children']:
                gaps.append((module_name, here, 'FREEFORM', sorted(snode['children'])))
            continue
        missing = sorted(norm(snode['children']) - norm(pnode['children']))
        if missing:
            gaps.append((module_name, here, 'MISSING-SUB', missing))
        gaps.extend(compare_nested(snode['sub'], pnode['sub'], module_name, here))
    return gaps


def load_redirects(modules_dir):
    """plugin_routing module redirects from meta/runtime.yml (alias -> target)."""
    runtime = modules_dir.parent.parent / 'meta' / 'runtime.yml'
    if not runtime.exists():
        return {}
    try:
        import yaml
        doc = yaml.safe_load(runtime.read_text()) or {}
        routes = (doc.get('plugin_routing') or {}).get('modules') or {}
        return dict((alias, spec['redirect'].rsplit('.', 1)[-1])
                    for alias, spec in routes.items() if 'redirect' in spec)
    except Exception:
        return {}


def audit_schema_json(schema_path, modules_dir, prefix, nested=True):
    data = json.load(open(schema_path))
    ps = next(iter(data['provider_schemas'].values()))
    redirects = load_redirects(modules_dir)
    gaps = 0
    checked = 0
    nested_gaps = []

    def check(tf_name, schema, module_name, data_source=False):
        nonlocal gaps, checked
        module_name = redirects.get(module_name, module_name)
        mod = modules_dir / (module_name + '.py')
        if not mod.exists():
            gaps += 1
            print('MISSING-MODULE %s (for %s)' % (module_name, tf_name))
            return
        want = norm(schema_json_inputs(schema['block'], data_source)) - IGNORE_GO - {'id'}
        if data_source:
            want -= DS_ARTIFACTS.get(tf_name, set())
        have = norm(py_option_fields(mod))
        missing = sorted(want - have)
        checked += 1
        if missing:
            gaps += 1
            print('GAP %-55s missing: %s' % (module_name, ', '.join(missing)))
        if nested and not data_source:
            st = schema_nested_tree(schema['block'], data_source)
            for exc in NESTED_EXCEPTIONS.get(tf_name, ()):
                st.pop(exc, None)
            if st:
                nested_gaps.extend(compare_nested(st, py_nested_tree(mod), module_name))

    for tf_name, schema in sorted(ps.get('resource_schemas', {}).items()):
        check(tf_name, schema, tf_name)
    for tf_name, schema in sorted(ps.get('data_source_schemas', {}).items()):
        check(tf_name, schema, tf_name + '_info', data_source=True)
    print('\n--- summary (schema-json mode) ---')
    print('checked: %d   top-level gaps: %d' % (checked, gaps))
    if nested:
        for module_name, dotted, kind, fields in nested_gaps:
            print('NESTED-%-11s %-40s %s' % (kind, module_name + ':' + dotted,
                                             ', '.join(fields)[:90]))
        print('nested gaps: %d (blocks the provider enumerates but the module leaves freeform/partial)'
              % len(nested_gaps))
    return 1 if (gaps or nested_gaps) else 0


# ---------- fallback: static Go parse (composed schemas -> NEEDS-MANUAL) ----------

def go_input_fields(path):
    fields = {}
    in_schema = False
    depth = 0
    current = None
    for line in path.read_text().splitlines():
        if 'map[string]*schema.Schema{' in line and 'Schema:' in line:
            in_schema, depth, current = True, 0, None
            continue
        if not in_schema:
            continue
        m = re.match(r'^\t{3}"([a-z0-9_]+)": \{', line)
        if m and depth == 0:
            current = m.group(1)
            fields[current] = set()
        elif current and depth >= 1:
            for attr in ('Required', 'Optional', 'Computed'):
                if re.search(r'\b%s:\s*true' % attr, line):
                    fields[current].add(attr)
        depth += line.count('{') - line.count('}')
        if depth < 0:
            in_schema = False
    return {f for f, attrs in fields.items()
            if 'Required' in attrs or 'Optional' in attrs or not attrs}


def audit_go_src(provider_root, modules_dir, prefix):
    gaps, manual, clean = [], [], 0
    for go in sorted((provider_root / 'provider').glob('resource_%s_*.go' % prefix)):
        if go.name.endswith('_test.go'):
            continue
        name = go.name[len('resource_'):-len('.go')]
        mod = modules_dir / ('%s.py' % name)
        if not mod.exists():
            print('MISSING-MODULE %s' % name)
            continue
        gf = norm(go_input_fields(go)) - IGNORE_GO
        pf = norm(py_option_fields(mod))
        if len(gf) <= SUSPICIOUS_EXTRACTION:
            manual.append((name, 'only %d Go input fields extracted (composed schema?)' % len(gf)))
            continue
        missing = sorted(gf - pf)
        if missing:
            gaps.append((name, missing))
            print('GAP %-55s missing: %s' % (name, ', '.join(missing)))
        else:
            clean += 1
    print('\n--- summary (go-src mode) ---')
    print('clean: %d   gaps: %d   needs-manual: %d' % (clean, len(gaps), len(manual)))
    for name, why in manual:
        print('NEEDS-MANUAL %-45s %s' % (name, why))
    return 1 if gaps else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--schema-json', type=Path, help='output of `terraform providers schema -json`')
    ap.add_argument('--provider-src', type=Path, help='provider repo checkout (fallback mode)')
    ap.add_argument('--modules-dir', type=Path,
                    default=Path(__file__).resolve().parent.parent / 'plugins' / 'modules')
    ap.add_argument('--prefix', default='keycloak', help='resource name prefix (module names)')
    # positional provider path kept for backward compatibility
    ap.add_argument('legacy_provider', nargs='?', type=Path)
    args = ap.parse_args()
    if args.schema_json:
        return audit_schema_json(args.schema_json, args.modules_dir, args.prefix)
    src = args.provider_src or args.legacy_provider
    if not src:
        ap.error('need --schema-json or --provider-src')
    return audit_go_src(src, args.modules_dir, args.prefix)


if __name__ == '__main__':
    sys.exit(main())
