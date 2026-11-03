alter table public.vehicles
  add column if not exists customer_name text,
  add column if not exists customer_contact text;

create table if not exists public.investor_private_details (
  investor_id uuid primary key references public.investors(id) on delete cascade,
  address text,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.investor_private_details enable row level security;

drop policy if exists super_admin_all on public.investor_private_details;
create policy super_admin_all on public.investor_private_details
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists investor_private_details_read_self on public.investor_private_details;
create policy investor_private_details_read_self on public.investor_private_details
  for select to authenticated
  using (investor_id = (select public.current_investor_id()));

grant select on table public.investor_private_details to authenticated;

create index if not exists idx_funding_contributions_partner_vehicle
  on public.funding_contributions(partner_id, vehicle_id);
create index if not exists idx_funding_contributions_investor_vehicle
  on public.funding_contributions(investor_id, vehicle_id);

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
      and (
        p.role = 'super_admin'
        or (
          p.role = 'partner'
          and exists (
            select 1
            from public.partners partner
            where partner.id = p.partner_id
              and partner.status = 'active'
          )
        )
        or (
          p.role = 'investor'
          and exists (
            select 1
            from public.investors investor
            where investor.id = p.investor_id
              and investor.status = 'active'
          )
        )
      )
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
  join public.partners partner on partner.id = p.partner_id
  where p.id = (select auth.uid())
    and p.is_active = true
    and p.role = 'partner'
    and partner.status = 'active'
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
  join public.investors investor on investor.id = p.investor_id
  where p.id = (select auth.uid())
    and p.is_active = true
    and p.role = 'investor'
    and investor.status = 'active'
  limit 1;
$$;

revoke all on function public.is_active_user() from public, anon;
revoke all on function public.current_partner_id() from public, anon;
revoke all on function public.current_investor_id() from public, anon;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.current_partner_id() to authenticated;
grant execute on function public.current_investor_id() to authenticated;

create or replace function public.manage_investor(
  p_investor_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_address text,
  p_notes text,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can manage investors' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Investor name is required' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'Investor status must be active or inactive' using errcode = '22023';
  end if;

  if p_investor_id is null then
    insert into public.investors (name, email, phone, status)
    values (
      btrim(p_name), nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''), p_status
    )
    returning id into saved_id;
  else
    update public.investors
    set name = btrim(p_name),
        email = nullif(btrim(p_email), ''),
        phone = nullif(btrim(p_phone), ''),
        status = p_status,
        updated_at = now()
    where id = p_investor_id
    returning id into saved_id;
    if saved_id is null then
      raise exception 'Investor not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.investor_private_details (investor_id, address, notes)
  values (saved_id, nullif(btrim(p_address), ''), nullif(btrim(p_notes), ''))
  on conflict (investor_id) do update
  set address = excluded.address,
      notes = excluded.notes,
      updated_at = now();

  insert into public.audit_logs (actor_id, action_type, entity_type, entity_id, details)
  values (
    (select auth.uid()),
    case when p_investor_id is null then 'investor_created' else 'investor_updated' end,
    'investor',
    saved_id,
    jsonb_build_object('status', p_status)
  );
  return saved_id;
end;
$$;

create or replace function public.manage_partner(
  p_partner_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can manage partners' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Partner name is required' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'Partner status must be active or inactive' using errcode = '22023';
  end if;

  if p_partner_id is null then
    insert into public.partners (name, email, phone, status)
    values (btrim(p_name), nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''), p_status)
    returning id into saved_id;
  else
    update public.partners
    set name = btrim(p_name),
        email = nullif(btrim(p_email), ''),
        phone = nullif(btrim(p_phone), ''),
        status = p_status,
        updated_at = now()
    where id = p_partner_id
    returning id into saved_id;
    if saved_id is null then
      raise exception 'Partner not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_logs (actor_id, action_type, entity_type, entity_id, details)
  values (
    (select auth.uid()),
    case when p_partner_id is null then 'partner_created' else 'partner_updated' end,
    'partner',
    saved_id,
    jsonb_build_object('status', p_status)
  );
  return saved_id;
end;
$$;

create or replace function public.save_vehicle_with_contributions(
  p_vehicle_id uuid,
  p_vehicle jsonb,
  p_contributions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  category text;
  vehicle_purchase_price numeric;
  existing_category text;
  existing_contributions numeric := 0;
  existing_contribution_count bigint := 0;
  added_contributions numeric := 0;
  contribution jsonb;
  contribution_partner_id uuid;
  contribution_investor_id uuid;
  contribution_amount numeric;
  contribution_date date;
  contributor_count bigint;
  saved_purchase_price numeric;
  saved_additional_costs numeric;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can save vehicles and funding' using errcode = '42501';
  end if;
  if p_vehicle is null or p_contributions is null
    or jsonb_typeof(p_vehicle) <> 'object'
    or jsonb_typeof(p_contributions) <> 'array' then
    raise exception 'Vehicle details and contribution list are required' using errcode = '22023';
  end if;

  category := p_vehicle ->> 'business_category';
  if category is null or category not in ('partner', 'investor', 'consignment') then
    raise exception 'Unsupported vehicle category' using errcode = '22023';
  end if;
  if coalesce(nullif(p_vehicle ->> 'status', ''), 'available')
    not in ('available', 'reserved', 'repair', 'sold', 'archived') then
    raise exception 'Unsupported vehicle status' using errcode = '22023';
  end if;
  if nullif(btrim(p_vehicle ->> 'make'), '') is null
    or nullif(btrim(p_vehicle ->> 'model'), '') is null then
    raise exception 'Vehicle make and model are required' using errcode = '22023';
  end if;
  vehicle_purchase_price := nullif(p_vehicle ->> 'purchase_price', '')::numeric;
  if category in ('partner', 'investor') and vehicle_purchase_price is null then
    raise exception 'Purchase price is required for partner and investor vehicles' using errcode = '22023';
  end if;
  if vehicle_purchase_price is not null and vehicle_purchase_price < 0 then
    raise exception 'Purchase price cannot be negative' using errcode = '22023';
  end if;
  if coalesce(nullif(p_vehicle ->> 'total_additional_costs', '')::numeric, 0) < 0
    or nullif(p_vehicle ->> 'expected_sale_price', '')::numeric < 0
    or nullif(p_vehicle ->> 'actual_sale_price', '')::numeric < 0
    or nullif(p_vehicle ->> 'mileage', '')::integer < 0
    or nullif(p_vehicle ->> 'engine_capacity', '')::numeric < 0 then
    raise exception 'Vehicle prices, mileage, and engine capacity cannot be negative' using errcode = '22023';
  end if;
  if nullif(p_vehicle ->> 'manufacturing_year', '')::integer not between 1900 and 2100
    or nullif(p_vehicle ->> 'registration_year', '')::integer not between 1900 and 2100 then
    if (p_vehicle ? 'manufacturing_year' and p_vehicle ->> 'manufacturing_year' <> '')
      or (p_vehicle ? 'registration_year' and p_vehicle ->> 'registration_year' <> '') then
      raise exception 'Vehicle years must be between 1900 and 2100' using errcode = '22023';
    end if;
  end if;
  if category = 'consignment' and jsonb_array_length(p_contributions) > 0 then
    raise exception 'Customer consignment vehicles cannot have showroom funding contributions' using errcode = '22023';
  end if;
  if category = 'consignment' and (
    vehicle_purchase_price is not null
    or coalesce(nullif(p_vehicle ->> 'total_additional_costs', '')::numeric, 0) > 0
  ) then
    raise exception 'Customer consignment vehicles cannot be recorded as showroom purchase costs' using errcode = '22023';
  end if;
  if category = 'consignment' and nullif(btrim(p_vehicle ->> 'customer_name'), '') is null then
    raise exception 'Customer name is required for a consignment vehicle' using errcode = '22023';
  end if;

  if p_vehicle_id is not null then
    select v.business_category into existing_category
    from public.vehicles v
    where v.id = p_vehicle_id
    for update;
    if not found then
      raise exception 'Vehicle not found' using errcode = 'P0002';
    end if;
    select coalesce(sum(fc.amount), 0) into existing_contributions
    from public.funding_contributions fc
    where fc.vehicle_id = p_vehicle_id;
    select count(*) into existing_contribution_count
    from public.funding_contributions fc
    where fc.vehicle_id = p_vehicle_id;
    if existing_contribution_count > 0 and category <> existing_category then
      raise exception 'A vehicle with funding history cannot change category' using errcode = '22023';
    end if;
    if category = 'consignment' and existing_contribution_count > 0 then
      raise exception 'Customer consignment vehicles cannot have showroom funding contributions' using errcode = '22023';
    end if;
  end if;

  for contribution in select value from jsonb_array_elements(p_contributions)
  loop
    contribution_partner_id := nullif(contribution ->> 'partner_id', '')::uuid;
    contribution_investor_id := nullif(contribution ->> 'investor_id', '')::uuid;
    contribution_amount := nullif(contribution ->> 'amount', '')::numeric;
    contribution_date := nullif(contribution ->> 'contribution_date', '')::date;
    if contribution_amount is null or contribution_amount <= 0 or contribution_date is null then
      raise exception 'Each contribution requires a positive amount and date' using errcode = '22023';
    end if;

    if category = 'partner' then
      if contribution_partner_id is null or contribution_investor_id is not null then
        raise exception 'Partner vehicles require partner-only contributions' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.partners p
        where p.id = contribution_partner_id and p.status = 'active'
      ) then
        raise exception 'Select an active partner for each contribution' using errcode = '22023';
      end if;
    elsif category = 'investor' then
      if contribution_investor_id is null or contribution_partner_id is not null then
        raise exception 'Investor vehicles require investor-only contributions' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.investors i
        where i.id = contribution_investor_id and i.status = 'active'
      ) then
        raise exception 'Select an active investor for each contribution' using errcode = '22023';
      end if;
    end if;
    added_contributions := added_contributions + contribution_amount;
  end loop;

  if category in ('partner', 'investor')
    and existing_contribution_count + jsonb_array_length(p_contributions) = 0 then
    raise exception 'Partner and investor vehicles require at least one funding contribution' using errcode = '22023';
  end if;
  if vehicle_purchase_price is not null
    and existing_contributions + added_contributions > vehicle_purchase_price then
    raise exception 'Total recorded funding cannot exceed the vehicle purchase price' using errcode = '22023';
  end if;

  if p_vehicle_id is null then
    insert into public.vehicles (
      business_category, make, model, variant, manufacturing_year, registration_year,
      registration_city, registration_number, color, mileage, engine_capacity,
      transmission, fuel_type, condition, chassis_number, engine_number, status,
      purchase_date, purchase_price, total_additional_costs, expected_sale_price,
      actual_sale_price, notes, customer_name, customer_contact
    )
    values (
      category,
      btrim(p_vehicle ->> 'make'),
      btrim(p_vehicle ->> 'model'),
      nullif(btrim(p_vehicle ->> 'variant'), ''),
      nullif(p_vehicle ->> 'manufacturing_year', '')::integer,
      nullif(p_vehicle ->> 'registration_year', '')::integer,
      nullif(btrim(p_vehicle ->> 'registration_city'), ''),
      nullif(btrim(p_vehicle ->> 'registration_number'), ''),
      nullif(btrim(p_vehicle ->> 'color'), ''),
      nullif(p_vehicle ->> 'mileage', '')::integer,
      nullif(p_vehicle ->> 'engine_capacity', '')::numeric,
      nullif(btrim(p_vehicle ->> 'transmission'), ''),
      nullif(btrim(p_vehicle ->> 'fuel_type'), ''),
      nullif(btrim(p_vehicle ->> 'condition'), ''),
      nullif(btrim(p_vehicle ->> 'chassis_number'), ''),
      nullif(btrim(p_vehicle ->> 'engine_number'), ''),
      coalesce(nullif(p_vehicle ->> 'status', ''), 'available'),
      nullif(p_vehicle ->> 'purchase_date', '')::date,
      vehicle_purchase_price,
      coalesce(nullif(p_vehicle ->> 'total_additional_costs', '')::numeric, 0),
      nullif(p_vehicle ->> 'expected_sale_price', '')::numeric,
      nullif(p_vehicle ->> 'actual_sale_price', '')::numeric,
      nullif(btrim(p_vehicle ->> 'notes'), ''),
      case when category = 'consignment' then nullif(btrim(p_vehicle ->> 'customer_name'), '') end,
      case when category = 'consignment' then nullif(btrim(p_vehicle ->> 'customer_contact'), '') end
    )
    returning id into saved_id;
  else
    update public.vehicles
    set business_category = category,
        make = btrim(p_vehicle ->> 'make'),
        model = btrim(p_vehicle ->> 'model'),
        variant = nullif(btrim(p_vehicle ->> 'variant'), ''),
        manufacturing_year = nullif(p_vehicle ->> 'manufacturing_year', '')::integer,
        registration_year = nullif(p_vehicle ->> 'registration_year', '')::integer,
        registration_city = nullif(btrim(p_vehicle ->> 'registration_city'), ''),
        registration_number = nullif(btrim(p_vehicle ->> 'registration_number'), ''),
        color = nullif(btrim(p_vehicle ->> 'color'), ''),
        mileage = nullif(p_vehicle ->> 'mileage', '')::integer,
        engine_capacity = nullif(p_vehicle ->> 'engine_capacity', '')::numeric,
        transmission = nullif(btrim(p_vehicle ->> 'transmission'), ''),
        fuel_type = nullif(btrim(p_vehicle ->> 'fuel_type'), ''),
        condition = nullif(btrim(p_vehicle ->> 'condition'), ''),
        chassis_number = nullif(btrim(p_vehicle ->> 'chassis_number'), ''),
        engine_number = nullif(btrim(p_vehicle ->> 'engine_number'), ''),
        status = coalesce(nullif(p_vehicle ->> 'status', ''), 'available'),
        purchase_date = case
          when category = 'consignment' and existing_category = 'consignment' then purchase_date
          else nullif(p_vehicle ->> 'purchase_date', '')::date
        end,
        purchase_price = case
          when category = 'consignment' and existing_category = 'consignment' then purchase_price
          else vehicle_purchase_price
        end,
        total_additional_costs = case
          when category = 'consignment' and existing_category = 'consignment' then total_additional_costs
          else coalesce(nullif(p_vehicle ->> 'total_additional_costs', '')::numeric, 0)
        end,
        expected_sale_price = nullif(p_vehicle ->> 'expected_sale_price', '')::numeric,
        actual_sale_price = nullif(p_vehicle ->> 'actual_sale_price', '')::numeric,
        notes = nullif(btrim(p_vehicle ->> 'notes'), ''),
        customer_name = case when category = 'consignment' then nullif(btrim(p_vehicle ->> 'customer_name'), '') end,
        customer_contact = case when category = 'consignment' then nullif(btrim(p_vehicle ->> 'customer_contact'), '') end,
        updated_at = now()
    where id = p_vehicle_id
    returning id into saved_id;
  end if;

  for contribution in select value from jsonb_array_elements(p_contributions)
  loop
    insert into public.funding_contributions (
      vehicle_id, partner_id, investor_id, amount, contribution_date,
      payment_method, reference_number, notes
    )
    values (
      saved_id,
      nullif(contribution ->> 'partner_id', '')::uuid,
      nullif(contribution ->> 'investor_id', '')::uuid,
      (contribution ->> 'amount')::numeric,
      (contribution ->> 'contribution_date')::date,
      nullif(btrim(contribution ->> 'payment_method'), ''),
      nullif(btrim(contribution ->> 'reference_number'), ''),
      nullif(btrim(contribution ->> 'notes'), '')
    );
  end loop;

  select count(*) into contributor_count
  from public.funding_contributions fc
  where fc.vehicle_id = saved_id;
  select v.purchase_price, v.total_additional_costs
  into saved_purchase_price, saved_additional_costs
  from public.vehicles v
  where v.id = saved_id;
  insert into public.audit_logs (actor_id, action_type, entity_type, entity_id, details)
  values (
    (select auth.uid()),
    case when p_vehicle_id is null then 'vehicle_created' else 'vehicle_updated' end,
    'vehicle',
    saved_id,
    jsonb_build_object(
      'category', category,
      'purchase_price', saved_purchase_price,
      'total_additional_costs', saved_additional_costs,
      'new_contribution_count', jsonb_array_length(p_contributions),
      'recorded_contribution_count', contributor_count,
      'new_contribution_total', added_contributions
    )
  );
  return saved_id;
end;
$$;

create or replace function public.party_funding_summary(p_party_type text)
returns table (party_id uuid, vehicle_count bigint, invested_capital numeric)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can view shared funding summaries' using errcode = '42501';
  end if;
  if p_party_type = 'partner' then
    return query
      select fc.partner_id, count(distinct fc.vehicle_id), coalesce(sum(fc.amount), 0)
      from public.funding_contributions fc
      where fc.partner_id is not null
      group by fc.partner_id;
  elsif p_party_type = 'investor' then
    return query
      select fc.investor_id, count(distinct fc.vehicle_id), coalesce(sum(fc.amount), 0)
      from public.funding_contributions fc
      where fc.investor_id is not null
      group by fc.investor_id;
  else
    raise exception 'Party type must be partner or investor' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.dashboard_inventory_summary()
returns table (available_count bigint, showroom_cost_value numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_active_user() then
    raise exception 'An active account is required' using errcode = '42501';
  end if;
  return query
    select count(*),
      coalesce(sum(case when v.business_category = 'consignment' then 0 else coalesce(v.purchase_price, 0) end), 0)
    from public.vehicles v
    where v.status = 'available';
end;
$$;

create or replace function public.dashboard_partner_funding_summary()
returns table (partner_id uuid, amount numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_active_user() then
    raise exception 'An active account is required' using errcode = '42501';
  end if;
  return query
    select fc.partner_id, sum(fc.amount)
    from public.funding_contributions fc
    where fc.partner_id is not null
    group by fc.partner_id;
end;
$$;

revoke all on function public.manage_investor(uuid, text, text, text, text, text, text) from public, anon;
revoke all on function public.manage_partner(uuid, text, text, text, text) from public, anon;
revoke all on function public.save_vehicle_with_contributions(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.party_funding_summary(text) from public, anon;
revoke all on function public.dashboard_inventory_summary() from public, anon;
revoke all on function public.dashboard_partner_funding_summary() from public, anon;
grant execute on function public.manage_investor(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.manage_partner(uuid, text, text, text, text) to authenticated;
grant execute on function public.save_vehicle_with_contributions(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.party_funding_summary(text) to authenticated;
grant execute on function public.dashboard_inventory_summary() to authenticated;
grant execute on function public.dashboard_partner_funding_summary() to authenticated;
