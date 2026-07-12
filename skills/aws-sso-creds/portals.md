# Portal registry (template)

Every portal-specific fact lives here — or in a dedicated per-org wrapper skill
that hands `aws-sso-creds` the same facts. Adding an org means adding a section,
not editing `SKILL.md`.

**This file ships as a template.** The single section below is a fake example
showing the shape. Replace it with your real portals in a private checkout, or
keep org data in a private `<org>-aws` wrapper skill and leave this as-is. Never
commit real org names, account IDs, or emails to a public copy of this skill.

Account IDs are recorded so a run can **verify** it landed in the intended
account rather than trusting the tile it clicked. An ID listed as `?` has not
been confirmed — confirm it with `sts get-caller-identity` and fill it in.

---

## `example-org` — Example Org (fake, replace me)

- **Start URL:** `https://example-org.awsapps.com/start`
- **IdP:** Microsoft Entra (`login.microsoftonline.com`), user `you@example.com`
- **SSO region:** `us-east-1` (workloads may differ — don't confuse them)
- **Cache prefix:** `example-org-`

| Alias | Account name | Account ID | Notes |
|---|---|---|---|
| `dev` | example-dev | `000000000000` | |
| `prod` | example-prod | `?` | |

Voice-input aliases: "example dev", "example org prod".

---

## Adding a portal

1. Get the start URL — it looks like `https://<alias-or-directory-id>.awsapps.com/start`.
2. Add a section above: start URL, IdP, cache prefix, and the account table.
3. Leave account IDs as `?` until a `sts get-caller-identity` confirms them, then
   fill them in. An unverified ID is worse than a missing one, because the
   verification step in `SKILL.md` will happily compare against a wrong constant.
