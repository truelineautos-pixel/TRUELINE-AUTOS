# Supabase Setup

This project uses the Supabase anon/publishable key in browser code. Never put a service-role or secret key in a `VITE_` variable.

## Connect a project

1. Create a Supabase project and copy its Project URL and anon/publishable key.
2. Create `.env.local` in the project root with:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_ANON_OR_PUBLISHABLE_KEY
   VITE_APP_NAME=TRUELINE AUTOS
   VITE_DEFAULT_CURRENCY=PKR
   ```

3. In Supabase Dashboard > SQL Editor, run `supabase/migrations/001_init.sql`, `supabase/migrations/002_security_and_auth.sql`, `supabase/migrations/003_vehicle_files.sql`, `supabase/migrations/004_shared_read_access.sql`, `supabase/migrations/005_vehicle_parties.sql`, `supabase/migrations/006_dashboard_read_models.sql`, and `supabase/migrations/007_vehicle_sales_and_holdbacks.sql`, in that order.
4. In Supabase Dashboard > Authentication > Users, create the initial owner account using the intended admin email. The database trigger creates it as inactive `pending`; no privileged key is needed in the app.
5. In SQL Editor, promote that exact account. Replace the email before running:

   ```sql
   update public.profiles
   set role = 'super_admin', is_active = true
   where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
   ```

   Confirm the statement changed exactly one row. Do not send the admin password or any secret key to the application.
6. The approved partner names are Arslan Iqbal, Ali Qasim, Moin, Waheed Iqbal, Rehmat Ali, and Tahir Ali. Check existing rows before adding any names; this project does not seed partner records, and the schema does not enforce unique names.

7. Start the app and sign in with the created admin account. The application cannot connect until `.env.local` contains the real project URL and anon/publishable key.

## Access model and security verification limitation

The RLS migrations limit financial writes to Super Admins pending transactional database functions. Active partners can read shared showroom and financial records. Investors can read only their own contributions, investor-linked financial transactions, distributions, and distribution payments; existing active-user policies also allow showroom catalog, vehicle, and image reads. Investor addresses and notes are stored separately and are visible only to Super Admins and the linked active investor. Super Admin access remains unchanged. Images and documents use separate private buckets; active users may read images, while documents and all uploads are Super Admin-only. Policies have not been tested against a live Supabase project in this workspace. Before production, test anonymous, pending, partner, investor, and Super Admin access using Supabase test users and the SQL editor; verify Storage upload/read boundaries too.

For an existing project where migrations `001`–`005` have already been applied, run `supabase/migrations/006_dashboard_read_models.sql` to add RLS-respecting dashboard aggregates for shared investor funding and an investor's own totals, followed by migration `007` for the vehicle workflow and transactional sales/holdback RPCs. Migration `007` has not been executed against Supabase from this workspace. The new inventory workflow, direct sale, sale payment, purchase holdback, and holdback release features will fail until it is applied. Review and test it in a non-production project before applying it to production. Never use a frontend service-role or secret key.

Migration `007` adds Processing/Repairing/Ready to sell stages, audited repair expenses, direct sale and pending-sale/payment completion flows, and optional seller/buyer payment holdbacks with Super Admin-only audited releases. Direct sales create an approved profit calculation inside the transaction; partner/investor vehicle profit subtracts purchase price, additional purchase costs, and recorded vehicle expenses, while consignment profit subtracts the customer's minimum and keeps expenses separate. Only a Super Admin can perform these writes. Holdback release is manual and requires the Super Admin to confirm the documented condition and enter verification notes. No live database execution or authenticated role testing has been performed for this migration.