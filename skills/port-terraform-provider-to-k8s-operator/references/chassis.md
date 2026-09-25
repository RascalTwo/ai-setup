# The chassis — code shapes for the Java/Quarkus operator

Everything here is battle-tested (every sharp edge below cost real debugging
time in a real build). Substitute your provider's domain everywhere you see a
generic name.

## Build files

`pom.xml` essentials (versions known-good together; bump deliberately):

```xml
<properties>
  <maven.compiler.release>21</maven.compiler.release>
  <quarkus.platform.version>3.20.1</quarkus.platform.version>
  <qosdk.version>7.1.1</qosdk.version>
</properties>
<!-- dependencyManagement: import io.quarkus.platform:quarkus-bom and
     io.quarkiverse.operatorsdk:quarkus-operator-sdk-bom (both pom/import) -->
<dependencies>
  <dependency><groupId>io.quarkiverse.operatorsdk</groupId><artifactId>quarkus-operator-sdk</artifactId></dependency>
  <dependency><groupId>io.quarkus</groupId><artifactId>quarkus-arc</artifactId></dependency>
  <!-- the typed SDK for YOUR target API, if one exists (the big lever) -->
  <!-- @PreserveUnknownFields for the additionalConfig escape hatch: -->
  <dependency><groupId>io.fabric8</groupId><artifactId>generator-annotations</artifactId></dependency>
</dependencies>
```

`application.properties`:

```properties
quarkus.operator-sdk.crd.generate=true
quarkus.operator-sdk.crd.apply=false          # CRDs applied from deploy/crds/, never by the running operator
quarkus.kubernetes-client.devservices.enabled=false
# If a Quarkus extension for your target API ships dev-services, disable them —
# you target a real instance (the reference build lost a restart cycle to this):
# quarkus.<extension>.devservices.enabled=false
```

Dockerfile (JVM mode, layered so the fat lib layer caches):

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/quarkus-app/lib/ /app/lib/
COPY target/quarkus-app/quarkus/ /app/quarkus/
COPY target/quarkus-app/app/ /app/app/
COPY target/quarkus-app/quarkus-run.jar /app/quarkus-run.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/quarkus-run.jar"]
```

Makefile targets worth having from day one: `build` (package + copy CRDs to
`deploy/crds/`), `cluster-up`/`cluster-down` (kind; export
`KIND_EXPERIMENTAL_PROVIDER=podman` on podman machines), `crds`, `secret`
(namespace + connection secret from env), `dev`
(`mvn quarkus:dev -Dquarkus.kubernetes-client.context=kind-<name>` — operator
runs ON THE HOST watching the kind cluster; fastest loop), `verify`.

## The common package (one class each)

**BaseSpec** — every resource spec extends it:

```java
public abstract class BaseSpec {
    public String connectionRef;    // Secret name in CR ns; default e.g. "<x>-connection"
    public String deletePolicy;     // "delete" (default) | "orphan"
    @PreserveUnknownFields
    public JsonNode additionalConfig;   // JsonNode, NOT Map<String,Object> — see sharp edges
    public boolean orphan() { return "orphan".equals(deletePolicy); }
}
```

**BaseStatus**: `Boolean ready; String message; String resourceId;
String lastSync; Long observedGeneration;`

**ApiClients** (`@ApplicationScoped`) — builds + caches one authenticated API
client per (namespace, secretName) from a Secret with keys like
`url`/`clientId`/`clientSecret` (base64-decode + trim). Known limitation to
document: the cache doesn't watch the Secret, so credential rotation needs an
operator restart.

**Json** — the generic reconcile lever, ~90 lines, reuse verbatim:

- `M`: ObjectMapper with `NON_NULL` serialization + `FAIL_ON_UNKNOWN_PROPERTIES=false`.
- `desired(bean, additionalConfig)`: `valueToTree` + deep-merge the overlay.
- `subsetEquals(desired, live)`: every field present in desired must match
  live; recurse objects; scalar arrays compare as sorted multisets, object
  arrays pairwise in order; scalars compare `asText()` (kills 5 vs 5.0 vs "5"
  churn).
- `mergeInto(liveBean, desiredNode)`: `M.readerForUpdating(liveBean).readValue(desired)`.

**AbstractReconciler<S extends BaseSpec, R extends CustomResource<S,BaseStatus> & Namespaced>**
implements `Reconciler<R>, Cleaner<R>`:

- `reconcile`: resolve client → `String id = sync(client, cr)` → set full
  ready status → `UpdateControl.patchStatus(cr)`. Let exceptions propagate
  (JOSDK retries with backoff).
- Override `updateErrorStatus`: log + set `ready=false, message=e.getMessage()`
  → `ErrorStatusUpdateControl.patchStatus(cr)`.
- `cleanup`: skip remote delete when `orphan()`; call `remove(client, cr)`;
  treat not-found as success via `isNotFound(e)` (below); rethrow the rest.
- Subclasses implement only `sync` (make the API match the spec, return the
  remote id) and `remove`.
- Helper `orDefault(specName, cr.getMetadata().getName())` — remote names
  default to the CR name.

## Per-resource pattern (what wave agents replicate)

Three files per resource in their own package — CR class
(`@Group/@Version/@ShortNames`, extends `CustomResource<Spec, BaseStatus>`,
implements `Namespaced`), Spec, Reconciler with
`@ControllerConfiguration(name=..., maxReconciliationInterval=@MaxReconciliationInterval(interval=30, timeUnit=SECONDS))`.
The 30s resync IS the drift-heal mechanism.

Sub-resources not in the main representation (role mappings, memberships,
attached secrets) sync right after the main flow, idempotently, every
reconcile: fetch current, add missing, remove extras — but only for lists the
spec explicitly sets (`null` = unmanaged), and never remove platform built-ins
(maintain an explicit protect-list).

Secret-producing resources (e.g. a client/app with a generated credential):
read it from the API and server-side-apply a k8s Secret named after the CR;
delete it in `remove()`; never log the value.

## RBAC / deploy manifest

Namespace + ServiceAccount + ClusterRole (your CRD group `*`, CRD read,
Secrets get/list/watch/create/update/patch/delete) + binding + Deployment
(readiness probe on `/q/health/ready`, `imagePullPolicy: Never` for node-local
PoC images). Production note: narrow the Secrets grant to per-namespace Roles.

## Sharp edges (every one of these cost real time — read before coding)

1. **Reactive REST clients don't throw `jakarta.ws.rs.NotFoundException`** —
   404s surface as a client-specific `WebApplicationException` subclass.
   Match on response status (and message contains "404" as fallback) in one
   shared `isNotFound(Throwable)`; never catch by exception type.
2. **Primitive-boolean/int setters NPE on null unboxing** — provider SDK
   representation classes mix `Boolean` and `boolean` setters arbitrarily.
   Guard every set of a nullable spec field; when a representation
   *constructor* defaults a deprecated field, null it before building the
   desired subset or you get PUT-churn every resync.
3. **`Map<String,Object>` + `@PreserveUnknownFields` still emits
   `additionalProperties: {type: object}`** in the generated CRD — scalar
   values get rejected at apply time. Use a `JsonNode` field: clean
   `x-kubernetes-preserve-unknown-fields: true`, nothing else.
4. **`@PreserveUnknownFields` lives in `io.fabric8:generator-annotations`** —
   not in the crd-generator-api artifacts you'd guess.
5. **The CRD generator ignores `@JsonProperty(required=true)`** — generated
   schemas have no `required:` blocks. Either accept reconcile-time errors
   (status carries the message; fine for PoC) or use the generator's own
   `@Required`.
6. **Masked secrets break drift comparison** — servers echo `**********` for
   secret config values. Exclude secret keys from the desired subset used for
   `subsetEquals`; re-set them only on actual create/update writes.
7. **Server create endpoints return 201 with no body** — check status ≥300
   (a silent 409 otherwise becomes "missing after create"), then re-fetch by
   name for the id.
8. **Fields owned by a different endpoint silently no-op on update** (e.g.
   list-attachment fields settable only at create). Set them on create,
   STRIP them from the drift compare, and document the gap — otherwise you
   get an eternal 30s PUT loop.
9. **Quarkus dev mode does not reliably hot-reload operators** — no HTTP
   traffic to trigger it. Restart `quarkus:dev` after code changes;
   it's seconds.
10. **Component/plugin-style APIs are their own chassis ground — but the same
    lever fits.** Many providers expose a whole family (LDAP federation + its
    mappers, realm keystores, key providers) not as dedicated endpoints but as
    one generic "component" endpoint where a `providerType` + `providerId`
    selects behavior and config is a free-form map. Model each *family* as ONE
    CRD with a `providerId` type field + a config map (exactly like the
    protocol-mapper many-to-one), reconciled through the components endpoint.
    Three gotchas that cost time: (a) the component's `parentId` is the
    resource's **internal id**, not its human name — a created realm's id is a
    UUID ≠ the realm string, so resolve it (`realm().toRepresentation().getId()`)
    and use it for both the write and the list-by-parent query; (b) component
    config is **list-valued** (`MultivaluedHashMap<String,List<String>>`),
    so a flat CRD `Map<String,String>` must be wrapped one value per key — the
    subset-diff's scalar-array handling then compares them cleanly; (c) child
    components (mappers) carry `parentId` = the *parent component's* id, so a
    mapper CRD must resolve its parent by name first and fail loudly if absent
    (create ordering: parent before children). The masked-secret exclusion
    (#6) applies verbatim to component credentials (LDAP `bindCredential`).
    A component with an unreachable backend (e.g. a bogus LDAP URL) still
    **creates fine** — connection is tested lazily — so lifecycle e2e needs no
    real backing server.
