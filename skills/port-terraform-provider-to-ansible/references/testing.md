# Testing paradigm

## Mirror how providers test themselves

Terraform providers ship **acceptance tests, not mocked unit tests**: real API
calls against a real server, create/verify/update/verify/destroy, and the
oracle "apply twice → the second plan is empty". Grep the provider's Makefile
(`TF_ACC=1 go test`) and CI workflow to confirm; you'll usually find a
version-matrix too. Your suite copies the methodology; the matrix is optional.

## The per-module lifecycle (the contract every test asserts)

```
create            → changed, end_state correct
identical re-run  → NOT changed          ← the oracle; never weaken this
check-mode update → changed + diff shows the delta, AND the server was NOT mutated
real update       → changed, end_state reflects it
absent            → changed
absent re-run     → NOT changed
```

If the second run reports changed, the module (not the test) is wrong — the
server normalized something and the module must normalize the comparison the
same way the provider's read/DiffSuppress logic does.

## Test substrate: local container, non-negotiable

Run against a **local docker container of the service** that a script in the
repo owns (start, healthcheck, bootstrap an admin service account, write an
env file). Hard-won: binding the suite to a shared/deployed instance means the
suite dies when that instance does, and every test pays WAN+TLS latency (our
sweep ran several times faster after switching to localhost). Pattern:

- `scripts/local-<service>.sh up|down|status` — docker run, wait-for-health
  loop, bootstrap credentials via the API, write `.local-<service>.env`
  (0600, gitignored).
- `scripts/run-tests.sh` — symlinks the repo into
  `.collections/ansible_collections/<ns>/<name>`, exports
  ANSIBLE_COLLECTIONS_PATH, sources the env file, runs
  `ansible-playbook -i localhost, -c local tests/integration/test_*.yml`.

## Playbook shape (per family)

```yaml
- hosts: localhost
  gather_facts: false
  module_defaults:
    group/<ns>.<name>.<action_group>:
      auth_url: "{{ lookup('env', 'SVC_URL') }}"
      auth_client_id: "{{ lookup('env', 'SVC_SA_CLIENT_ID') }}"
      auth_client_secret: "{{ lookup('env', 'SVC_SA_SECRET') }}"
  tasks:
    - name: Clean slate
      <ns>.<name>.<realm-ish container>: { name: test-<family>, state: absent }
    - block:
        # ... lifecycle per module, register + assert at each step ...
      always:
        - name: Cleanup even on failure
          <ns>.<name>.<container>: { name: test-<family>, state: absent }
```

- Namespace fixtures per family (`test-<family>-*`) so parallel agents never
  collide on the shared server.
- Prerequisites from other families: use those modules if they exist already,
  else raw `ansible.builtin.uri` in setup only — never for the resource under
  test.
- Untestable-on-this-server modules (feature flags, server-side files,
  removed features): keep the module faithful, make the test assert the
  documented server error, and record it with evidence.

## Verification beyond the suite

- **Full sweep**: run every family playbook sequentially, require exit 0.
- **Scenario replay**: reproduce a real end-to-end change your users make,
  with only the new collection, asserting round-2 full idempotency across
  every task. This catches cross-module integration the per-module tests miss.

## Matching the provider's test depth (optional escalation)

The per-module lifecycle is ~1/5 of a mature provider's permutation depth
(providers accrete many per-field update cases over years). To close that:
fan out agents over the provider's `resource_*_test.go` files, translating
each acceptance-test scenario into playbook cases. Costs roughly as much as
the module port itself and multiplies suite runtime; do it when the collection
graduates from measured-PoC to owned-product.
