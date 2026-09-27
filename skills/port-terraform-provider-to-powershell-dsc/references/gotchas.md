# Gotchas that will bite (harvested from a real port)

Each is a runtime fact the Terraform schema does NOT encode — you only find it by reading
the provider Go or running against the live server. This is the evidence that "port, don't
invent" applies to *mechanics* as much as fields.

## Types & fields

- **Duration-string vs integer-second.** The provider exposes session/token/code lifespans
  as duration strings (`"30m"`); the REST API wants **integer seconds** (`1800`). Type these
  `[nullable[int]]`, not `[string]`. A `[string]` field passes a name-audit and 400s live.
- **Discriminator → booleans.** `access_type` (CONFIDENTIAL/PUBLIC/BEARER-ONLY) maps to
  `publicClient`/`bearerOnly`. Put the mapping in `AlwaysBody()` (sent on create+update) and
  override `FieldsMatch()` to compare the derived booleans.
- **Computed-only + TF-only fields don't port.** Exclude `id`, `internal_id`,
  `*deletion_protection`, `import`, write-only `*_wo`/regenerate-trigger attrs. Document each
  non-port. (The bundled audit already excludes these.)
- **Freeform maps need per-key merge + PSCustomObject handling.** `attributes` / `extra_config`
  come back from the server as a rich PSCustomObject with dozens of server-computed sub-keys.
  Assigning that to a `[hashtable]` DscProperty THROWS ("Cannot convert PSCustomObject to
  Hashtable"), and comparing a user's partial map to the server's full one flaps forever.
  Make `Get()` tolerant (`try{}` per field) and manage only user-declared keys (merge), like
  the provider does. Until then, keep such a field settable but out of the drift compare.

## REST mechanics

- **Delete/update by name, not id.** Some resources (realm roles) address instances by name:
  `PUT/DELETE /roles/{name}`, not `/{id}`. The generic engine assumes `/{id}`; give the base a
  `SelfPath($rep)` hook and override it (`/roles/{$this.Name}`) for name-addressed resources.
- **Name→uuid resolution.** Clients and client-scopes endpoints are keyed by UUID, but users
  write names. Protocol mappers that take a raw `ClientScopeId`/`ClientId` path segment 404
  when handed a name. Add `ResolveClientUuid`/`ResolveScopeUuid` to the base (accept name OR
  uuid) and route parent paths through them. One base fix cleared 13 mappers at once.
- **Additive vs exhaustive sets.** Where the provider uses `exhaustive=false` (group→role,
  default-scopes), only add/remove the declared members; don't reset the whole set.

## PowerShell / DSC engine traps

- **Single-element JSON arrays unwrap.** `@(@{...}) | ConvertTo-Json` emits a bare object, not
  a 1-element array — a role-mapping POST then 400s ("Cannot parse the JSON"). In `Api()`,
  detect list bodies and **pipe** them with `-AsArray`: `$Body | ConvertTo-Json -AsArray`
  (positional `ConvertTo-Json $Body -AsArray` double-wraps `[[...]]`).
- **DSC `Get()` must return the class type.** A `[DscResource()]` class whose `Get()` returns
  `[object]` fails validation at module load ("Get method must return [T]"). Return the base
  resource type; build the instance with `[Activator]::CreateInstance($this.GetType())`.
- **`[DscResource()]`/`[DscProperty()]` availability.** Resolve natively in pwsh 7.4+; on older
  pwsh you need the `PSDesiredStateConfiguration` module. In-box Windows PowerShell 5.1 has
  them. For the truly-portable direct-call path you can even drop the attributes and call the
  class methods — the attributes are only needed for `Invoke-DscResource`.
- **Master-realm admin tokens are short-lived.** Re-fetch a token per API call inside the
  module (do not cache) — a long test outlives one token. Test *harness* raw calls that reuse
  one token get 401/403 mid-run; that's the harness, not the module.
- **Single `.psm1` is a serial edit surface.** DSC discovery requires all classes in one
  `.psm1`, but parallel agents editing that one file collide. Agents write per-family scratch
  files; a single orchestrator-run assembly step splices them in.

## Nested `block_types` (config sub-blocks the flat field-audit never counts)

A Terraform resource's nested blocks (`smtp_server`, `otp_policy`, `authorization`,
`federated_identity`, the `*_permissions` scope toggles, …) don't appear in `block.attributes`,
so a 100% flat-field port still leaves them unmodeled. Model each by SHAPE:

- **Scalar-flattened blocks** (otp_policy, webauthn, brute-force) map to top-level rep fields —
  just add them to the resource's `FieldMap`. Free once the engine exists.
- **List blocks** (supportedLocales, webauthn algorithm lists, org `domain`, user
  `federated_identity`, executor/condition arrays) → a `[string[]]`/`[hashtable[]]` property, an
  order-insensitive compare, and a `ListMap()`-style hook.
- **Object blocks** (smtp_server, browserSecurityHeaders, flow_binding_overrides) → a
  `[hashtable]` property serialized to a nested JSON object, compared per-key, MERGED onto the
  server's object so unmanaged keys survive.
- **Separate write-back endpoints.** Some blocks aren't in the parent body: `openid_client`
  `authorization` is a PUT to `.../authz/resource-server` AFTER the client upsert;
  `initial_password` is `.../reset-password` (write-only — never read back, so keep it out of
  drift like a secret); `federated_identity` reads back from `.../federated-identity`, NOT the
  parent list rep. Override `Set()` to push, and read the right endpoint in `FieldsMatch`.
- **Fine-grained `*_permissions` scope toggles** attach policies onto the realm-management
  client's AUTO-CREATED scope permissions: enable the permission (returns a `scopePermissions`
  map of scope→permId), then for each toggle PUT the permission with resolved policy ids. Share
  one `SetScopePerm`/`ScopePermMatches` helper; each class just maps its scope-key set.

## PowerShell array-unwrap when AUTHORING nested arrays

Beyond the `Api()` `-AsArray` fix: a class method that `return @(oneItem)` unwraps to a scalar at
the call site, and assigning that scalar to a PSCustomObject property serializes it as a JSON
**object**, not a 1-element array — Keycloak then 400s "Cannot parse the JSON". Re-wrap at the
USE site: `executors = @($execs)` inside the `[pscustomobject]@{...}` literal (wrapping at the
`$execs = ...` assignment is too late). Also guard whole-array PUTs against `@($null)`: a realm
with no user profiles yields `@($rep.profiles)` = `@($null)`, injecting a null element that
rejects the entire PUT — filter `Where-Object { $_ -and ... }`.

## "Blocked — needs infra" is usually wrong; verify before believing it

Two families looked infra-blocked and were not:
- **LDAP mappers need no live directory.** They are config-only Keycloak *components* nested
  under an `ldap_user_federation` component; KC doesn't validate them against LDAP at create
  time. The `400` was a missing federation parent + a missing `EditMode`, not an absent server.
- **Authz/fine-grained-permissions are locally provable** with `KC_FEATURES=preview,
  admin-fine-grained-authz:v1` and one client set `authorizationServicesEnabled=true` (the `404`
  was just the not-yet-existing resource-server). `preview` also unlocks the spiffe IdP +
  workflows; `custom_user_federation` proves against the built-in `kerberos` UserStorageProvider;
  `java_keystore` needs a keytool `.jks` copied into the container. Capture the real error and
  test the cheap theory before standing up infra.

## Test-harness pitfall: `@(list) | Where` can collapse a JSON array

In a *test* (not the module), `(@(Invoke-RestMethod .../client-scopes) | Where {...}).id` can
collapse the whole array into one object whose properties are arrays, so `.id` returns every id
joined. The module's own `foreach ($x in $this.Api(...))` doesn't hit this. Resolve ids in
harness code with an explicit `foreach` loop, not a `@()|Where` pipeline.

## Audit-script bugs to avoid (they hide the truth)

The field-parity audit itself had three bugs that made its number meaningless until fixed —
verify yours on a known resource before trusting it:
- A `[^\]]+` type regex can't match nested-bracket types (`[nullable[bool]]`, `[string[]]`).
  Match everything up to the `$name` on the line instead.
- `'Prefix' + (parts) -join ''` binds by precedence to `('Prefix' + parts) -join ''` →
  string+array coercion with a space. Assign `$parts -join ''` to a var first.
- Forgetting to exclude TF-only fields makes 100% unreachable and the number pessimistic.
