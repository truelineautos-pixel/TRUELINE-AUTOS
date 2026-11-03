create table if not exists public.vehicle_files (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  storage_bucket text not null check (storage_bucket in ('vehicle-images', 'vehicle-documents')),
  object_path text not null unique,
  file_name text not null,
  content_type text not null,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicle_files_vehicle_id on public.vehicle_files(vehicle_id);
alter table public.vehicle_files enable row level security;

drop policy if exists vehicle_files_admin_all on public.vehicle_files;
create policy vehicle_files_admin_all on public.vehicle_files
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists vehicle_images_metadata_read_active on public.vehicle_files;
create policy vehicle_images_metadata_read_active on public.vehicle_files
  for select to authenticated
  using (storage_bucket = 'vehicle-images' and public.is_active_user());