-- TrueLine Autos core schema foundation

create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role text not null default 'super_admin',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  role_name text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, role_name)
);

create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists investors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vehicle_catalog (
  id uuid primary key default gen_random_uuid(),
  make text not null,
  model text not null,
  variant text,
  year integer,
  created_at timestamptz not null default now(),
  unique (make, model, variant, year)
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_catalog_id uuid references vehicle_catalog(id),
  business_category text not null,
  make text not null,
  model text not null,
  variant text,
  manufacturing_year integer,
  registration_year integer,
  registration_city text,
  registration_number text,
  color text,
  mileage integer,
  engine_capacity numeric,
  transmission text,
  fuel_type text,
  condition text,
  chassis_number text,
  engine_number text,
  status text not null default 'available',
  purchase_date date,
  purchase_price numeric(18,2),
  total_additional_costs numeric(18,2) default 0,
  expected_sale_price numeric(18,2),
  actual_sale_price numeric(18,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists funding_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  source_type text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists funding_contributions (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  partner_id uuid references partners(id),
  investor_id uuid references investors(id),
  amount numeric(18,2) not null,
  contribution_date date not null,
  payment_method text,
  reference_number text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists vehicle_expenses (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  expense_type text not null,
  amount numeric(18,2) not null,
  expense_date date not null,
  payment_method text,
  receipt_url text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null unique references vehicles(id),
  customer_name text not null,
  customer_contact text,
  sale_date date not null,
  selling_price numeric(18,2) not null,
  advance_payment numeric(18,2) default 0,
  remaining_balance numeric(18,2) default 0,
  discount numeric(18,2) default 0,
  notes text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  amount numeric(18,2) not null,
  payment_method text,
  payment_date date not null,
  reference_number text,
  created_at timestamptz not null default now()
);

create table if not exists profit_calculations (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  sale_id uuid references sales(id),
  purchase_cost numeric(18,2) not null,
  approved_expenses numeric(18,2) not null,
  sale_proceeds numeric(18,2) not null,
  other_direct_costs numeric(18,2) default 0,
  net_profit numeric(18,2) not null,
  calculation_json jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists profit_distributions (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id),
  recipient_type text not null,
  recipient_id uuid,
  amount numeric(18,2) not null,
  rule_name text not null,
  approval_status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists distribution_payments (
  id uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references profit_distributions(id) on delete cascade,
  paid_amount numeric(18,2) not null,
  payment_method text,
  payment_date date not null,
  reference_number text,
  created_at timestamptz not null default now()
);

create table if not exists showroom_reserves (
  id uuid primary key default gen_random_uuid(),
  reserve_name text not null default 'Main Reserve',
  current_balance numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reserve_transactions (
  id uuid primary key default gen_random_uuid(),
  reserve_id uuid not null references showroom_reserves(id) on delete cascade,
  transaction_type text not null,
  amount numeric(18,2) not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists general_expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  amount numeric(18,2) not null,
  expense_date date not null,
  payment_method text,
  notes text,
  receipt_url text,
  created_at timestamptz not null default now()
);

create table if not exists financial_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null,
  amount numeric(18,2) not null,
  currency text not null default 'PKR',
  related_vehicle_id uuid references vehicles(id),
  related_partner_id uuid references partners(id),
  related_investor_id uuid references investors(id),
  payment_method text,
  reference_number text,
  created_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  status text not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  approved_by uuid references profiles(id),
  approval_status text not null default 'pending',
  approval_note text,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  action_type text not null,
  entity_type text,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

create table if not exists app_settings (
  id uuid primary key default gen_random_uuid(),
  business_name text not null default 'TRUELINE AUTOS',
  currency text not null default 'PKR',
  date_format text not null default 'DD/MM/YYYY',
  theme text not null default 'luxury-glass',
  background_blur integer default 12,
  background_brightness numeric default 0.78,
  background_opacity numeric default 0.68,
  updated_at timestamptz not null default now()
);

create table if not exists ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  recommendation_type text not null,
  context text,
  insight jsonb,
  confidence numeric default 0,
  generated_at timestamptz not null default now()
);

create table if not exists market_data_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null,
  url text,
  is_active boolean not null default true,
  last_sync_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists market_observations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references market_data_sources(id),
  model text not null,
  market_price numeric(18,2),
  observation_date date,
  notes text,
  created_at timestamptz not null default now()
);

-- Basic indexes
create index if not exists idx_partners_status on partners(status);
create index if not exists idx_investors_status on investors(status);
create index if not exists idx_vehicles_status on vehicles(status);
create index if not exists idx_financial_transactions_type on financial_transactions(transaction_type);
create index if not exists idx_audit_logs_created_at on audit_logs(created_at desc);

-- The actual business logic should be implemented in secure database functions and RLS policies.
-- This file is a foundation for the local migration flow and should be expanded with full policies.
