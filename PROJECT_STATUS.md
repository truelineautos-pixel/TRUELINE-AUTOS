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

- The project has no Wrangler, Worker, or Pages configuration in source. It is a standard static Vite build; Cloudflare Pages (not a Workers static-assets deployment) should use the Git integration for `truelineautos-pixel/TRUELINE-AUTOS`, production branch `main`, root directory `/`, build command `npm run build`, and output directory `dist`. Do not remove or modify the existing Worker when creating the separate Pages project.
- Updated `README.md` with dashboard setup steps, Supabase build-variable guidance, SPA routing behavior, and post-deployment auth URL checks. Pages build configuration supports environment variables in project settings. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production in Cloudflare before its first build. They are browser-visible Vite configuration; use only the Supabase publishable/anon key, never the service-role key. Use a separate non-production Supabase project for any preview deployment.
- The Vite output has no top-level `404.html`. Per Cloudflare Pages' documented behavior, Pages automatically serves the SPA root for non-asset paths; an extra `_redirects` or Wrangler file is unnecessary.
- Official setup references: [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/), [build configuration and variables](https://developers.cloudflare.com/pages/configuration/build-configuration/), [SPA serving behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/).
- Added standard page title/description metadata and changed the shared placeholder label so unfinished Purchase, Sales, Partners, Investors, Finance, Profit, Expenses, Reports, and AI routes say **Under development**.
- Local preview checks: the sign-in screen rendered after direct-route refresh at 320, 375, 390, 430, 768, 1024, 1366, 1440, and 1920 px, with no horizontal overflow. Protected views and actual sign-in/password-reset/logout were not tested with credentials.
- `npm run build` passes TypeScript and Vite production compilation. The current minified chunks are app 122.63 KB, React 218.75 KB, Supabase 214.38 KB, and lazy chart 371.25 KB; Vite emits no large-chunk advisory. The lazy chart is excluded from the PWA precache. `npm run lint` exits successfully with six `react(set-state-in-effect)` warnings.
- The existing `https://trueline-autos.pages.dev/` URL was opened and returned the sign-in screen. This work did not verify its Git connection or Pages environment variables, create a Pages project, or deploy changes. No authenticated production behavior is claimed.
- Supabase environment variables are present for the local preview (only their configured state was observed; values were not inspected). Cloudflare Pages variables have not been set. Supabase Site URL/redirect URLs were not changed or live-tested. Configure the deployed `https://<project>.pages.dev` URL as the Supabase Site URL and allow that URL plus its recovery redirect path in Authentication > URL Configuration after a Pages URL exists. Use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; never use a service-role/secret key in Pages variables.
- The app has no public sign-up form and protects application routes behind a Supabase session and active profile. No database or financial writes were performed.
- Follow the updated README to create the separate Pages project, add build variables directly in Cloudflare, and verify the resulting public URL before calling deployment complete. Supabase URL settings and database records were not modified.
- Source-publishing request: Git 2.56.0 for Windows initialized this project on `main`. Commit `f9511f4` (`Initial TrueLine Autos project`) was pushed to `https://github.com/truelineautos-pixel/TRUELINE-AUTOS`; GitHub confirmed the root, `src`, and all six migration files are present, and the remote branch hash matched the local commit. The `.gitignore` excludes `.env.local`, `.env`, other `.env.*` files except the safe `.env.example`, common private-key/certificate, credentials, and secrets filenames. `.env.local` was neither tracked nor staged. A source/docs/config scan found no common service-role key, private-key, or token patterns; `.env.local` was not opened. No deployment was attempted.

## Premium UI and responsive improvement plan

### Audit findings

- The live Pages URL loads the existing Supabase sign-in screen over HTTPS. No authorized session was available, so protected dashboard, inventory, settings, and management screens could not be visually or functionally audited against live data.
- The app is a single large `src/App.tsx` containing auth, dashboard, inventory, party management, settings, and routes. Purchase, Sales, Partners, Investors, Finance, Profit, Expenses, Reports, and AI routes are still development placeholders; do not present them as finished or populate them with demo data.
- The active dashboard has scoped real-data queries and honest profit limitations, but its original sales/expense visualization used unlabeled CSS bars. The header search input was nonfunctional. Mobile styling stacked the desktop sidebar instead of providing a compact navigation drawer.
- Inventory already supports paginated database search, filters, full vehicle forms, funding relations, and role-checked Supabase RPC writes. These must remain intact. Existing database/RLS behavior is not to be weakened or tested with production writes.
- The existing reduced-motion preference is present. The build had a large main chunk; adding Recharts synchronously increased it further, so the chart is now loaded as a separate lazy module.

### Planned phases

1. **Audit and baseline** — inspect routes, authentication, real data flows, design tokens, mobile behavior, current live sign-in, and existing build/lint status. Record inaccessible protected screens as unverified, not passed.
2. **Design system and shared shell** — establish consistent typography/surfaces/focus treatment, group navigation, improve the header, and build an accessible mobile drawer without changing auth or role checks.
3. **Dashboard hierarchy and charts** — use only current authorized aggregates; add readable responsive charts, date controls, empty/error/loading states, and no fabricated profit or business values.
4. **Inventory and forms** — improve responsive listing, details, and forms while preserving pagination, catalog suggestions, transactional vehicle/funding RPCs, and audit history.
5. **Finance, reports, and AI** — only present data and actions supported by existing schema/secure workflows; keep unfinished modules clearly marked until their server/database behavior exists.
6. **Settings and role-aware navigation** — improve real settings and background customization, expose only authorized management actions, and retain Super Admin-only party administration.
7. **Mobile/accessibility/performance** — test all requested viewport sizes, touch navigation, overflow, focus/keyboard, reduced motion, image costs, query counts, and lazy-loaded modules.
8. **Verification and delivery** — run TypeScript, lint, production build, and available tests; review changes; only then commit/push `main`. Do not deploy until the user authorizes Pages deployment and its public URL is verified.

### Work completed in this pass

- The authenticated shell now groups navigation by section; on small screens it uses a closeable drawer with scrim, Escape handling, scroll lock, and close-on-navigation.
- The previously inert header search now routes its query to database-backed inventory search. It searches inventory only and does not imply a global people/invoice search.
- The dashboard greets the active user and provides a direct inventory link. Sales and expenses are shown together as a responsive Recharts bar chart using the existing monthly query results; the chart is lazy-loaded to avoid bundling its library with initial auth/app load. Profit remains unavailable.
- Updated responsive styles for compact phones, small phones, tablet, and desktop; reduced mobile glass blur and retained `prefers-reduced-motion`.
- Production build and TypeScript pass with React and Supabase split into vendor chunks and the chart loaded separately: app 122.63 KB, React 218.75 KB, Supabase 214.38 KB, and chart 371.25 KB (minified); Vite emits no large-chunk advisory. The chart chunk is excluded from the PWA precache, reducing the precache from 928.96 KiB to 566.41 KiB across nine assets.
- `npm run lint` exits successfully with six `react(set-state-in-effect)` warnings in `src/App.tsx`. Local production preview direct-route refresh and sign-in rendering passed at widths 320, 375, 390, 430, 768, 1024, 1366, 1440, and 1920 px, with no horizontal overflow or browser page errors.
- Changed files: `src/App.tsx`, `src/index.css`, `src/components/SalesExpenseChart.tsx`, `vite.config.ts`, `README.md`, and `PROJECT_STATUS.md`.
- The existing public Pages login route was verified before edits. Protected navigation, chart rendering, inventory search, and authenticated database workflows remain unverified because no authorized session was available. No deployment, Supabase database write, or production mutation was performed.

## Stage 1 — inventory cards and vehicle profiles

- Completed the inventory photo-card grid and retained the existing paginated table as a selectable list view. Cards show existing photo metadata through short-lived signed URLs, recorded vehicle details/prices, status, ownership category, and inventory age; missing values remain explicitly unrecorded.
- Added searchable inventory filters for category, status, contributor, purchase date, purchase price, inventory age, and sort order. Contributor filters use the existing `funding_contributions` relationship; vehicle results remain server-paginated.
- Added the lazy-loaded `/inventory/:vehicleId` profile using existing vehicle, funding, expense, sales/payment, distribution, transaction, file, and admin audit data. Investor-visible funding remains subject to existing RLS; sales/expense/calculation/audit details are withheld from investor accounts in the UI. Gross profit remains unavailable because the schema has no stored gross-profit field. Net profit is only shown from a single approved stored calculation linked to the vehicle sale; no new financial aggregation was introduced.
- Added responsive card, filter, and profile styles while retaining the existing glass dashboard theme. No database migration, RLS policy, role, authentication flow, financial calculation, or production data was changed.
- Changed for this stage: `src/App.tsx`, `src/index.css`, `src/components/VehicleCard.tsx`, `src/components/VehicleProfileView.tsx`, and `PROJECT_STATUS.md`.
- Verification: `npm run build` (including `tsc -b`) passed. `npm run lint` passed with seven `react(set-state-in-effect)` warnings: six at existing `src/App.tsx` effect sites and one in the new profile-loading effect. Production preview loaded the login page, and direct navigation/refresh to `/inventory/:vehicleId` returned the authentication screen. The login page had no horizontal overflow at 320, 360, 375, 390, 414, 430, and 768 px. Protected inventory/profile layout, image access, and authenticated queries were not tested because no authorized session was available. No live Supabase writes, commits, pushes, or deployment were performed.

## Stage 3 — operational management

- Added operational pages for Purchases, Sales, Expenses, Finance, and Profit using the existing authenticated shell, schema, RLS, and audited vehicle/contribution RPC. Financial writes are shown only to an active Super Admin; other active roles receive read-only data subject to database RLS, with investor views limited to permitted records.
- Purchases record new showroom or consignment vehicles and partner/investor contributions; contribution totals are checked against purchase price and consignment vehicles cannot be recorded as funded purchases. The existing RPC does not support editing an existing vehicle as a purchase, mixed partner/investor contributions, or third-party funding.
- Sales are recorded as pending; payment rows are separate from the legacy `advance_payment` field, stored balances are checked, and a payment does not automatically complete a sale. Only pending sales can change status through this UI; completed/cancelled sales require an authorized reversal workflow. The schema provides no atomic payment/status RPC, so concurrent payment attempts or partial write/audit failures still require server-side transactional support.
- Vehicle and general expenses support existing categories, dates, payment methods, descriptions, and private PDF receipts. The schema does not provide responsible-person or payment-status fields. Finance separates source tables and does not infer a consolidated cash balance or classify free-text transaction types as inflows/outflows. Profit is read-only and uses approved stored calculations and distributions; no formula, approval, or distribution is created.
- Existing vehicle profiles remain the vehicle-history entry point. Pages use their existing vehicle links and do not replace profile behavior.
- No migration, RLS policy, funding rule, profit formula, production data, or environment file was changed. Role-specific authenticated flows remain unverified without authorized test accounts. Operational histories currently rely on the Supabase API response cap and do not have server-side pagination/aggregation; large-history totals may be incomplete.

## Stage 4 — reporting, statements, and exports

- Replaced the Reports placeholder with 14 report options: sales, inventory, purchases, customer payments, outstanding balances, vehicle/showroom expenses, partner performance, investor statement, profit/distributions, vehicle aging, finance transactions, monthly business summary, and custom reports.
- Added report-specific date fields and preset/custom ranges, relevant record filters, paginated previews, applied-filter summaries, custom columns, and sorting. Supabase reads are paginated in 500-row batches; long ID filters are split into bounded batches. RLS remains authoritative.
- Added UTF-8 CSV export with BOM, escaped values, selected columns and filters, report metadata/notes, and all loaded matching records. Added lazy-loaded branded PDF export with repeated table headers, wide-table page splitting, and page numbers.
- Partner statements use the signed-in partner ID unless Super Admin; investor statements use the signed-in investor ID unless Super Admin. Investor reports do not query sales or other investors' records. Statements include only approved profit allocations and their recorded payments; no personal profit formula is calculated.
- Monthly summaries compare source-table records with the prior month where available and clearly distinguish revenue, payments, contributions, expenses, approved profit, distribution payments, and other recorded transactions. Missing historical inventory snapshots, itemized purchase expenses, and reconciled cash balances are explicitly unavailable.
- Existing limitations remain: Stage 3 does not support mixed or third-party funding or atomic financial posting. Investor-associated sale details are unavailable under current investor row permissions. Historical balances/statuses cannot be reconstructed, and large exports are held in browser memory after paginated reads.
- No migration, RLS policy, production record, or financial calculation was changed. The `jspdf` and `jspdf-autotable` packages were added; their code is loaded only when exporting a PDF.
- Verification: `npm run build` passes. `npm run lint` exits successfully with React effect warnings in existing pages and the report data-loading effects. Focused CSV escaping and date-boundary checks pass; `git diff --check` passes. No live Supabase writes were performed. Local smoke testing showed the authenticated Reports route with all 14 report options; partner/investor account behavior and PDF generation with long live records remain unverified.

## Dashboard visual charts and live refresh

- Expanded the executive dashboard with responsive sales, vehicle/showroom expense, unsold inventory status, and capital activity charts. Investor views show only their own investment activity and funded vehicle portfolio; shared showroom roles see the contribution totals allowed by their existing RLS.
- Redesigned the dashboard around a compact charcoal navigation shell, four primary KPI cards, quick date presets, and a large Sales/Funding chart switcher. When the selected period has no sales activity but does have funding records, the main chart opens on recorded funding; neither view fabricates data. Supporting expense, inventory, aging, financial, and role-scoped statement views remain available below.
- Adopted the reference dashboard's charcoal surfaces with violet/blue chart accents while retaining TrueLine branding, responsive navigation, live refresh, existing role permissions, and source-data calculations. The Horizon project is a visual reference only; the implementation uses TrueLine's existing React, CSS, and Recharts stack and contains no copied template code.
- Replaced the authenticated app's left sidebar with a sticky horizontal, grouped site-navigation header across Dashboard and operational pages. Refined shared top-bar controls, navigation icon states, buttons, section headings, and inventory cards; the mobile header keeps a horizontally scrollable navigation row without page-level horizontal overflow.
- Chart date ranges now display complete daily/monthly buckets, and All time uses a clearly labeled last-12-month chart window. Sales revenue, customer payments, expenses, and capital remain separate measures.
- Added Supabase Realtime listeners for authorized dashboard source tables, debounced refreshes when records change, a live-channel/last-sync indicator, and a visibility-based refresh fallback. Realtime events only trigger a fresh RLS-scoped read; event payloads are not rendered or retained.
- Live table events depend on the tables being enabled for Supabase Realtime. If unavailable, the dashboard indicates the channel is offline and retains manual refresh. No schema/RLS migration or production data change was made.
- Verification: production build and lint pass (lint reports existing and newly added React state-in-effect warnings); final visual testing with authenticated role accounts is pending.
