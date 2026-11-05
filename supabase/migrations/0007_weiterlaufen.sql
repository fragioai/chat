-- Fragio – Migration 0007: Antworten laufen auf dem Server weiter, Fortsetzen, Abbruch per Markierung
-- Voraussetzung: 0001 bis 0006. Sicher wiederholbar.

-- Nachrichtenstatus um "truncated" (gekürzt durch Zeit- oder Längenlimit) erweitern.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.messages'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%status%' loop
    execute format('alter table public.messages drop constraint %I', c.conname);
  end loop;
  alter table public.messages add constraint messages_status_check
    check (status in ('complete', 'aborted', 'truncated', 'error'));
end $$;

alter table public.reservations add column if not exists cancel_requested boolean not null default false;

-- Stopp-Wunsch des Nutzers: die laufende Funktion prüft diese Markierung.
create or replace function public.request_cancel(p_request_id uuid, p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.reservations set cancel_requested = true
   where request_id = p_request_id and user_id = p_user and status = 'reserved';
  return found;
end;
$$;

-- Status einer eigenen Anfrage (für "Prüfen, ob die Antwort fertig ist").
-- Ergebnis: reserved (läuft noch), settled (fertig), released/expired (beendet ohne Abrechnung), null (unbekannt)
create or replace function public.request_status(p_request_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select status from public.reservations where request_id = p_request_id and user_id = auth.uid()
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'request_cancel' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'request_status' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
