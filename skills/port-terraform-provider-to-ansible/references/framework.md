# The shared framework (proven templates)

Three small files carry the whole collection. Ours totaled 318 lines for a
131-module collection. Adapt the marked points; keep the rest.

## 1. `plugins/module_utils/<service>_api.py` — the API client

Port of the provider's Go client. Adapt: auth grants (read the provider's
`login()`), base path (`/admin` here), and error-body extraction.

```python
from __future__ import annotations
import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from ansible.module_utils.urls import open_url

AUTH_ARG_SPEC = dict(
    auth_url=dict(type='str', required=True, aliases=['url']),
    auth_client_id=dict(type='str', default='admin-cli'),      # ADAPT
    auth_client_secret=dict(type='str', no_log=True),
    auth_username=dict(type='str', aliases=['username']),
    auth_password=dict(type='str', aliases=['password'], no_log=True),
    validate_certs=dict(type='bool', default=True),
    connection_timeout=dict(type='int', default=10),
)

def quoted(part):
    return quote(str(part), safe='')

class ApiError(Exception):
    def __init__(self, msg, status=None, body=None):
        super().__init__(msg)
        self.status = status
        self.body = body

class ServiceAPI(object):
    def __init__(self, module):
        self.module = module
        p = module.params
        self.base_url = p['auth_url'].rstrip('/')
        self.validate_certs = p.get('validate_certs', True)
        self.timeout = p.get('connection_timeout', 10)
        self._token = None
        self._login()

    def _login(self):
        # ADAPT: port the provider's login() — password grant vs
        # client_credentials vs API key header. Keycloak shape shown:
        p = self.module.params
        form = {'client_id': p.get('auth_client_id')}
        if p.get('auth_username'):
            form.update(grant_type='password', username=p['auth_username'],
                        password=p.get('auth_password') or '')
        elif p.get('auth_client_secret'):
            form.update(grant_type='client_credentials',
                        client_secret=p['auth_client_secret'])
        else:
            raise ApiError('credentials required')
        resp = open_url(self.base_url + '/token-endpoint',  # ADAPT
                        method='POST', data=urlencode(form),
                        headers={'Content-Type': 'application/x-www-form-urlencoded'},
                        validate_certs=self.validate_certs, timeout=self.timeout)
        self._token = json.loads(resp.read())['access_token']

    def request(self, method, path, payload=None, params=None, _retried=False):
        url = self.base_url + path
        if params:
            url += '?' + urlencode(params)
        headers = {'Authorization': 'Bearer %s' % self._token,
                   'Accept': 'application/json'}
        data = None
        if payload is not None:
            data = json.dumps(payload)
            headers['Content-Type'] = 'application/json'
        try:
            resp = open_url(url, method=method, data=data, headers=headers,
                            validate_certs=self.validate_certs, timeout=self.timeout)
            body = resp.read()
            return (json.loads(body) if body else None), resp.headers.get('Location')
        except HTTPError as e:
            if e.code == 401 and not _retried:
                self._login()   # token expired mid-run: providers re-login + retry once
                return self.request(method, path, payload, params, _retried=True)
            raise ApiError('%s %s returned HTTP %d' % (method, url, e.code), status=e.code)
        except (URLError, OSError) as e:
            raise ApiError('%s %s failed: %s' % (method, url, e))

    def get(self, path, params=None):
        try:
            body, _ = self.request('GET', path, params=params)
            return body
        except ApiError as e:
            if e.status == 404:
                return None
            raise

    def post(self, path, payload=None):
        body, location = self.request('POST', path, payload=payload)
        return body, (location.rstrip('/').rsplit('/', 1)[-1] if location else None)

    def put(self, path, payload=None):
        return self.request('PUT', path, payload=payload)[0]

    def delete(self, path, payload=None):
        return self.request('DELETE', path, payload=payload)[0]
```

Why these details matter:
- `open_url`, never `requests` — collections must not add pip deps.
- 401 → re-login → retry ONCE: long playbooks outlive tokens; the provider
  does exactly this.
- `get()` returns None on 404 — the engine's read() convention.
- Location-header id capture: many create endpoints return no body.
- If any endpoint speaks non-JSON (XML installation docs, verbatim POST
  bodies), add a raw-body helper here rather than letting modules bypass the
  client with their own open_url calls.

## 2. `plugins/module_utils/resource.py` — the present/absent engine

Handles check_mode and --diff once for every module. Hooks per module:
`read() → rep|None`, `desired() → {api_field: value} (declared params only)`,
`create(desired)`, `update(existing, changes, merged)`, `delete(existing)`,
optional `sanitize(rep)` and `SET_FIELDS`.

```python
from __future__ import annotations
import json
from ansible.module_utils.basic import AnsibleModule
# import AUTH_ARG_SPEC, ServiceAPI, ApiError from the api module (FQ collection path)

def kc_argument_spec(**fields):
    spec = dict(AUTH_ARG_SPEC)
    spec['state'] = dict(type='str', default='present', choices=['present', 'absent'])
    spec.update(fields)
    return spec

def camel(name):
    parts = name.split('_')
    return parts[0] + ''.join(p.capitalize() for p in parts[1:])

def params_to_api(params, fields, overrides=None):
    overrides = overrides or {}
    return dict((overrides.get(f, camel(f)), params[f])
                for f in fields if params.get(f) is not None)

def coerce_attributes(attrs):
    """For map[string][]string attribute maps; accept scalars too."""
    return dict((k, [str(x) for x in v] if isinstance(v, list) else [str(v)])
                for k, v in (attrs or {}).items())

def _norm(value, as_set=False):
    if as_set and isinstance(value, list):
        return sorted(json.dumps(v, sort_keys=True) for v in value)
    return json.dumps(value, sort_keys=True)

class ResourceModule(object):
    argument_spec = {}
    SET_FIELDS = ()

    def __init__(self):
        self.module = AnsibleModule(argument_spec=kc_argument_spec(**self.argument_spec),
                                    supports_check_mode=True, **self.module_kwargs())
        self.params = self.module.params
        try:
            self.api = ServiceAPI(self.module)
        except ApiError as e:
            self.module.fail_json(msg=str(e))

    def module_kwargs(self):
        return {}

    def sanitize(self, rep):
        return rep

    def changed_fields(self, existing, desired):
        return [k for k, want in desired.items()
                if _norm(existing.get(k), k in self.SET_FIELDS)
                != _norm(want, k in self.SET_FIELDS)]

    def execute(self):
        try:
            self._run()
        except ApiError as e:
            self.module.fail_json(msg=str(e))

    def _run(self):
        state = self.params['state']
        existing = self.read()
        result = dict(changed=False, end_state=None)
        if state == 'absent':
            if existing is not None:
                result['changed'] = True
                result['diff'] = dict(before=self.sanitize(existing), after=None)
                if not self.module.check_mode:
                    self.delete(existing)
            self.module.exit_json(**result)
        desired = self.desired()
        if existing is None:
            result['changed'] = True
            result['diff'] = dict(before=None, after=self.sanitize(desired))
            if self.module.check_mode:
                result['end_state'] = self.sanitize(desired)
            else:
                self.create(desired)
                result['end_state'] = self.sanitize(self.read() or desired)
        else:
            changes = self.changed_fields(existing, desired)
            if changes:
                merged = dict(existing)
                merged.update(desired)
                result['changed'] = True
                result['diff'] = dict(
                    before=dict((k, existing.get(k)) for k in changes),
                    after=dict((k, desired[k]) for k in changes))
                if self.module.check_mode:
                    result['end_state'] = self.sanitize(merged)
                else:
                    self.update(existing, changes, merged)
                    result['end_state'] = self.sanitize(self.read() or merged)
            else:
                result['end_state'] = self.sanitize(existing)
        self.module.exit_json(**result)
```

Design decisions that earn their keep:
- **Declared-fields-only comparison** (`desired()` includes only non-None
  params): omitted options stay unmanaged, and server-added fields never cause
  drift. This diverges from Terraform (which manages everything in state) —
  document it in each module.
- **Update sends existing-merged-with-desired**, so a partial update never
  strips server-side fields.
- Synthetic keys (prefix `_`, e.g. `_composite_ids`) let modules diff
  sub-resources through the same engine, then strip them before the PUT.

## 3. Module skeleton (what every fan-out agent copies)

DOCUMENTATION with every provider schema field as a snake_case option +
doc fragment for auth; EXAMPLES; RETURN documenting `end_state`. Class with
`argument_spec`, the five hooks, `main()` calling `.execute()`.

Info modules (data sources) are simpler: plain AnsibleModule +
`supports_check_mode=True`, always `changed=False`, return the rep under a
sensible key, miss semantics ported per data source.
