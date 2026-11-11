-- Fragio – Migration 0012: Aufbewahrung von Chats (automatisches Löschen)
-- Voraussetzung: 0001 bis 0011. Sicher wiederholbar.

alter table public.profiles add column if not exists retention_days integer
  check (retention_days is null or retention_days in (30, 90, 365));

-- Nutzer dürfen ihren Anzeigenamen und ihre Aufbewahrung selbst ändern, sonst nichts.
grant update (display_name, retention_days) on public.profiles to authenticated;

-- Löscht Chats, deren letzte Aktivität länger zurückliegt als die gewählte Aufbewahrung.
-- Dateien der Chats werden dabei zum Löschen markiert und vom Aufräumjob entfernt.
create or replace function public.purge_old_chats()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with d as (
    delete from public.chats c using public.profiles p
     where p.id = c.user_id and p.retention_days is not null
       and c.updated_at < now() - make_interval(days => p.retention_days)
    returning c.id)
  select count(*) into n from d;
  return coalesce(n, 0);
end;
$$;
revoke all on function public.purge_old_chats() from public, anon, authenticated;
grant execute on function public.purge_old_chats() to service_role;
