-- Fragio – Check Extra D. Erwartung: überall ok = true.
select 'Spalte retention_days vorhanden' as pruefung,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'retention_days') as ok
union all
select 'Browser darf nur Name und Aufbewahrung ändern (nicht den Status)',
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
  and has_column_privilege('authenticated', 'public.profiles', 'retention_days', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'status', 'UPDATE')
union all
select 'purge_old_chats nicht vom Browser aufrufbar',
  not (has_function_privilege('authenticated', 'public.purge_old_chats()', 'EXECUTE') or has_function_privilege('anon', 'public.purge_old_chats()', 'EXECUTE'));
