alter table public.vehicles
  add column if not exists workflow_stage text not null default 'ready_to_sell';

update public.vehicles
set workflow_stage = case
  when status = 'sold' then 'sold'
  when status = 'archived' then 'archived'
  when status = 'repair' then 'repairing'
  when status = 'reserved' then 'reserved'
  else 'ready_to_sell'
end;

alter table public.sales
  drop constraint if exists sales_vehicle_id_key;

create unique index if not exists sales_one_active_vehicle_idx
  on public.sales(vehicle_id)
  where status <> 'cancelled';

alter table public.vehicles
  drop constraint if exists vehicles_workflow_stage_check;

alter table public.vehicles
  add constraint vehicles_workflow_stage_check
  check (workflow_stage in ('processing', 'repairing', 'ready_to_sell', 'reserved', 'sold', 'archived'));

create or replace function public.sync_vehicle_workflow_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'sold' then
    new.workflow_stage := 'sold';
  elsif new.status = 'archived' then
    new.workflow_stage := 'archived';
  elsif new.condition in ('processing', 'repairing', 'ready_to_sell', 'reserved') then
    new.workflow_stage := new.condition;
  elsif new.status = 'repair' then
    new.workflow_stage := 'repairing';
  elsif new.status = 'reserved' then
    new.workflow_stage := 'reserved';
  else
    new.workflow_stage := 'ready_to_sell';
  end if;

  if new.workflow_stage in ('processing', 'reserved') then
    new.status := 'reserved';
  elsif new.workflow_stage = 'repairing' then
    new.status := 'repair';
  elsif new.workflow_stage = 'ready_to_sell' then
    new.status := 'available';
  elsif new.workflow_stage = 'sold' then
    new.status := 'sold';
  else
    new.status := 'archived';
  end if;
  return new;
end;
$$;

drop trigger if exists vehicles_sync_workflow_stage on public.vehicles;
create trigger vehicles_sync_workflow_stage
  before insert or update of status, condition, workflow_stage on public.vehicles
  for each row execute function public.sync_vehicle_workflow_stage();

create table if not exists public.vehicle_payment_holdbacks (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id),
  sale_id uuid unique references public.sales(id),
  transaction_type text not null check (transaction_type in ('purchase', 'sale')),
  deal_amount numeric(18,2) not null check (deal_amount > 0),
  paid_at_start numeric(18,2) not null check (paid_at_start >= 0),
  held_amount numeric(18,2) not null check (held_amount > 0),
  released_amount numeric(18,2) not null default 0 check (released_amount >= 0),
  release_condition text not null,
  initial_payment_method text,
  initial_reference_number text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (paid_at_start + held_amount = deal_amount),
  check (released_amount <= held_amount),
  check ((transaction_type = 'purchase' and sale_id is null) or (transaction_type = 'sale' and sale_id is not null))
);

create index if not exists vehicle_payment_holdbacks_vehicle_id_idx
  on public.vehicle_payment_holdbacks(vehicle_id);

create table if not exists public.vehicle_payment_holdback_releases (
  id uuid primary key default gen_random_uuid(),
  holdback_id uuid not null references public.vehicle_payment_holdbacks(id),
  amount numeric(18,2) not null check (amount > 0),
  payment_date date not null,
  payment_method text,
  reference_number text,
  notes text,
  released_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists vehicle_payment_holdback_releases_holdback_idx
  on public.vehicle_payment_holdback_releases(holdback_id);

alter table public.vehicle_payment_holdbacks enable row level security;
alter table public.vehicle_payment_holdback_releases enable row level security;

drop policy if exists super_admin_all on public.vehicle_payment_holdbacks;
create policy super_admin_all on public.vehicle_payment_holdbacks
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists super_admin_all on public.vehicle_payment_holdback_releases;
create policy super_admin_all on public.vehicle_payment_holdback_releases
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists partners_shared_read on public.vehicle_payment_holdbacks;
create policy partners_shared_read on public.vehicle_payment_holdbacks
  for select to authenticated
  using (
    (select public.is_active_user())
    and (select public.current_partner_id()) is not null
  );

drop policy if exists investors_own_holdbacks_read on public.vehicle_payment_holdbacks;
create policy investors_own_holdbacks_read on public.vehicle_payment_holdbacks
  for select to authenticated
  using (
    (select public.current_investor_id()) is not null
    and exists (
      select 1
      from public.funding_contributions fc
      where fc.vehicle_id = vehicle_payment_holdbacks.vehicle_id
        and fc.investor_id = (select public.current_investor_id())
    )
  );

drop policy if exists partners_shared_read on public.vehicle_payment_holdback_releases;
create policy partners_shared_read on public.vehicle_payment_holdback_releases
  for select to authenticated
  using (
    (select public.is_active_user())
    and (select public.current_partner_id()) is not null
  );

drop policy if exists investors_own_holdback_releases_read on public.vehicle_payment_holdback_releases;
create policy investors_own_holdback_releases_read on public.vehicle_payment_holdback_releases
  for select to authenticated
  using (
    (select public.current_investor_id()) is not null
    and exists (
      select 1
      from public.vehicle_payment_holdbacks h
      join public.funding_contributions fc on fc.vehicle_id = h.vehicle_id
      where h.id = vehicle_payment_holdback_releases.holdback_id
        and fc.investor_id = (select public.current_investor_id())
    )
  );

revoke all on table public.vehicle_payment_holdbacks from public, anon, authenticated;
revoke all on table public.vehicle_payment_holdback_releases from public, anon, authenticated;
grant select on table public.vehicle_payment_holdbacks to authenticated;
grant select on table public.vehicle_payment_holdback_releases to authenticated;

create or replace function public.update_vehicle_workflow(
  p_vehicle_id uuid,
  p_workflow_stage text,
  p_demand numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_stage text;
  next_status text;
  vehicle_category text;
  customer_minimum numeric;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can change vehicle workflow status' using errcode = '42501';
  end if;
  if p_workflow_stage not in ('processing', 'repairing', 'ready_to_sell', 'reserved') then
    raise exception 'Select a valid vehicle workflow status' using errcode = '22023';
  end if;

  select v.workflow_stage, v.business_category, v.expected_sale_price
  into previous_stage, vehicle_category, customer_minimum
  from public.vehicles v
  where v.id = p_vehicle_id
  for update;
  if not found then
    raise exception 'Vehicle not found' using errcode = 'P0002';
  end if;
  if previous_stage in ('sold', 'archived') then
    raise exception 'Sold or archived vehicles cannot return to inventory through this workflow' using errcode = '22023';
  end if;
  if p_workflow_stage = 'ready_to_sell' and vehicle_category = 'consignment'
    and (customer_minimum is null or customer_minimum <= 0) then
    raise exception 'Record the customer minimum before marking this consignment vehicle ready to sell' using errcode = '22023';
  end if;
  if p_workflow_stage = 'ready_to_sell' and vehicle_category <> 'consignment'
    and (p_demand is null or p_demand <= 0) then
    raise exception 'Enter a positive Demand amount before marking the vehicle ready to sell' using errcode = '22023';
  end if;

  next_status := case
    when p_workflow_stage in ('processing', 'reserved') then 'reserved'
    when p_workflow_stage = 'repairing' then 'repair'
    else 'available'
  end;
  update public.vehicles
  set status = next_status,
      condition = p_workflow_stage,
      workflow_stage = p_workflow_stage,
      expected_sale_price = case
        when p_workflow_stage = 'ready_to_sell' and vehicle_category <> 'consignment' then p_demand
        else expected_sale_price
      end,
      updated_at = now()
  where id = p_vehicle_id;

  insert into public.audit_logs (actor_id, action_type, entity_type, entity_id, details)
  values (
    (select auth.uid()),
    'vehicle_workflow_updated',
    'vehicle',
    p_vehicle_id,
    jsonb_build_object('previous_stage', previous_stage, 'workflow_stage', p_workflow_stage)
  );
end;
$$;

create or replace function public.save_vehicle_with_repair_expense(
  p_vehicle_id uuid,
  p_vehicle jsonb,
  p_contributions jsonb,
  p_repair_amount numeric,
  p_repair_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_vehicle_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can save vehicles and repair expenses' using errcode = '42501';
  end if;
  if p_repair_amount is not null and p_repair_amount < 0 then
    raise exception 'Repair cost cannot be negative' using errcode = '22023';
  end if;
  if p_repair_amount > 0 and p_repair_date is null then
    raise exception 'Choose the date for the repair expense' using errcode = '22023';
  end if;

  saved_vehicle_id := public.save_vehicle_with_contributions(p_vehicle_id, p_vehicle, p_contributions);
  if p_repair_amount > 0 then
    insert into public.vehicle_expenses (vehicle_id, expense_type, amount, expense_date, notes)
    values (saved_vehicle_id, 'Repairs', p_repair_amount, p_repair_date, 'Repair cost recorded with vehicle details');
    insert into public.audit_logs (actor_id, action_type, entity_type, entity_id, details)
    values (
      (select auth.uid()), 'vehicle_repair_expense_recorded', 'vehicle', saved_vehicle_id,
      jsonb_build_object('amount', p_repair_amount, 'expense_date', p_repair_date)
    );
  end if;
  return saved_vehicle_id;
end;
$$;

create or replace function public.create_purchase_with_holdback(
  p_vehicle jsonb,
  p_contributions jsonb,
  p_held_amount numeric,
  p_release_condition text,
  p_payment_method text,
  p_reference_number text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_vehicle_id uuid;
  purchase_amount numeric(18,2);
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can record vehicle purchases' using errcode = '42501';
  end if;
  if p_held_amount is null or p_held_amount <= 0 or p_held_amount <> round(p_held_amount, 2) then
    raise exception 'The held amount must be positive' using errcode = '22023';
  end if;
  if nullif(btrim(p_release_condition), '') is null then
    raise exception 'Enter the document or condition required before releasing the held amount' using errcode = '22023';
  end if;

  saved_vehicle_id := public.save_vehicle_with_contributions(null, p_vehicle, p_contributions);
  select v.purchase_price into purchase_amount
  from public.vehicles v
  where v.id = saved_vehicle_id
  for update;
  if purchase_amount is null or p_held_amount > purchase_amount then
    raise exception 'Held amount cannot exceed the vehicle purchase price' using errcode = '22023';
  end if;

  insert into public.vehicle_payment_holdbacks (
    vehicle_id, transaction_type, deal_amount, paid_at_start, held_amount,
    release_condition, initial_payment_method, initial_reference_number, created_by
  )
  values (
    saved_vehicle_id, 'purchase', purchase_amount, purchase_amount - p_held_amount, p_held_amount,
    btrim(p_release_condition), nullif(btrim(p_payment_method), ''),
    nullif(btrim(p_reference_number), ''), (select auth.uid())
  );

  insert into public.audit_logs (actor_id, action_type, entity_type, entity_id, details)
  values (
    (select auth.uid()), 'purchase_holdback_created', 'vehicle', saved_vehicle_id,
    jsonb_build_object(
      'purchase_amount', purchase_amount,
      'paid_at_start', purchase_amount - p_held_amount,
      'held_amount', p_held_amount,
      'release_condition', btrim(p_release_condition)
    )
  );
  return saved_vehicle_id;
end;
$$;

create or replace function public.record_direct_vehicle_sale(
  p_vehicle_id uuid,
  p_selling_price numeric,
  p_sale_date date,
  p_customer_name text,
  p_customer_contact text,
  p_held_amount numeric,
  p_release_condition text,
  p_payment_method text,
  p_reference_number text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  vehicle_row public.vehicles%rowtype;
  saved_sale_id uuid;
  recorded_vehicle_expenses numeric(18,2);
  purchase_cost numeric(18,2);
  approved_expenses numeric(18,2);
  other_direct_costs numeric(18,2);
  net_profit numeric(18,2);
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can mark a vehicle sold' using errcode = '42501';
  end if;
  if p_selling_price is null or p_selling_price <= 0 or p_selling_price <> round(p_selling_price, 2) or p_sale_date is null
    or nullif(btrim(p_customer_name), '') is null then
    raise exception 'Enter a positive sold price with no more than two decimal places, sale date, and customer name' using errcode = '22023';
  end if;
  if p_held_amount is null or p_held_amount < 0 or p_held_amount <> round(p_held_amount, 2) or p_held_amount > p_selling_price then
    raise exception 'Held amount cannot be negative or exceed the sold price' using errcode = '22023';
  end if;
  if p_held_amount > 0 and nullif(btrim(p_release_condition), '') is null then
    raise exception 'Enter the condition required before releasing the held amount' using errcode = '22023';
  end if;

  select v.* into vehicle_row
  from public.vehicles v
  where v.id = p_vehicle_id
  for update;
  if not found then
    raise exception 'Vehicle not found' using errcode = 'P0002';
  end if;
  if vehicle_row.workflow_stage <> 'ready_to_sell' or vehicle_row.status <> 'available' then
    raise exception 'Move the vehicle to Ready to sell before marking it sold' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.sales s
    where s.vehicle_id = p_vehicle_id and s.status <> 'cancelled'
  ) then
    raise exception 'A sale is already recorded for this vehicle' using errcode = '23505';
  end if;
  if vehicle_row.business_category = 'consignment' then
    if vehicle_row.expected_sale_price is null or vehicle_row.expected_sale_price <= 0 then
      raise exception 'Record the customer minimum before selling this consignment vehicle' using errcode = '22023';
    end if;
    if p_selling_price < vehicle_row.expected_sale_price then
      raise exception 'Sold price cannot be below the customer minimum' using errcode = '22023';
    end if;
  elsif vehicle_row.purchase_price is null or vehicle_row.purchase_price < 0 then
    raise exception 'A showroom vehicle needs a recorded purchase price before sale' using errcode = '22023';
  end if;

  select coalesce(sum(e.amount), 0) into recorded_vehicle_expenses
  from public.vehicle_expenses e
  where e.vehicle_id = p_vehicle_id;

  if vehicle_row.business_category = 'consignment' then
    purchase_cost := 0;
    approved_expenses := 0;
    other_direct_costs := vehicle_row.expected_sale_price;
  else
    purchase_cost := vehicle_row.purchase_price;
    approved_expenses := coalesce(vehicle_row.total_additional_costs, 0) + recorded_vehicle_expenses;
    other_direct_costs := 0;
  end if;
  net_profit := p_selling_price - purchase_cost - approved_expenses - other_direct_costs;

  insert into public.sales (
    vehicle_id, customer_name, customer_contact, sale_date, selling_price,
    advance_payment, remaining_balance, status
  )
  values (
    p_vehicle_id, btrim(p_customer_name), nullif(btrim(p_customer_contact), ''),
    p_sale_date, p_selling_price, 0, p_held_amount, 'completed'
  )
  returning id into saved_sale_id;

  if p_selling_price > p_held_amount then
    insert into public.sale_payments (
      sale_id, amount, payment_method, payment_date, reference_number
    )
    values (
      saved_sale_id, p_selling_price - p_held_amount,
      nullif(btrim(p_payment_method), ''), p_sale_date,
      nullif(btrim(p_reference_number), '')
    );
  end if;

  update public.vehicles
  set status = 'sold',
      workflow_stage = 'sold',
      actual_sale_price = p_selling_price,
      updated_at = now()
  where id = p_vehicle_id;

  insert into public.profit_calculations (
    vehicle_id, sale_id, purchase_cost, approved_expenses, sale_proceeds,
    other_direct_costs, net_profit, calculation_json, status
  )
  values (
    p_vehicle_id, saved_sale_id, purchase_cost, approved_expenses, p_selling_price,
    other_direct_costs, net_profit,
    jsonb_build_object(
      'formula', case
        when vehicle_row.business_category = 'consignment'
          then 'sale_proceeds - customer_minimum'
        else 'sale_proceeds - purchase_cost - total_additional_costs - recorded_vehicle_expenses'
      end,
      'business_category', vehicle_row.business_category,
      'customer_minimum', case
        when vehicle_row.business_category = 'consignment' then vehicle_row.expected_sale_price
        else null
      end,
      'total_additional_costs', case
        when vehicle_row.business_category <> 'consignment' then coalesce(vehicle_row.total_additional_costs, 0)
        else null
      end,
      'recorded_vehicle_expenses', recorded_vehicle_expenses,
      'profit_amount', net_profit
    ),
    'approved'
  );

  if p_held_amount > 0 then
    insert into public.vehicle_payment_holdbacks (
      vehicle_id, sale_id, transaction_type, deal_amount, paid_at_start,
      held_amount, release_condition, initial_payment_method,
      initial_reference_number, created_by
    )
    values (
      p_vehicle_id, saved_sale_id, 'sale', p_selling_price,
      p_selling_price - p_held_amount, p_held_amount, btrim(p_release_condition),
      nullif(btrim(p_payment_method), ''), nullif(btrim(p_reference_number), ''),
      (select auth.uid())
    );
  end if;

  insert into public.audit_logs (actor_id, action_type, entity_type, entity_id, details)
  values (
    (select auth.uid()), 'vehicle_marked_sold', 'sale', saved_sale_id,
    jsonb_build_object(
      'vehicle_id', p_vehicle_id,
      'selling_price', p_selling_price,
      'paid_at_start', p_selling_price - p_held_amount,
      'held_amount', p_held_amount,
      'customer_name', btrim(p_customer_name),
      'sale_date', p_sale_date,
      'net_profit', net_profit,
      'calculation_status', 'approved'
    )
  );
  return saved_sale_id;
end;
$$;

create or replace function public.record_pending_vehicle_sale(
  p_vehicle_id uuid,
  p_selling_price numeric,
  p_sale_date date,
  p_customer_name text,
  p_customer_contact text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  vehicle_row public.vehicles%rowtype;
  saved_sale_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can record vehicle sales' using errcode = '42501';
  end if;
  if p_selling_price is null or p_selling_price <= 0 or p_selling_price <> round(p_selling_price, 2) or p_sale_date is null
    or nullif(btrim(p_customer_name), '') is null then
    raise exception 'Enter a positive sale price with no more than two decimal places, sale date, and customer name' using errcode = '22023';
  end if;

  select v.* into vehicle_row
  from public.vehicles v
  where v.id = p_vehicle_id
  for update;
  if not found then
    raise exception 'Vehicle not found' using errcode = 'P0002';
  end if;
  if vehicle_row.workflow_stage <> 'ready_to_sell' or vehicle_row.status <> 'available' then
    raise exception 'Move the vehicle to Ready to sell before recording its sale' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.sales s
    where s.vehicle_id = p_vehicle_id and s.status <> 'cancelled'
  ) then
    raise exception 'An active sale is already recorded for this vehicle' using errcode = '23505';
  end if;
  if vehicle_row.business_category = 'consignment' then
    if vehicle_row.expected_sale_price is null or vehicle_row.expected_sale_price <= 0 then
      raise exception 'Record the customer minimum before selling this consignment vehicle' using errcode = '22023';
    end if;
    if p_selling_price < vehicle_row.expected_sale_price then
      raise exception 'Sale price cannot be below the customer minimum' using errcode = '22023';
    end if;
  elsif vehicle_row.purchase_price is null or vehicle_row.purchase_price < 0 then
    raise exception 'A showroom vehicle needs a recorded purchase price before sale' using errcode = '22023';
  end if;

  insert into public.sales (
    vehicle_id, customer_name, customer_contact, sale_date, selling_price,
    advance_payment, remaining_balance, status
  )
  values (
    p_vehicle_id, btrim(p_customer_name), nullif(btrim(p_customer_contact), ''),
    p_sale_date, p_selling_price, 0, p_selling_price, 'pending'
  )
  returning id into saved_sale_id;
  insert into public.audit_logs (actor_id, action_type, entity_type, entity_id, details)
  values (
    (select auth.uid()), 'sale_recorded', 'sale', saved_sale_id,
    jsonb_build_object(
      'vehicle_id', p_vehicle_id,
      'sale_date', p_sale_date,
      'selling_price', p_selling_price,
      'status', 'pending'
    )
  );
  return saved_sale_id;
end;
$$;

create or replace function public.record_vehicle_sale_payment(
  p_sale_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_method text,
  p_reference_number text
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale_row public.sales%rowtype;
  new_remaining_balance numeric(18,2);
  payment_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can record customer payments' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_payment_date is null then
    raise exception 'Enter a positive payment amount and payment date' using errcode = '22023';
  end if;
  select s.* into sale_row
  from public.sales s
  where s.id = p_sale_id
  for update;
  if not found then
    raise exception 'Sale not found' using errcode = 'P0002';
  end if;
  if sale_row.status <> 'pending' or sale_row.remaining_balance is null then
    raise exception 'Only pending sales with a recorded balance can accept customer payments' using errcode = '22023';
  end if;
  if p_amount > sale_row.remaining_balance then
    raise exception 'Payment exceeds the stored outstanding balance' using errcode = '22023';
  end if;

  new_remaining_balance := sale_row.remaining_balance - p_amount;
  insert into public.sale_payments (
    sale_id, amount, payment_method, payment_date, reference_number
  )
  values (
    p_sale_id, p_amount, nullif(btrim(p_payment_method), ''),
    p_payment_date, nullif(btrim(p_reference_number), '')
  )
  returning id into payment_id;
  update public.sales
  set remaining_balance = new_remaining_balance, updated_at = now()
  where id = p_sale_id;
  insert into public.audit_logs (actor_id, action_type, entity_type, entity_id, details)
  values (
    (select auth.uid()), 'customer_payment_recorded', 'sale_payment', payment_id,
    jsonb_build_object(
      'sale_id', p_sale_id,
      'amount', p_amount,
      'remaining_balance', new_remaining_balance
    )
  );
  return new_remaining_balance;
end;
$$;

create or replace function public.cancel_pending_vehicle_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale_row public.sales%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can cancel vehicle sales' using errcode = '42501';
  end if;
  select s.* into sale_row
  from public.sales s
  where s.id = p_sale_id
  for update;
  if not found then
    raise exception 'Sale not found' using errcode = 'P0002';
  end if;
  if sale_row.status <> 'pending' then
    raise exception 'Only a pending sale can be cancelled' using errcode = '22023';
  end if;
  if sale_row.remaining_balance is null
    or sale_row.remaining_balance <> sale_row.selling_price
    or coalesce(sale_row.advance_payment, 0) <> 0
    or exists (select 1 from public.sale_payments sp where sp.sale_id = p_sale_id) then
    raise exception 'A sale with recorded customer payments cannot be cancelled without an audited refund workflow' using errcode = '22023';
  end if;
  update public.sales
  set status = 'cancelled', updated_at = now()
  where id = p_sale_id;
  insert into public.audit_logs (actor_id, action_type, entity_type, entity_id, details)
  values (
    (select auth.uid()), 'sale_status_updated', 'sale', p_sale_id,
    jsonb_build_object('previous_status', sale_row.status, 'status', 'cancelled')
  );
end;
$$;

create or replace function public.complete_pending_vehicle_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale_row public.sales%rowtype;
  vehicle_row public.vehicles%rowtype;
  recorded_vehicle_expenses numeric(18,2);
  purchase_cost numeric(18,2);
  approved_expenses numeric(18,2);
  other_direct_costs numeric(18,2);
  net_profit numeric(18,2);
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can complete vehicle sales' using errcode = '42501';
  end if;

  select s.* into sale_row
  from public.sales s
  where s.id = p_sale_id
  for update;
  if not found then
    raise exception 'Sale not found' using errcode = 'P0002';
  end if;
  if sale_row.status <> 'pending' then
    raise exception 'Only a pending sale can be completed' using errcode = '22023';
  end if;
  if sale_row.remaining_balance is null or sale_row.remaining_balance <> 0 then
    raise exception 'A sale cannot be completed while its stored balance is outstanding or unavailable' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.sales s
    where s.vehicle_id = sale_row.vehicle_id
      and s.id <> p_sale_id
      and s.status <> 'cancelled'
  ) then
    raise exception 'Another active sale is already recorded for this vehicle' using errcode = '23505';
  end if;

  select v.* into vehicle_row
  from public.vehicles v
  where v.id = sale_row.vehicle_id
  for update;
  if not found then
    raise exception 'Vehicle not found' using errcode = 'P0002';
  end if;
  if vehicle_row.workflow_stage <> 'ready_to_sell' or vehicle_row.status <> 'available' then
    raise exception 'Move the vehicle to Ready to sell before completing its sale' using errcode = '22023';
  end if;
  if vehicle_row.business_category = 'consignment' then
    if vehicle_row.expected_sale_price is null or vehicle_row.expected_sale_price <= 0 then
      raise exception 'Record the customer minimum before selling this consignment vehicle' using errcode = '22023';
    end if;
    if sale_row.selling_price < vehicle_row.expected_sale_price then
      raise exception 'Sold price cannot be below the customer minimum' using errcode = '22023';
    end if;
  elsif vehicle_row.purchase_price is null or vehicle_row.purchase_price < 0 then
    raise exception 'A showroom vehicle needs a recorded purchase price before sale' using errcode = '22023';
  end if;
  if exists (select 1 from public.profit_calculations pc where pc.sale_id = p_sale_id) then
    raise exception 'A profit calculation already exists for this sale' using errcode = '23505';
  end if;

  select coalesce(sum(e.amount), 0) into recorded_vehicle_expenses
  from public.vehicle_expenses e
  where e.vehicle_id = sale_row.vehicle_id;

  if vehicle_row.business_category = 'consignment' then
    purchase_cost := 0;
    approved_expenses := 0;
    other_direct_costs := vehicle_row.expected_sale_price;
  else
    purchase_cost := vehicle_row.purchase_price;
    approved_expenses := coalesce(vehicle_row.total_additional_costs, 0) + recorded_vehicle_expenses;
    other_direct_costs := 0;
  end if;
  net_profit := sale_row.selling_price - purchase_cost - approved_expenses - other_direct_costs;

  update public.sales
  set status = 'completed', updated_at = now()
  where id = p_sale_id;
  update public.vehicles
  set status = 'sold',
      workflow_stage = 'sold',
      actual_sale_price = sale_row.selling_price,
      updated_at = now()
  where id = sale_row.vehicle_id;

  insert into public.profit_calculations (
    vehicle_id, sale_id, purchase_cost, approved_expenses, sale_proceeds,
    other_direct_costs, net_profit, calculation_json, status
  )
  values (
    sale_row.vehicle_id, p_sale_id, purchase_cost, approved_expenses,
    sale_row.selling_price, other_direct_costs, net_profit,
    jsonb_build_object(
      'formula', case
        when vehicle_row.business_category = 'consignment'
          then 'sale_proceeds - customer_minimum'
        else 'sale_proceeds - purchase_cost - total_additional_costs - recorded_vehicle_expenses'
      end,
      'business_category', vehicle_row.business_category,
      'customer_minimum', case
        when vehicle_row.business_category = 'consignment' then vehicle_row.expected_sale_price
        else null
      end,
      'total_additional_costs', case
        when vehicle_row.business_category <> 'consignment' then coalesce(vehicle_row.total_additional_costs, 0)
        else null
      end,
      'recorded_vehicle_expenses', recorded_vehicle_expenses,
      'profit_amount', net_profit
    ),
    'approved'
  );
  insert into public.audit_logs (actor_id, action_type, entity_type, entity_id, details)
  values (
    (select auth.uid()), 'pending_vehicle_sale_completed', 'sale', p_sale_id,
    jsonb_build_object(
      'vehicle_id', sale_row.vehicle_id,
      'selling_price', sale_row.selling_price,
      'sale_date', sale_row.sale_date,
      'net_profit', net_profit,
      'calculation_status', 'approved'
    )
  );
end;
$$;

create or replace function public.release_vehicle_payment_holdback(
  p_holdback_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_method text,
  p_reference_number text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hold_row public.vehicle_payment_holdbacks%rowtype;
  remaining_held numeric(18,2);
  sale_balance numeric(18,2);
  release_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can release held payments' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_payment_date is null then
    raise exception 'Enter a positive release amount and payment date' using errcode = '22023';
  end if;

  select h.* into hold_row
  from public.vehicle_payment_holdbacks h
  where h.id = p_holdback_id
  for update;
  if not found then
    raise exception 'Held payment record not found' using errcode = 'P0002';
  end if;
  remaining_held := hold_row.held_amount - hold_row.released_amount;
  if p_amount > remaining_held then
    raise exception 'Release amount cannot exceed the remaining held balance' using errcode = '22023';
  end if;

  if hold_row.transaction_type = 'sale' then
    select s.remaining_balance into sale_balance
    from public.sales s
    where s.id = hold_row.sale_id
    for update;
    if sale_balance is null or p_amount > sale_balance then
      raise exception 'Release amount exceeds the sale’s stored outstanding balance' using errcode = '22023';
    end if;
    insert into public.sale_payments (
      sale_id, amount, payment_method, payment_date, reference_number
    )
    values (
      hold_row.sale_id, p_amount, nullif(btrim(p_payment_method), ''),
      p_payment_date, nullif(btrim(p_reference_number), '')
    );
    update public.sales
    set remaining_balance = sale_balance - p_amount,
        updated_at = now()
    where id = hold_row.sale_id;
  end if;

  insert into public.vehicle_payment_holdback_releases (
    holdback_id, amount, payment_date, payment_method, reference_number, notes, released_by
  )
  values (
    p_holdback_id, p_amount, p_payment_date, nullif(btrim(p_payment_method), ''),
    nullif(btrim(p_reference_number), ''), nullif(btrim(p_notes), ''), (select auth.uid())
  )
  returning id into release_id;

  update public.vehicle_payment_holdbacks
  set released_amount = released_amount + p_amount,
      updated_at = now()
  where id = p_holdback_id;

  insert into public.audit_logs (actor_id, action_type, entity_type, entity_id, details)
  values (
    (select auth.uid()), 'vehicle_payment_holdback_released', 'vehicle_payment_holdback',
    p_holdback_id,
    jsonb_build_object(
      'release_id', release_id,
      'transaction_type', hold_row.transaction_type,
      'vehicle_id', hold_row.vehicle_id,
      'sale_id', hold_row.sale_id,
      'amount', p_amount,
      'remaining_held', remaining_held - p_amount,
      'payment_date', p_payment_date
    )
  );
  return release_id;
end;
$$;

revoke all on function public.sync_vehicle_workflow_stage() from public, anon, authenticated;
revoke all on function public.update_vehicle_workflow(uuid, text, numeric) from public, anon;
revoke all on function public.save_vehicle_with_repair_expense(uuid, jsonb, jsonb, numeric, date) from public, anon;
revoke all on function public.create_purchase_with_holdback(jsonb, jsonb, numeric, text, text, text) from public, anon;
revoke all on function public.record_direct_vehicle_sale(uuid, numeric, date, text, text, numeric, text, text, text) from public, anon;
revoke all on function public.record_pending_vehicle_sale(uuid, numeric, date, text, text) from public, anon;
revoke all on function public.record_vehicle_sale_payment(uuid, numeric, date, text, text) from public, anon;
revoke all on function public.cancel_pending_vehicle_sale(uuid) from public, anon;
revoke all on function public.complete_pending_vehicle_sale(uuid) from public, anon;
revoke all on function public.release_vehicle_payment_holdback(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function public.update_vehicle_workflow(uuid, text, numeric) to authenticated;
grant execute on function public.save_vehicle_with_repair_expense(uuid, jsonb, jsonb, numeric, date) to authenticated;
grant execute on function public.create_purchase_with_holdback(jsonb, jsonb, numeric, text, text, text) to authenticated;
grant execute on function public.record_direct_vehicle_sale(uuid, numeric, date, text, text, numeric, text, text, text) to authenticated;
grant execute on function public.record_pending_vehicle_sale(uuid, numeric, date, text, text) to authenticated;
grant execute on function public.record_vehicle_sale_payment(uuid, numeric, date, text, text) to authenticated;
grant execute on function public.cancel_pending_vehicle_sale(uuid) to authenticated;
grant execute on function public.complete_pending_vehicle_sale(uuid) to authenticated;
grant execute on function public.release_vehicle_payment_holdback(uuid, numeric, date, text, text, text) to authenticated;
