-- Share showroom and financial reads with active partners.
-- Investors receive only rows directly linked to their investor profile.
-- The existing super_admin_all policies continue to grant Super Admin access.

do $$
declare
  table_name text;
  partner_read_tables text[] := array[
    'partners', 'investors', 'vehicle_catalog', 'vehicles', 'funding_sources',
    'funding_contributions', 'vehicle_expenses', 'sales', 'sale_payments',
    'profit_calculations', 'profit_distributions', 'distribution_payments',
    'showroom_reserves', 'reserve_transactions', 'general_expenses',
    'financial_transactions', 'app_settings', 'ai_recommendations',
    'market_data_sources', 'market_observations'
  ];
begin
  foreach table_name in array partner_read_tables loop
    execute format('drop policy if exists partners_shared_read on public.%I', table_name);
    execute format(
      'create policy partners_shared_read on public.%I for select to authenticated using ((select public.is_active_user()) and (select public.current_partner_id()) is not null)',
      table_name
    );
    execute format('grant select on table public.%I to authenticated', table_name);
  end loop;
end;
$$;

drop policy if exists partners_shared_read on public.audit_logs;
drop policy if exists partners_shared_read on public.approvals;

drop policy if exists investors_own_contributions_read on public.funding_contributions;
create policy investors_own_contributions_read on public.funding_contributions
  for select to authenticated
  using (investor_id = (select public.current_investor_id()));

drop policy if exists investors_own_transactions_read on public.financial_transactions;
create policy investors_own_transactions_read on public.financial_transactions
  for select to authenticated
  using (related_investor_id = (select public.current_investor_id()));

drop policy if exists investors_own_distributions_read on public.profit_distributions;
create policy investors_own_distributions_read on public.profit_distributions
  for select to authenticated
  using (
    recipient_type = 'investor'
    and recipient_id = (select public.current_investor_id())
  );

drop policy if exists investors_own_distribution_payments_read on public.distribution_payments;
create policy investors_own_distribution_payments_read on public.distribution_payments
  for select to authenticated
  using (
    exists (
      select 1
      from public.profit_distributions d
      where d.id = distribution_payments.distribution_id
        and d.recipient_type = 'investor'
        and d.recipient_id = (select public.current_investor_id())
    )
  );
