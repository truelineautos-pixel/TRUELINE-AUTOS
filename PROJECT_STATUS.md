# TrueLine Autos Project Status

## Audit

- Frontend: React 19, TypeScript, Vite, React Router, Tailwind/PostCSS, Lucide, Recharts, and Supabase JS.
- Architecture: one `src/App.tsx` contains the shell, route declarations, and view components; `src/main.tsx` mounts it in `BrowserRouter`; styles are in `src/index.css`.
- Real behavior before this update: client-side route changes, settings background sliders, and a static layout only.
- Placeholders: Purchase, Sales, Partners, Investors, Finance, Profit, Expenses, Reports, and AI routes render `PagePlaceholder`.
- Hardcoded demo content: dashboard KPIs, partner names and funding, inventory rows, transactions, profit breakdown, AI recommendation, login defaults, and business settings.
- Nonfunctional controls before this update: demo sign-in/logout, dashboard actions, inventory Add vehicle, report links, notification/security buttons, global search, and profile/settings inputs.
- Backend before this update: Supabase JS dependency and one schema migration existed; no browser client, configured project, auth flow, RLS policies, storage policies, or tested database connection existed.
- Environment: `.env.example` contained a service-role `VITE_` variable, which is unsafe because Vite exposes `VITE_` variables to browser builds. It has been removed; local env files are now ignored by Git.
- Database: `001_init.sql` defines core tables but originally had no RLS, constraints covering the business rules, or transactional financial functions. `seed.sql` contains generic settings/funding source values only; no named people have been seeded.

## Implemented in this phase

- Added an env-gated Supabase browser client using only the anon/publishable key.
- Replaced the fake authenticated-by-default state with Supabase session restoration, email/password sign-in, sign-out, password reset, and recovery password update.
- New auth users receive inactive `pending` profiles from a database trigger; activation and role assignment require a privileged dashboard SQL action.
- Added initial RLS policies and role helper functions. New partner/investor accounts are linked through profile foreign keys; migration `004_shared_read_access.sql` grants active partners shared reads and investors reads limited to their own investment-linked records.
- Migration `005_vehicle_parties.sql` adds RLS-isolated investor address/notes and customer contact fields, status-aware access revocation for inactive partners/investors, Super Admin-only audited management RPCs, funding summaries, and an atomic vehicle/contribution save function. It rejects customer-funded records and funding totals greater than the vehicle purchase price.
- Added private image and document buckets with size/type limits and separate access policies. Vehicle file metadata is stored in `vehicle_files`.
- Replaced the Inventory demo table with Supabase-backed paginated search/filter, full-field add/edit/archive, catalog suggestions, details, and image/PDF upload UI. Partner/investor funding is stored as individual `funding_contributions`; existing funding rows are shown read-only and new funding entries are appended, not replaced. Customer consignment vehicles collect customer contact details and do not receive new showroom purchase-cost or funding entries. These database flows have not been exercised against a live project.
- Added Super Admin-only investor and partner management under Settings, including search, contact/status editing, retained history, associated vehicle/capital summaries, and available investor funding/distribution history.
- Reduced the background image size and glass blur, memoized dashboard aggregates, moved dashboard inventory/funding totals into scoped database aggregates, paginated inventory and investor lists, debounced searches, and added reduced-motion styles.
- Replaced dashboard demo figures/charts with database queries, a month filter, empty/zero states, and a CSV summary export. The dashboard can now receive shared financial rows for partners and only the investor's own investment-linked rows under RLS; live behavior remains unverified.
- Updated setup documentation with the six names supplied by the user. No partner seed rows were added; existing rows must be checked before manual setup to avoid duplicates.

## Read-only dashboard phase

- Expanded the dashboard with a month-filtered 12-month completed-sales trend, recorded vehicle/general expense trend, recent purchases, 90+ day available showroom vehicles, stored sales balances, partner/investor contribution totals, reserve balance, and recent transactions.
- Replaced the misleading “AI recommendation” placeholder with financial-data coverage notes. The dashboard no longer sums approved profit-calculation rows because the schema does not prevent duplicate/revised calculations; profit is explicitly unavailable until a transactional profit workflow exists.
- Added an investor-specific dashboard summary. Its data is aggregated by invoker-rights functions and constrained by the existing investor RLS policies; it does not query other investors' financial records.
- Added migration `006_dashboard_read_models.sql` for role-scoped, read-only funding summaries. It adds functions only; it creates or changes no business records and adds no table mutation permissions.
- Replaced nonfunctional dashboard “View report”, “Adjust policy”, and “Ledger” controls with functional Refresh and export controls or removed them.
- The user reports that migration 005 was applied successfully. This was not independently checked. Migration 006 has not been applied to Supabase; the updated read-only dashboard requires it.
- The only available database environment is production, so no database writes or mutation tests were performed. The shared browser remains unauthenticated.
- Files changed in this phase: `src/App.tsx`, `src/index.css`, `supabase/migrations/006_dashboard_read_models.sql`, `SUPABASE_SETUP.md`, and `PROJECT_STATUS.md`.
- TypeScript and production build pass after the dashboard changes. Oxlint exits successfully with six `react(set-state-in-effect)` warnings. The generated main bundle is about 552 KB minified; Vite continues to warn that it exceeds 500 KB.
- Static migration assertions passed for invoker security, lack of table writes, revocation of public/anonymous execution, and authenticated execution grants. SQL was not run against Supabase.
- The shared browser can only verify the sign-in page without an authenticated session; the dashboard and responsive protected views have not been visually exercised.

## Urgent save/update fix

- Root cause found in the frontend flow: investor and vehicle save handlers did not guarantee cleanup of their loading state if a request rejected; partner saves had no loading state at all. Vehicle edits also exposed Save while existing funding and party lists were still loading, allowing an early submit to fail the funding validation. A vehicle could already be committed by the transactional RPC but then be presented as failed if the separate, non-financial catalog suggestion write failed.
- Updated the save handlers to catch and show Supabase/network errors, include available error details/code, and always clear the busy state. Partner creation is now available through the existing Super Admin-only `manage_partner` RPC. Investor/partner status changes also show in-progress feedback and errors.
- Vehicle saves now wait for party and funding data, keep the transactional vehicle/funding save as the success criterion, and report a catalog suggestion problem separately without implying the vehicle transaction failed. No RLS policy, financial record, migration, or database function was changed.
- Files changed for this fix: `src/App.tsx` and `PROJECT_STATUS.md`.
- Local validation passed: TypeScript and production build; lint exited successfully with six `react(set-state-in-effect)` warnings. The local browser preview reloaded and rendered the sign-in page.
- Add/edit investor, partner, vehicle, funding assignment, and refresh-persistence tests could not be run: the preview has no authenticated Super Admin session, and no live Supabase writes were attempted. The SQL RPC signatures and Super Admin checks were inspected in migration 005, but deployment/live RLS behavior is not verified.

## Verification and limitations

- The local app reports Supabase browser configuration is present, but no live database connection or role-specific behavior has been verified; no project secrets were inspected.
- RLS/storage policies have not been run against a live project or tested with role-specific users. Do not treat security as production-verified.
- TypeScript project build and Vite production build pass locally. Oxlint passes with existing `react(set-state-in-effect)` warnings. Vite reports a 538 KB minified main chunk; further code-splitting is still warranted.
- The premium dashboard layout remains glass-based. The updated read-only dashboard cannot be validated with real records until migration 006 is applied and an authenticated safe test project is available.
- Remaining dashboard gaps: today/week/year/custom-date filters, inventory/category distribution charts, profit-performance charts, verified cash/receivables reconciliation, and AI analysis. Profit and capital values must not be inferred until the related transactional workflows are implemented.
- Migrations and RLS/functions have not been applied to or tested against a live Supabase project. The built login screen loaded locally without horizontal overflow at desktop and mobile widths; protected-page scrolling and all requested database-backed add/edit, deactivation, role-boundary, and persistence tests remain unverified here.
- Purchases beyond initial vehicle contributor funding, sales/payments workflows, secure financial posting, expenses/reserves, complete reports, and automated database security/business-rule tests remain unimplemented.
- There is no existing test suite or Supabase CLI in the repository.

## Next actions

1. Apply migration `006_dashboard_read_models.sql` after `005_vehicle_parties.sql` in the intended project; no migration has been run from this workspace.
2. Obtain a non-production Supabase project and disposable role-specific accounts before testing add/update or financial operations.
3. Implement purchases/funding and sales with transactional server-side functions, then financial posting, expenses/reserves, role-scoped statements, and reports.
4. Add automated tests for financial rules, duplicate prevention, dashboard reconciliation, and RLS roles; rerun the production build.

## Cloudflare Pages deployment preparation

- Vite's production output is `dist`; the Cloudflare Pages build settings should be `npm run build` and `dist`. The project is a client-side `BrowserRouter` app; known application routes loaded directly and refreshed in the local preview, which returned the sign-in screen for an unauthenticated user. Cloudflare Pages' SPA fallback has not been tested on a deployed site.
- Added standard page title/description metadata and changed the shared placeholder label so unfinished Purchase, Sales, Partners, Investors, Finance, Profit, Expenses, Reports, and AI routes say **Under development**.
- Local preview checks: sign-in page rendered on a direct `/inventory` URL after refresh; body width matched 390px mobile and 1440px desktop viewports without horizontal overflow. Protected pages and actual sign-in/password-reset/logout were not tested with credentials.
- `npm run build` passes TypeScript and Vite production compilation. Vite reports a 552.46 KB minified main JavaScript chunk, above its 500 KB advisory threshold. `npm run lint` exits successfully with six existing `react(set-state-in-effect)` warnings.
- The project folder has no `.git` directory or Git remote, and Git is unavailable in the shell. The supplied public repository, `https://github.com/truelineautos-pixel/TRUELINE-AUTOS`, is reachable but GitHub reports that it is empty and has no default-branch Git reference. No Cloudflare Pages project or GitHub repository connection was configured, so there is no project name, `.pages.dev` URL, or live deployment to verify.
- Supabase environment variables are present for the local preview (only their configured state was observed; values were not inspected). Cloudflare Pages variables have not been set. Supabase Site URL/redirect URLs were not changed or live-tested. Configure the deployed `https://<project>.pages.dev` URL as the Supabase Site URL and allow that URL plus its recovery redirect path in Authentication > URL Configuration after a Pages URL exists. Use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; never use a service-role/secret key in Pages variables.
- The app has no public sign-up form and protects application routes behind a Supabase session and active profile. No database or financial writes were performed.
- To complete deployment, first publish the current app source to the supplied GitHub repository (excluding `.env.local`), then sign in to Cloudflare and connect that repository. Set the build configuration and the two public Supabase variables in Pages, deploy on the free `pages.dev` subdomain, configure Supabase auth URLs, then verify HTTPS, login/reset/logout, direct-route refresh, and mobile/desktop rendering on the live URL. Do not send credentials or secrets in chat.
- Source-publishing request: `.gitignore` already excludes `.env.local` and all `.env.*` files except `.env.example`; it now also excludes common private-key, certificate-container, credentials, and secrets filenames. A content scan of source/docs/config found no common service-role key, private-key, or token patterns, and `.env.local` was not opened. The repository is still empty and this workspace has no Git metadata or Git executable, so no commit or push to `main` has been made. Cloudflare sign-in could not be re-verified after the user's confirmation; no deployment was attempted.
