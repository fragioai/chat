-- Fragio – Rechte-Check Administration. Erwartung: überall ok = true.
select 'RLS aktiv: ' || c.relname as pruefung, c.relrowsecurity as ok
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('api_errors', 'security_events', 'admin_audit_log', 'user_roles', 'price_update_log')
union all
select 'Browser hat keinen Zugriff auf ' || t,
  not (has_table_privilege('authenticated', 'public.' || t, 'SELECT') or has_table_privilege('anon', 'public.' || t, 'SELECT')
    or has_table_privilege('authenticated', 'public.' || t, 'INSERT'))
from (values ('api_errors'), ('security_events'), ('admin_audit_log'), ('user_roles'), ('price_update_log')) as x(t)
union all
select 'Admin-Funktion nicht vom Browser aufrufbar: ' || fn,
  not (has_function_privilege('authenticated', sig, 'EXECUTE') or has_function_privilege('anon', sig, 'EXECUTE'))
from (values
  ('admin_overview', 'public.admin_overview(integer)'),
  ('admin_users', 'public.admin_users(text,integer,integer)'),
  ('admin_adjust_credit', 'public.admin_adjust_credit(uuid,uuid,numeric,text)'),
  ('admin_set_user_status', 'public.admin_set_user_status(uuid,uuid,text,text)'),
  ('admin_export', 'public.admin_export(text,timestamp with time zone,timestamp with time zone)'),
  ('admin_update_setting', 'public.admin_update_setting(uuid,text,text,text)'),
  ('log_security_event', 'public.log_security_event(text,uuid,jsonb)')
) as t(fn, sig)
union all
select 'Mindestens ein Admin eingetragen', (select count(*) >= 1 from public.user_roles where role = 'admin');
