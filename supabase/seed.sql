-- Recommended seed guidance
-- 1. Create first super admin profile in auth.users.
-- 2. Insert six partner records.
-- 3. Insert default funding sources.
-- 4. Insert default app settings.
-- 5. Add initial categories and operational expenses.

insert into app_settings (business_name, currency, date_format, theme, background_blur, background_brightness, background_opacity)
values ('TRUELINE AUTOS', 'PKR', 'DD/MM/YYYY', 'luxury-glass', 12, 0.78, 0.68)
on conflict do nothing;

insert into funding_sources (code, name, source_type, is_active)
values
  ('BUSINESS_CAPITAL', 'TrueLine business capital', 'capital', true),
  ('BANK_FINANCE', 'Bank financing', 'loan', true),
  ('OTHER', 'Other approved source', 'other', true)
on conflict (code) do nothing;
