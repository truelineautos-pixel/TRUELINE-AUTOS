-- Establish a secure default access model for the initial Supabase rollout.
-- Finance mutation remains Super Admin-only until approved transactional RPCs exist.

alter table public.profiles
  alter column role set default 'pending',
  alter column is_active set default false;

alter table public.profiles
  add column if not exists partner_id uuid references public.partners(id),
  add column if not exists investor_id uuid references public.investors(id);

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('pending', 'super_admin', 'partner', 'investor'));

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.role <> 'pending'
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.role = 'super_admin'
  );
$$;

create or replace function public.current_partner_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.partner_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active = true
    and p.role = 'partner'
  limit 1;
$$;

create or replace function public.current_investor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.investor_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active = true
    and p.role = 'investor'
  limit 1;
$$;

revoke all on function public.is_active_user() from public, anon;
revoke all on function public.is_super_admin() from public, anon;
revoke all on function public.current_partner_id() from public, anon;
revoke all on function public.current_investor_id() from public, anon;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.current_partner_id() to authenticated;
grant execute on function public.current_investor_id() to authenticated;

create or replace function public.create_pending_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role, is_active)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    'pending',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_pending_profile();

do $$
declare
  table_name text;
  protected_tables text[] := array[
    'profiles', 'user_roles', 'partners', 'investors', 'vehicle_catalog', 'vehicles',
    'funding_sources', 'funding_contributions', 'vehicle_expenses', 'sales',
    'sale_payments', 'profit_calculations', 'profit_distributions',
    'distribution_payments', 'showroom_reserves', 'reserve_transactions',
    'general_expenses', 'financial_transactions', 'approvals', 'audit_logs',
    'app_settings', 'ai_recommendations', 'market_data_sources', 'market_observations'
  ];
begin
  foreach table_name in array protected_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists super_admin_all on public.%I', table_name);
    execute format(
      'create policy super_admin_all on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())',
      table_name
    );
  end loop;
end;
$$;

drop policy if exists profiles_read_self on public.profiles;
create policy profiles_read_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists user_roles_read_self on public.user_roles;
create policy user_roles_read_self on public.user_roles
  for select to authenticated using (profile_id = (select auth.uid()));

drop policy if exists partners_read_active on public.partners;
create policy partners_read_active on public.partners
  for select to authenticated using (public.is_active_user());

drop policy if exists investors_read_self on public.investors;
create policy investors_read_self on public.investors
  for select to authenticated
  using (id = (select public.current_investor_id()));

drop policy if exists vehicle_catalog_read_active on public.vehicle_catalog;
create policy vehicle_catalog_read_active on public.vehicle_catalog
  for select to authenticated using (public.is_active_user());

drop policy if exists vehicles_read_active on public.vehicles;
create policy vehicles_read_active on public.vehicles
  for select to authenticated using (public.is_active_user());

drop policy if exists funding_sources_read_active on public.funding_sources;
create policy funding_sources_read_active on public.funding_sources
  for select to authenticated using (public.is_active_user());

drop policy if exists app_settings_read_active on public.app_settings;
create policy app_settings_read_active on public.app_settings
  for select to authenticated using (public.is_active_user());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('vehicle-images', 'vehicle-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('vehicle-documents', 'vehicle-documents', false, 20971520, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists vehicle_images_read_active on storage.objects;
create policy vehicle_images_read_active on storage.objects
  for select to authenticated
  using (bucket_id = 'vehicle-images' and public.is_active_user());

drop policy if exists vehicle_images_insert_admin on storage.objects;
create policy vehicle_images_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vehicle-images' and public.is_super_admin());

drop policy if exists vehicle_images_update_admin on storage.objects;
create policy vehicle_images_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'vehicle-images' and public.is_super_admin())
  with check (bucket_id = 'vehicle-images' and public.is_super_admin());

drop policy if exists vehicle_images_delete_admin on storage.objects;
create policy vehicle_images_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'vehicle-images' and public.is_super_admin());

drop policy if exists vehicle_documents_admin_all on storage.objects;
create policy vehicle_documents_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'vehicle-documents' and public.is_super_admin())
  with check (bucket_id = 'vehicle-documents' and public.is_super_admin());