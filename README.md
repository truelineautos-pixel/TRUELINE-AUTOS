# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Deploy as Cloudflare Pages

Deploy this repository as a **Pages project connected to GitHub**, not as a Workers static-assets application. Creating a separate Pages project does not require deleting or changing an existing Worker.

1. In Cloudflare, open **Workers & Pages** and select **Create application** > **Pages** > **Connect to Git**.
2. Connect GitHub if prompted, authorize access to `truelineautos-pixel/TRUELINE-AUTOS`, select that repository, then begin setup.
3. Configure the project:

   | Setting | Value |
   | --- | --- |
   | Project name | `trueline-autos` (or an available name) |
   | Production branch | `main` |
   | Framework preset | `React (Vite)` |
   | Root directory | `/` (repository root) |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

4. Before the first production build, add these under **Settings** > **Environment variables** for **Production**:

   - `VITE_SUPABASE_URL`: the existing Supabase project URL.
   - `VITE_SUPABASE_ANON_KEY`: the Supabase publishable key (or legacy anon key).

   Enter values directly in Cloudflare; never commit them or send them in chat. Vite embeds `VITE_` variables in browser assets, so the URL and publishable/anon key are public client configuration, not secrets. Never use a Supabase service-role or secret key here. Keep RLS enabled. If enabling preview deployments, use a separate non-production Supabase project for preview variables.

5. Save and deploy. Cloudflare Pages will build commits pushed to `main` and provide an HTTPS `*.pages.dev` URL. Changes to build environment variables require a new deployment; retry/redeploy after adding or changing them.
6. After the Pages URL exists, configure Supabase Authentication URL settings: set the Pages URL as the Site URL and add it as an allowed redirect URL. Then verify the sign-in page, password reset redirect, and direct route refresh on the public URL.

This is a client-side React Router application. The Vite output has no top-level `404.html`, so Cloudflare Pages' built-in SPA behavior serves the app entry point for client-side routes; no Worker config or `_redirects` file is required. Do not delete the existing Worker as part of this setup.

Cloudflare references: [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/), [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [Pages SPA behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/).
