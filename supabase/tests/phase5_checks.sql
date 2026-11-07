-- Fragio – Rechte-Check Phase 5. Erwartung: überall ok = true.
select 'Speicher "user-files" ist privat mit 6 MiB Limit' as pruefung,
  exists (select 1 from storage.buckets where id = 'user-files' and public = false and file_size_limit = 6291456) as ok
union all
select 'RLS aktiv auf files', (select relrowsecurity from pg_class where oid = 'public.files'::regclass)
union all
select 'Browser darf Dateien NICHT schreiben',
  not (has_table_privilege('authenticated', 'public.files', 'INSERT')
    or has_table_privilege('authenticated', 'public.files', 'UPDATE')
    or has_table_privilege('authenticated', 'public.files', 'DELETE')
    or has_table_privilege('anon', 'public.files', 'SELECT'))
union all
select 'Dateifunktion nicht vom Browser aufrufbar: ' || fn,
  not (has_function_privilege('authenticated', sig, 'EXECUTE') or has_function_privilege('anon', sig, 'EXECUTE'))
from (values
  ('file_reserve', 'public.file_reserve(uuid,text,bigint,uuid)'),
  ('file_ready', 'public.file_ready(uuid,uuid,bigint,text,text,integer)'),
  ('file_add_generated', 'public.file_add_generated(uuid,uuid,uuid,text,text,bigint,text,text)')
) as t(fn, sig)
union all
select 'Keine Storage-Richtlinie für Browser auf user-files',
  not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and (qual ilike '%user-files%' or with_check ilike '%user-files%'));
