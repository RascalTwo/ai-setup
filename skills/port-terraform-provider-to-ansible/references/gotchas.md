# Gotchas harvest (from the Keycloak port — most generalize to any REST-managed service)

Each of these cost real debugging time or would have shipped as a bug. Put the
relevant ones into family-agent prompts as "family notes".

## Auth / lifecycle

- **Token-minted-before-container trap**: a service-account token issued
  before a container object (realm/org/project) exists lacks that object's
  management roles — post-create reads come back stripped and even DELETE
  403s. The provider re-logins after creating such containers
  (`client.Refresh()`); the module's `create()` must re-login too. Invisible
  in idempotency tests (each module invocation logs in fresh) — it corrupts
  only the create-run's `end_state`.
- **401 mid-playbook**: long runs outlive tokens; re-login-once-and-retry in
  the API client, or long fan-out test suites fail randomly.

## Comparison / idempotency

- **Quoted booleans**: component-style configs store booleans as the strings
  `"true"`/`"false"`. Python's `str(True)` is `"True"` → permanent flapping
  until explicitly mapped.
- **Order-nonpreserving multivalued config**: servers may not preserve element
  order for multi-valued config values — compare order-insensitively
  (SET_FIELDS) or flap forever.
- **Masked secrets**: servers echo `**********` for stored secrets → a
  secret-only change is undetectable. The provider has the same limitation
  (DiffSuppress); keep secrets out of `desired()` comparison, inject at write.
- **Server-added fields**: reads return fields you never sent. Compare
  declared fields only, and send existing-merged-with-desired on update.
- **str(True) cousin — attribute maps**: `map[string][]string` attribute maps
  accept scalars in YAML; coerce scalar → `[str(x)]` before compare.

## Resource-model surprises

- **Whole-document resources**: some "resources" have no per-item endpoint —
  they're one document keyed by name inside a list (e.g. client policies).
  Every create/update/delete is read-modify-write of the whole document;
  "ForceNew: name" really means "name is the identity, rename impossible".
  Watch for asymmetric PUT payloads (one document PUT must round-trip a
  sibling collection, another must not).
- **Singletons where absent = reset-to-zero**: events config, user profile —
  can't be deleted; the provider resets to zero values. Beware: a fresh
  container's default state may NOT equal the zero value, so the first
  `absent` on an untouched container legitimately reports changed.
- **Exhaustive-set semantics**: attach-one-scope endpoints often manage the
  WHOLE set — omitting the built-ins silently detaches them. Port the
  provider's exhaustive semantics and make tests declare the full set.
- **Legacy alias registrations**: providers register deprecated alias names
  pointing at the same resource func (check the provider.go resource map).
  Ansible answer: `plugin_routing` module redirects in meta/runtime.yml, not
  duplicate modules.
- **Create-path variants**: the same object may have different create
  endpoints by context (top-level vs child vs organization-scoped) while
  update/delete stay uniform.

## Data sources

- **Miss semantics vary per data source**: some swallow 404 into empty state,
  some hard-error with specific messages, some error on ambiguity with an
  id-listing message. Port each from its Go read path.
- **Declaration artifacts**: DS schemas often mirror the resource schema, so
  fields show as `optional` that the read path never touches (verify against
  `d.Get(...)` calls). Don't add fake options for them; record them in the
  audit's artifact list with the Go line as evidence.
- **Raw-body endpoints**: installation documents (XML), converters (verbatim
  POST, no Content-Type in the provider — sniff or set explicitly). Give the
  API client a raw helper instead of letting modules hand-roll open_url.

## Ansible-specific

- **`no_log` heuristics**: option names containing `password`/`secret`
  (e.g. `reset_password_allowed`, `password_policy`) trip Ansible's warning —
  set `no_log=False` explicitly on the non-secret ones.
- **Jinja collision on `keys`**: a return key named `keys` collides with
  dict.keys() — playbooks need `result['keys']` bracket access; prefer a
  different key name.
- **Doc/spec drift**: run `ansible-doc` per module and eventually
  `ansible-test sanity` — DOCUMENTATION and argument_spec are separate and
  drift silently (the parity audit unions both, which hides drift between them).

## Process

- **Effort ledger is the product** (when the port measures a cost): record
  wall-clock per phase, agent/token counts, LOC, and the quirks — plus the
  honest caveats: AI-minutes ≠ human-months; porting a mature provider is easy
  mode (the quirks were pre-discovered); ownership (CI, releases, API drift)
  is the recurring cost the build does nothing to reduce.
- **Licensing**: the port is a derivative — carry the provider's license and
  a NOTICE crediting it.
