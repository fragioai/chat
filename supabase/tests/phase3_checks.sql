-- Fragio – Selbsttest Phase 3. Im Supabase SQL Editor ausführen.
-- Erwartung: In der Spalte "ok" steht überall true.

select 'RLS aktiv: ' || c.relname as pruefung, c.relrowsecurity as ok
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'user_roles', 'credit_accounts', 'ledger_entries')

union all
select 'Browser darf Ledger NICHT schreiben',
  not (has_table_privilege('authenticated', 'public.ledger_entries', 'INSERT')
    or has_table_privilege('authenticated', 'public.ledger_entries', 'UPDATE')
    or has_table_privilege('authenticated', 'public.ledger_entries', 'DELETE'))

union all
select 'Browser darf Guthaben NICHT schreiben',
  not (has_table_privilege('authenticated', 'public.credit_accounts', 'INSERT')
    or has_table_privilege('authenticated', 'public.credit_accounts', 'UPDATE')
    or has_table_privilege('authenticated', 'public.credit_accounts', 'DELETE'))

union all
select 'Browser hat KEINEN Zugriff auf Rollen',
  not (has_table_privilege('authenticated', 'public.user_roles', 'SELECT')
    or has_table_privilege('authenticated', 'public.user_roles', 'INSERT')
    or has_table_privilege('anon', 'public.user_roles', 'SELECT'))

union all
select 'Anonyme Besucher sehen KEINE Kontodaten',
  not (has_table_privilege('anon', 'public.profiles', 'SELECT')
    or has_table_privilege('anon', 'public.credit_accounts', 'SELECT')
    or has_table_privilege('anon', 'public.ledger_entries', 'SELECT'))

union all
select 'Profil: Status nicht vom Browser änderbar',
  not has_column_privilege('authenticated', 'public.profiles', 'status', 'UPDATE')

union all
select 'Ledger-Schutz-Trigger vorhanden',
  exists (select 1 from pg_trigger where tgname = 'ledger_entries_guard_trg' and not tgisinternal)

union all
select 'Registrierungs-Trigger vorhanden',
  exists (select 1 from pg_trigger where tgname = 'on_auth_user_created' and not tgisinternal);
