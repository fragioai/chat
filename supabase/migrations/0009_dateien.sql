-- Fragio – Migration 0009: Dateien (Upload, erzeugte Dateien, Speichergrenzen)
-- Voraussetzung: 0001 bis 0008. Sicher wiederholbar.

-- Privater Speicher, 6 MiB pro Datei (zusätzlich vom Speicherdienst selbst erzwungen)
insert into storage.buckets (id, name, public, file_size_limit)
values ('user-files', 'user-files', false, 6291456)
on conflict (id) do update set public = false, file_size_limit = 6291456;

insert into public.app_settings (key, value) values
  ('max_file_bytes', '6291456'),          -- 6 MiB pro Datei
  ('max_user_bytes', '73400320'),         -- 70 MiB pro Nutzer
  ('max_total_bytes', '943718400'),       -- 900 MiB insgesamt (Free-Tarif: 1 GB)
  ('max_files_per_message', '5'),
  ('provider_file_ttl_days', '7')         -- Kopien beim KI-Anbieter werden danach gelöscht
on conflict (key) do nothing;

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id uuid references public.chats (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  kind text not null check (kind in ('upload', 'generated')),
  name text not null check (char_length(name) between 1 and 120),
  mime text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  sha256 text,
  storage_path text not null unique,
  status text not null default 'pending' check (status in ('pending', 'ready', 'rejected')),
  zip_entries integer,
  provider_file_id text,
  provider_uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists files_user_idx on public.files (user_id, created_at desc);
create index if not exists files_chat_idx on public.files (chat_id) where deleted_at is null;
create index if not exists files_message_idx on public.files (message_id);

alter table public.files enable row level security;
revoke all on public.files from anon, authenticated;
grant select on public.files to authenticated;
drop policy if exists files_select_own on public.files;
create policy files_select_own on public.files for select to authenticated
  using (user_id = auth.uid() and status = 'ready' and deleted_at is null);

-- Chat gelöscht -> zugehörige Dateien zum Löschen markieren (Aufräumjob entfernt sie samt Speicherobjekt).
create or replace function public.chats_mark_files_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.files set deleted_at = now() where chat_id = old.id and deleted_at is null;
  return old;
end;
$$;
drop trigger if exists chats_before_delete_files on public.chats;
create trigger chats_before_delete_files before delete on public.chats
  for each row execute function public.chats_mark_files_deleted();

create or replace function public.file_usage(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'used', coalesce((select sum(size_bytes) from public.files where user_id = p_user and status in ('pending', 'ready') and deleted_at is null), 0),
    'user_limit', public.setting_num('max_user_bytes'),
    'total_used', coalesce((select sum(size_bytes) from public.files where status in ('pending', 'ready') and deleted_at is null), 0),
    'total_limit', public.setting_num('max_total_bytes'),
    'max_file', public.setting_num('max_file_bytes'),
    'max_per_message', public.setting_num('max_files_per_message'))
$$;

-- Platz prüfen und Datei vormerken. Fehlercodes werden von der Funktion "files" übersetzt.
create or replace function public.file_reserve(p_user uuid, p_name text, p_size bigint, p_chat uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid(); v_path text; v_status text; v_used numeric; v_total numeric; v_pending int;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  select status into v_status from public.profiles where id = p_user;
  if v_status is distinct from 'active' then raise exception 'account_blocked'; end if;
  if p_size is null or p_size <= 0 then raise exception 'file_empty'; end if;
  if p_size > public.setting_num('max_file_bytes') then raise exception 'file_too_large'; end if;
  if p_chat is not null and not exists (select 1 from public.chats where id = p_chat and user_id = p_user) then
    raise exception 'chat_not_found';
  end if;
  select count(*) into v_pending from public.files where user_id = p_user and status = 'pending' and deleted_at is null;
  if v_pending >= 10 then raise exception 'too_many_pending'; end if;
  select coalesce(sum(size_bytes), 0) into v_used from public.files where user_id = p_user and status in ('pending', 'ready') and deleted_at is null;
  if v_used + p_size > public.setting_num('max_user_bytes') then raise exception 'quota_user'; end if;
  select coalesce(sum(size_bytes), 0) into v_total from public.files where status in ('pending', 'ready') and deleted_at is null;
  if v_total + p_size > public.setting_num('max_total_bytes') then raise exception 'quota_total'; end if;

  v_path := p_user::text || '/' || v_id::text;
  insert into public.files (id, user_id, chat_id, kind, name, size_bytes, storage_path, status)
  values (v_id, p_user, p_chat, 'upload', left(p_name, 120), p_size, v_path, 'pending');
  return jsonb_build_object('file_id', v_id, 'path', v_path);
end;
$$;

create or replace function public.file_ready(p_file uuid, p_user uuid, p_size bigint, p_sha text, p_mime text, p_zip_entries integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.files set status = 'ready', size_bytes = p_size, sha256 = p_sha, mime = p_mime, zip_entries = p_zip_entries
   where id = p_file and user_id = p_user and status = 'pending' and deleted_at is null;
  if not found then raise exception 'file_not_found'; end if;
end;
$$;

-- Vom Modell erzeugte Datei eintragen; Rückgabe ok=false bei Speichergrenze (kein Fehler).
create or replace function public.file_add_generated(
  p_user uuid, p_chat uuid, p_message uuid, p_name text, p_mime text, p_size bigint, p_sha text, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_used numeric; v_total numeric;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  select coalesce(sum(size_bytes), 0) into v_used from public.files where user_id = p_user and status in ('pending', 'ready') and deleted_at is null;
  if v_used + p_size > public.setting_num('max_user_bytes') then return jsonb_build_object('ok', false, 'reason', 'quota_user'); end if;
  select coalesce(sum(size_bytes), 0) into v_total from public.files where status in ('pending', 'ready') and deleted_at is null;
  if v_total + p_size > public.setting_num('max_total_bytes') then return jsonb_build_object('ok', false, 'reason', 'quota_total'); end if;
  insert into public.files (user_id, chat_id, message_id, kind, name, mime, size_bytes, sha256, storage_path, status)
  values (p_user, p_chat, p_message, 'generated', left(p_name, 120), p_mime, p_size, p_sha, p_path, 'ready')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'file_id', v_id);
end;
$$;

-- Admin-Einstellungen um die Datei-Grenzen erweitern.
create or replace function public.admin_update_setting(p_admin uuid, p_key text, p_value text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text; v_num numeric;
begin
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  if p_value is null or p_value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'value_invalid'; end if;
  v_num := p_value::numeric;
  if not (
    (p_key = 'markup_percent' and v_num between 0 and 100) or
    (p_key = 'fx_markup_percent' and v_num between 0 and 50) or
    (p_key = 'price_max_age_days' and v_num between 1 and 365) or
    (p_key = 'fx_max_age_hours' and v_num between 1 and 720) or
    (p_key = 'max_concurrent_requests' and v_num between 1 and 20) or
    (p_key = 'rate_limit_per_minute' and v_num between 1 and 120) or
    (p_key = 'reservation_ttl_minutes' and v_num between 2 and 120) or
    (p_key = 'max_file_bytes' and v_num between 100000 and 6291456) or
    (p_key = 'max_user_bytes' and v_num between 1000000 and 1073741824) or
    (p_key = 'max_total_bytes' and v_num between 10000000 and 1073741824) or
    (p_key = 'max_files_per_message' and v_num between 1 and 10) or
    (p_key = 'provider_file_ttl_days' and v_num between 1 and 30)
  ) then raise exception 'key_or_range_invalid'; end if;
  select value into v_old from public.app_settings where key = p_key for update;
  if not found then raise exception 'key_invalid'; end if;
  update public.app_settings set value = p_value, updated_at = now() where key = p_key;
  insert into public.admin_audit_log (admin_user, action, details)
  values (p_admin, 'update_setting', jsonb_build_object('key', p_key, 'from', v_old, 'to', p_value, 'reason', p_reason));
end;
$$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('file_usage', 'file_reserve', 'file_ready', 'file_add_generated', 'admin_update_setting', 'chats_mark_files_deleted')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
