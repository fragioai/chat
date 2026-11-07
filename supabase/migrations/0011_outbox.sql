-- Fragio – Migration 0011: Ausgangsbox für E-Mail und Google Sheets (Outbox)
-- Voraussetzung: 0001 bis 0010. Sicher wiederholbar.
-- Prinzip: Ereignisse werden zuerst sicher in der Datenbank gespeichert und später zugestellt.
-- Fällt E-Mail oder Google Sheets aus, geht nichts verloren; es wird mit Wartezeiten wiederholt.

create table if not exists public.outbox_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('email', 'sheet')),
  event_key text not null unique,                 -- verhindert doppelte Ereignisse
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'failed', 'sent', 'dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbox_due_idx on public.outbox_events (status, next_attempt_at);
alter table public.outbox_events enable row level security;
revoke all on public.outbox_events from anon, authenticated;

---------------------------------------------------------------------------
-- Ereignisse automatisch einreihen (Nutzung und Geldbuchungen)
---------------------------------------------------------------------------
create or replace function public.enqueue_usage_sheet()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_name text;
begin
  select u.email, p.display_name into v_email, v_name
    from auth.users u join public.profiles p on p.id = u.id where u.id = new.user_id;
  insert into public.outbox_events (kind, event_key, payload)
  values ('sheet', 'usage:' || new.request_id, jsonb_build_object('tab', 'Nutzung', 'row', jsonb_build_array(
    'usage:' || new.request_id, to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    coalesce(new.user_id::text, ''), coalesce(v_email, ''), coalesce(v_name, ''), new.model_id,
    new.input_tokens::text, new.output_tokens::text, new.cache_read_tokens::text, new.cache_write_tokens::text,
    new.search_requests::text, new.provider_cost_eur::text, new.markup_eur::text, new.fx_surcharge_eur::text,
    new.total_eur::text, new.charged_eur::text, new.reserved_eur::text, new.usage_source, new.outcome, new.request_id::text)))
  on conflict (event_key) do nothing;
  return new;
exception when others then
  -- Die Abrechnung darf niemals an der Dokumentation scheitern.
  return new;
end;
$$;
drop trigger if exists usage_events_enqueue on public.usage_events;
create trigger usage_events_enqueue after insert on public.usage_events
  for each row execute function public.enqueue_usage_sheet();

create or replace function public.enqueue_ledger_sheet()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if new.entry_type not in ('deposit', 'refund', 'correction', 'admin_adjustment') then return new; end if;
  select u.email into v_email from auth.users u where u.id = new.user_id;
  insert into public.outbox_events (kind, event_key, payload)
  values ('sheet', 'ledger:' || new.id, jsonb_build_object('tab', 'Buchungen', 'row', jsonb_build_array(
    'ledger:' || new.id, to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    coalesce(new.user_id::text, ''), coalesce(v_email, ''), new.entry_type, new.amount_eur::text,
    coalesce(new.reference_type, ''), coalesce(new.note, ''))))
  on conflict (event_key) do nothing;
  return new;
exception when others then
  return new;
end;
$$;
drop trigger if exists ledger_entries_enqueue on public.ledger_entries;
create trigger ledger_entries_enqueue after insert on public.ledger_entries
  for each row execute function public.enqueue_ledger_sheet();

---------------------------------------------------------------------------
-- Funktionen für Worker und Admin (nur Serverseite)
---------------------------------------------------------------------------
create or replace function public.outbox_enqueue_email(p_to text, p_subject text, p_body text, p_key text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.outbox_events (kind, event_key, payload)
  values ('email', p_key, jsonb_build_object('to', p_to, 'subject', left(p_subject, 200), 'text', left(p_body, 20000)))
  on conflict (event_key) do nothing returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.outbox_enqueue_sheet(p_tab text, p_row jsonb, p_key text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.outbox_events (kind, event_key, payload)
  values ('sheet', p_key, jsonb_build_object('tab', p_tab, 'row', p_row))
  on conflict (event_key) do nothing returning id into v_id;
  return v_id;
end;
$$;

-- Holt fällige Ereignisse und sperrt sie für 5 Minuten (verhindert doppelte Bearbeitung durch parallele Läufe).
create or replace function public.outbox_claim(p_limit integer, p_kinds text[])
returns setof public.outbox_events language plpgsql security definer set search_path = public as $$
begin
  delete from public.outbox_events where status = 'sent' and sent_at < now() - interval '30 days';
  return query
    update public.outbox_events o set next_attempt_at = now() + interval '5 minutes'
     where o.id in (
       select id from public.outbox_events
        where status in ('pending', 'failed') and next_attempt_at <= now() and kind = any (p_kinds)
        order by id limit least(greatest(p_limit, 1), 100) for update skip locked)
    returning o.*;
end;
$$;

-- Ergebnis eintragen. Wartezeiten: 1, 5, 30, 120, 360, 720 Minuten, dann 24 Stunden. Nach 8 Versuchen "dead".
create or replace function public.outbox_mark(p_id bigint, p_ok boolean, p_error text)
returns text language plpgsql security definer set search_path = public as $$
declare v_attempts integer; v_status text; v_wait integer[] := array[1, 5, 30, 120, 360, 720, 1440, 1440];
begin
  if p_ok then
    update public.outbox_events set status = 'sent', sent_at = now(), last_error = null where id = p_id;
    return 'sent';
  end if;
  update public.outbox_events set attempts = attempts + 1, last_error = left(coalesce(p_error, ''), 500)
   where id = p_id returning attempts into v_attempts;
  if v_attempts >= 8 then v_status := 'dead'; else v_status := 'failed'; end if;
  update public.outbox_events
     set status = v_status, next_attempt_at = now() + make_interval(mins => v_wait[least(v_attempts, 8)])
   where id = p_id;
  return v_status;
end;
$$;

-- Nicht eingerichtet: Ereignis bleibt unverändert wartend (ohne Versuch zu zählen).
create or replace function public.outbox_defer(p_id bigint, p_note text)
returns void language sql security definer set search_path = public as $$
  update public.outbox_events set next_attempt_at = now() + interval '15 minutes', last_error = left(p_note, 200)
   where id = p_id and status in ('pending', 'failed');
$$;

create or replace function public.outbox_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'by_kind', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
        select kind, status, count(*) as n, min(created_at) as oldest from public.outbox_events
         where status <> 'sent' group by kind, status order by kind, status) r),
    'sent_24h', (select count(*) from public.outbox_events where status = 'sent' and sent_at > now() - interval '24 hours'),
    'recent', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from (
        select id, kind, event_key, status, attempts, last_error, created_at, sent_at, next_attempt_at
          from public.outbox_events order by id desc limit 50) e))
$$;

create or replace function public.outbox_retry_dead(p_admin uuid, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  update public.outbox_events set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
   where status in ('dead', 'failed');
  get diagnostics n = row_count;
  insert into public.admin_audit_log (admin_user, action, details)
  values (p_admin, 'outbox_retry', jsonb_build_object('count', n, 'reason', p_reason));
  return n;
end;
$$;

-- Admin schreibt einem Nutzer: höchstens 5 Mails pro Nutzer und Tag, mit Begründung und Protokoll.
create or replace function public.admin_email_user(p_admin uuid, p_user uuid, p_subject text, p_body text, p_reason text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_email text; v_n integer; v_id bigint;
begin
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  if p_subject is null or char_length(trim(p_subject)) < 3 or p_body is null or char_length(trim(p_body)) < 3 then raise exception 'mail_incomplete'; end if;
  select email into v_email from auth.users where id = p_user;
  if v_email is null then raise exception 'user_not_found'; end if;
  select count(*) into v_n from public.admin_audit_log
   where action = 'email_user' and target_user = p_user and created_at > now() - interval '1 day';
  if v_n >= 5 then raise exception 'mail_limit'; end if;
  v_id := public.outbox_enqueue_email(v_email, p_subject, p_body, 'adminmail:' || gen_random_uuid());
  insert into public.admin_audit_log (admin_user, action, target_user, details)
  values (p_admin, 'email_user', p_user, jsonb_build_object('subject', left(p_subject, 120), 'reason', p_reason, 'outbox_id', v_id));
  return v_id;
end;
$$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('enqueue_usage_sheet', 'enqueue_ledger_sheet', 'outbox_enqueue_email', 'outbox_enqueue_sheet', 'outbox_claim',
                         'outbox_mark', 'outbox_defer', 'outbox_stats', 'outbox_retry_dead', 'admin_email_user')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
