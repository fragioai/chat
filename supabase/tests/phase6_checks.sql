-- Fragio – Check Phase 6. Erwartung: überall ok = true.
select 'Anonym darf Nutzungsfunktionen nicht aufrufen: ' || fn as pruefung,
  not has_function_privilege('anon', sig, 'EXECUTE') as ok
from (values
  ('my_usage_summary', 'public.my_usage_summary(integer)'),
  ('my_usage_list', 'public.my_usage_list(integer,integer)')
) as t(fn, sig)
union all
select 'Angemeldete dürfen Nutzungsfunktionen aufrufen: ' || fn,
  has_function_privilege('authenticated', sig, 'EXECUTE')
from (values
  ('my_usage_summary', 'public.my_usage_summary(integer)'),
  ('my_usage_list', 'public.my_usage_list(integer,integer)')
) as t(fn, sig);
-- Ohne Anmeldung (SQL Editor) muss der Aufruf "unauthorized" melden:
--   select public.my_usage_summary(30);   -> Fehler: unauthorized
