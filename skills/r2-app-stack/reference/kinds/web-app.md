# Browser web app

Read [`../shared.md`](../shared.md), [`../test-stack.md`](../test-stack.md) and [`../testable-apps.md`](../testable-apps.md) first; this page adds only what is particular to a browser app.

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| React 19 + Vite 8 + TypeScript, exact pins | six of Joseph's web apps agree | Timeline Studio, Wizard Studio, Airtable, Loan Bank, records-easy, steno web | exact pin |
| jsx-a11y lint plugin on | names and roles are what tests find things by | Timeline Studio, Wizard Studio, Airtable, Loan Bank, steno | lint |
| Browser tests run the built bundle (`vite build`, served by `vite preview`) against fakes of the API, with `page.route` or the shared fake server | test what users get, without a real backend | Airtable `web/journeys/` (Playwright, `page.route`), Wizard Studio (`FakeGitHub`) | check command |
| The browser-test build is instrumented for coverage (Istanbul plugin) and its coverage merges with vitest's | one report; see [`../test-stack.md`](../test-stack.md) | coverage decision 2026-11-07 | merge script |
| Deploy: personal apps as a Docker image → ghcr → signed webhook → NAS; work apps to S3 + CloudFront behind AuthGuard via SAM | per audience | Timeline Studio `Dockerfile`, rascaltwo.com; Wizard Studio, Airtable | deploy workflow |

## Not decided yet

Joseph parked these on 2026-11-07. Record what the repo does and ask before standardising.

- **Styling.** Today: one plain CSS stylesheet (Timeline Studio, Wizard Studio, Airtable, Loan Bank's UI package, steno web). Tailwind only in records-easy (March 2026, superseded).
- **Routing.** Today: no router library; Wizard Studio and Airtable read and write the URL with the browser's own `location`, `history` and `URLSearchParams`. TanStack Router only in Loan Bank.
