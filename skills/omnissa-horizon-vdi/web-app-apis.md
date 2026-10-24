# Reading a web app's data through its API

A task branch of [`omnissa-horizon-vdi`](SKILL.md): load it when the task reads data from a web app open in the VDI's browser.

## Prefer the API over the UI

If the app has a JSON API the browser can reach, open its URLs directly in the VDI's browser. The browser's existing session authenticates them, so there are no tokens to handle. The API gives exact ISO timestamps where the UI says "2 weeks ago", and compact text you can zoom-read in strips. Turn off any "Pretty-print" toggle: one record per few lines reads denser than the pretty form.

A long log or build output usually has a **raw** view that is denser than its page; jump to the end with `End` and page up.

## GitLab

Base: `https://<host>/api/v4/projects/<url-encoded group/project path>/`. Each endpoint below is relative to it.

| Question | Endpoint |
|---|---|
| Commits on a branch, newest first | `repository/commits?ref_name=<branch>&since=<ISO>&per_page=50` |
| What one commit changed | `repository/commits/<sha>/diff` |
| A source file as plain text | `repository/files/<url-encoded path>/raw?ref=<branch>` |
| Where a term appears in code | `search?scope=blobs&ref=<branch>&search=<term>` |
| What reached an environment, with job status and finish time | `deployments?environment=<env>&order_by=created_at&sort=desc&per_page=N` |
| Last pipeline activity on any branch | `pipelines?order_by=updated_at&sort=desc&per_page=N` |

`deployments` rejects an `updated_after` filter unless sorted by `updated_at`.
