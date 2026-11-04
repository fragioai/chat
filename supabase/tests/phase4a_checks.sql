-- Fragio – Rechte-Check Phase 4a. Erwartung: überall ok = true.
select 'RLS aktiv: ' || c.relname as pruefung, c.relrowsecurity as ok
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'app_settings','model_configs','price_versions','fx_rates','chats','messages',
  'reservations','usage_events','rate_limits','admin_audit_log')
union all
select 'Browser darf Nachrichten NICHT schreiben',
  not (has_table_privilege('authenticated','public.messages','INSERT')
    or has_table_privilege('authenticated','public.messages','UPDATE')
    or has_table_privilege('authenticated','public.messages','DELETE'))
union all
select 'Browser darf Preise NICHT lesen oder schreiben',
  not (has_table_privilege('authenticated','public.price_versions','SELECT')
    or has_table_privilege('authenticated','public.price_versions','INSERT')
    or has_table_privilege('authenticated','public.fx_rates','SELECT'))
union all
select 'Browser darf Reservierungen NICHT lesen oder schreiben',
  not (has_table_privilege('authenticated','public.reservations','SELECT')
    or has_table_privilege('authenticated','public.reservations','INSERT'))
union all
select 'Browser darf Chat-Titel ändern, aber nicht den Besitzer',
  has_column_privilege('authenticated','public.chats','title','UPDATE')
  and not has_column_privilege('authenticated','public.chats','user_id','UPDATE')
union all
select 'Abrechnungsfunktion nicht vom Browser aufrufbar: ' || fn,
  not (has_function_privilege('authenticated', sig, 'EXECUTE') or has_function_privilege('anon', sig, 'EXECUTE'))
from (values
  ('reserve_credit', 'public.reserve_credit(uuid,uuid,uuid,text,bigint,bigint,integer)'),
  ('settle_request', 'public.settle_request(uuid,bigint,bigint,bigint,bigint,integer,text,text)'),
  ('admin_add_credit', 'public.admin_add_credit(uuid,numeric,text)'),
  ('compute_cost', 'public.compute_cost(bigint,bigint,bigint,bigint,bigint,bigint,integer)')
) as t(fn, sig)
union all
select 'Modelle vorhanden (8 erwartet)', (select count(*) = 8 from public.model_configs)
union all
select 'Preisversionen vorhanden (mindestens 10)', (select count(*) >= 10 from public.price_versions);
