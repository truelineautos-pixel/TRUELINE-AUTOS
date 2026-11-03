create or replace function public.dashboard_investor_funding_summary()
returns table (investor_id uuid, amount numeric)
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
    select fc.investor_id, sum(fc.amount)
    from public.funding_contributions fc
    where fc.investor_id is not null
    group by fc.investor_id;
end;
$$;

create or replace function public.dashboard_current_investor_summary()
returns table (
  invested_capital numeric,
  funded_vehicle_count bigint,
  recorded_distributions numeric,
  recorded_payments numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_investor_id uuid;
begin
  if not public.is_active_user() then
    raise exception 'An active account is required' using errcode = '42501';
  end if;
  v_investor_id := public.current_investor_id();
  if v_investor_id is null then
    raise exception 'An active investor account is required' using errcode = '42501';
  end if;

  return query
    select
      coalesce((
        select sum(fc.amount)
        from public.funding_contributions fc
        where fc.investor_id = v_investor_id
      ), 0),
      coalesce((
        select count(distinct fc.vehicle_id)
        from public.funding_contributions fc
        where fc.investor_id = v_investor_id
      ), 0),
      coalesce((
        select sum(d.amount)
        from public.profit_distributions d
        where d.recipient_type = 'investor'
          and d.recipient_id = v_investor_id
      ), 0),
      coalesce((
        select sum(dp.paid_amount)
        from public.distribution_payments dp
        join public.profit_distributions d on d.id = dp.distribution_id
        where d.recipient_type = 'investor'
          and d.recipient_id = v_investor_id
      ), 0);
end;
$$;

revoke all on function public.dashboard_investor_funding_summary() from public, anon;
revoke all on function public.dashboard_current_investor_summary() from public, anon;
grant execute on function public.dashboard_investor_funding_summary() to authenticated;
grant execute on function public.dashboard_current_investor_summary() to authenticated;
