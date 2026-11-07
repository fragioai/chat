-- Fragio – Check Phase 7a. Erwartung: überall ok = true.
select 'RLS aktiv auf outbox_events' as pruefung, (select relrowsecurity from pg_class where oid = 'public.outbox_events'::regclass) as ok
union all
select 'Browser hat keinen Zugriff auf outbox_events',
  not (has_table_privilege('authenticated', 'public.outbox_events', 'SELECT') or has_table_privilege('anon', 'public.outbox_events', 'SELECT'))
union all
select 'Outbox-Funktion nicht vom Browser aufrufbar: ' || fn,
  not (has_function_privilege('authenticated', sig, 'EXECUTE') or has_function_privilege('anon', sig, 'EXECUTE'))
from (values
  ('outbox_claim', 'public.outbox_claim(integer,text[])'),
  ('outbox_mark', 'public.outbox_mark(bigint,boolean,text)'),
  ('admin_email_user', 'public.admin_email_user(uuid,uuid,text,text,text)')
) as t(fn, sig)
union all
select 'Trigger für Nutzung vorhanden', exists (select 1 from pg_trigger where tgname = 'usage_events_enqueue' and not tgisinternal)
union all
select 'Trigger für Buchungen vorhanden', exists (select 1 from pg_trigger where tgname = 'ledger_entries_enqueue' and not tgisinternal);
