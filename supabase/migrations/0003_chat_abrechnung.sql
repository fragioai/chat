-- Fragio – Migration 0003: Chats, Modelle, Preise, Reservierung, Abrechnung
-- Sicher wiederholbar. Alle Geldberechnungen passieren hier in der Datenbank (numeric, exakt).
-- Voraussetzung: 0001 und 0002.

---------------------------------------------------------------------------
-- Einstellungen
---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('markup_percent', '10'),            -- vereinbarter Aufschlag auf Anbieterkosten
  ('fx_markup_percent', '2'),          -- Wechselkurs-Aufschlag USD->EUR (BITTE BESTÄTIGEN)
  ('price_max_age_days', '90'),        -- Preise älter als das gelten als nicht verifiziert
  ('fx_max_age_hours', '72'),          -- Wechselkurs älter als das blockiert Anfragen
  ('max_concurrent_requests', '3'),    -- gleichzeitige Anfragen pro Nutzer
  ('rate_limit_per_minute', '12'),     -- Anfragen pro Minute pro Nutzer
  ('reservation_ttl_minutes', '15')    -- offene Reservierungen werden danach freigegeben
on conflict (key) do nothing;

---------------------------------------------------------------------------
-- Modelle und Preise
---------------------------------------------------------------------------
create table if not exists public.model_configs (
  id text primary key,
  provider text not null check (provider in ('anthropic', 'google')),
  api_model_id text not null,
  display_name text not null,
  speed_class text not null,
  reasoning_class text not null,
  description text,
  efforts jsonb not null,             -- [{"value":"low","label":"Schnell"}, ...]
  default_effort text not null,
  supports_web_search boolean not null default false,
  context_tokens integer not null,    -- unser Eingabelimit (nicht das Limit des Anbieters)
  max_output_cap integer not null,    -- unser Ausgabelimit pro Antwort
  status text not null default 'enabled' check (status in ('enabled', 'disabled', 'deprecated')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.price_versions (
  id bigint generated always as identity primary key,
  model_id text not null references public.model_configs (id),
  input_usd_per_mtok numeric(18, 8) not null check (input_usd_per_mtok >= 0),
  output_usd_per_mtok numeric(18, 8) not null check (output_usd_per_mtok >= 0),
  cache_read_usd_per_mtok numeric(18, 8),
  cache_write_usd_per_mtok numeric(18, 8),
  long_context_threshold integer,
  long_input_usd_per_mtok numeric(18, 8),
  long_output_usd_per_mtok numeric(18, 8),
  long_cache_read_usd_per_mtok numeric(18, 8),
  long_cache_write_usd_per_mtok numeric(18, 8),
  search_usd_per_request numeric(18, 8) not null default 0,
  source_url text not null,
  valid_from timestamptz not null,
  valid_until timestamptz,
  verified_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'pending', 'retired')),
  note text,
  created_at timestamptz not null default now(),
  unique (model_id, valid_from),
  check (valid_until is null or valid_until > valid_from)
);

create table if not exists public.fx_rates (
  id bigint generated always as identity primary key,
  usd_per_eur numeric(18, 10) not null check (usd_per_eur > 0),
  eur_per_usd numeric(18, 10) not null check (eur_per_usd > 0),
  source text not null,
  rate_date date,
  fetched_at timestamptz not null default now()
);

---------------------------------------------------------------------------
-- Chats und Nachrichten
---------------------------------------------------------------------------
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Neuer Chat' check (char_length(title) between 1 and 120),
  model_id text references public.model_configs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chats_user_updated_idx on public.chats (user_id, updated_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  status text not null default 'complete' check (status in ('complete', 'aborted', 'error')),
  model_id text,
  request_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists messages_chat_created_idx on public.messages (chat_id, created_at);
create unique index if not exists messages_request_role_uidx
  on public.messages (request_id, role) where request_id is not null;

create or replace function public.touch_chat()
returns trigger language plpgsql as $$
begin
  update public.chats set updated_at = now() where id = new.chat_id;
  return new;
end;
$$;
drop trigger if exists messages_touch_chat on public.messages;
create trigger messages_touch_chat after insert on public.messages
  for each row execute function public.touch_chat();

---------------------------------------------------------------------------
-- Reservierungen, Nutzung, Rate Limits, Audit
---------------------------------------------------------------------------
create table if not exists public.reservations (
  request_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id uuid,
  model_id text not null references public.model_configs (id),
  price_version_id bigint not null references public.price_versions (id),
  fx_rate_id bigint not null references public.fx_rates (id),
  reserved_eur numeric(18, 8) not null check (reserved_eur > 0),
  final_eur numeric(18, 8),
  status text not null default 'reserved'
    check (status in ('reserved', 'settled', 'released', 'expired')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists reservations_user_status_idx on public.reservations (user_id, status, created_at);

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  user_id uuid references auth.users (id) on delete set null,
  chat_id uuid,
  model_id text not null,
  price_version_id bigint not null references public.price_versions (id),
  fx_rate_id bigint not null references public.fx_rates (id),
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,          -- inkl. Denk-Tokens
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  search_requests integer not null default 0,
  base_cost_usd numeric(24, 12) not null,
  provider_cost_eur numeric(24, 12) not null,
  fx_surcharge_eur numeric(24, 12) not null,
  markup_eur numeric(24, 12) not null,
  total_eur numeric(18, 8) not null,                -- berechnete Gesamtkosten
  charged_eur numeric(18, 8) not null,              -- tatsächlich abgebucht (max. reserviert)
  shortfall_eur numeric(18, 8) not null default 0,  -- nicht belastet, weil über Reservierung
  reserved_eur numeric(18, 8) not null,
  usage_source text not null check (usage_source in ('provider', 'estimated')),
  outcome text not null check (outcome in ('complete', 'aborted', 'error')),
  created_at timestamptz not null default now()
);
create index if not exists usage_events_user_created_idx on public.usage_events (user_id, created_at desc);

create table if not exists public.rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, bucket, window_start)
);

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_user uuid,
  action text not null,
  target_user uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

---------------------------------------------------------------------------
-- Preis- und Kurslogik
---------------------------------------------------------------------------
create or replace function public.setting_num(p_key text)
returns numeric language sql stable as $$
  select value::numeric from public.app_settings where key = p_key
$$;

-- Liefert gültige Preis- und Kurs-IDs oder einen Fehlercode (kein Raise).
create or replace function public.pricing_state(p_model_id text)
returns table (price_version_id bigint, fx_rate_id bigint, error text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_pv bigint;
  v_fx bigint;
begin
  select id into v_pv from public.price_versions
   where model_id = p_model_id and status = 'active'
     and valid_from <= now() and (valid_until is null or valid_until > now())
     and verified_at > now() - make_interval(days => public.setting_num('price_max_age_days')::int)
   order by valid_from desc limit 1;

  select id into v_fx from public.fx_rates
   where fetched_at > now() - make_interval(hours => public.setting_num('fx_max_age_hours')::int)
   order by fetched_at desc, id desc limit 1;

  if v_pv is null then
    return query select null::bigint, v_fx, 'price_unavailable'::text; return;
  end if;
  if v_fx is null then
    return query select v_pv, null::bigint, 'fx_unavailable'::text; return;
  end if;
  return query select v_pv, v_fx, null::text;
end;
$$;

create or replace function public.current_pricing(p_model_id text)
returns table (price_version_id bigint, fx_rate_id bigint)
language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select * into s from public.pricing_state(p_model_id);
  if s.error is not null then raise exception '%', s.error; end if;
  return query select s.price_version_id, s.fx_rate_id;
end;
$$;

-- Zentrale Kostenberechnung. Einzige Stelle, an der Geld berechnet wird.
create or replace function public.compute_cost(
  p_price_version_id bigint, p_fx_rate_id bigint,
  p_input bigint, p_output bigint, p_cache_read bigint, p_cache_write bigint, p_search integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  pv public.price_versions%rowtype;
  fx public.fx_rates%rowtype;
  v_in numeric; v_out numeric; v_cr numeric; v_cw numeric;
  v_base_usd numeric; v_provider numeric; v_fxs numeric; v_mk numeric; v_total numeric;
begin
  select * into pv from public.price_versions where id = p_price_version_id;
  if not found then raise exception 'price_unavailable'; end if;
  select * into fx from public.fx_rates where id = p_fx_rate_id;
  if not found then raise exception 'fx_unavailable'; end if;

  if pv.long_context_threshold is not null
     and (p_input + p_cache_read + p_cache_write) > pv.long_context_threshold then
    v_in := coalesce(pv.long_input_usd_per_mtok, pv.input_usd_per_mtok);
    v_out := coalesce(pv.long_output_usd_per_mtok, pv.output_usd_per_mtok);
    v_cr := pv.long_cache_read_usd_per_mtok;
    v_cw := pv.long_cache_write_usd_per_mtok;
  else
    v_in := pv.input_usd_per_mtok; v_out := pv.output_usd_per_mtok;
    v_cr := pv.cache_read_usd_per_mtok; v_cw := pv.cache_write_usd_per_mtok;
  end if;
  -- Fehlt ein Cache-Preis, wird vorsichtig der normale Input-Preis angesetzt.
  v_cr := coalesce(v_cr, v_in);
  v_cw := coalesce(v_cw, v_in);

  v_base_usd := (p_input * v_in + p_output * v_out + p_cache_read * v_cr + p_cache_write * v_cw) / 1000000
                + p_search * pv.search_usd_per_request;
  v_provider := v_base_usd * fx.eur_per_usd;
  v_fxs := v_provider * public.setting_num('fx_markup_percent') / 100;
  v_mk := v_provider * public.setting_num('markup_percent') / 100;
  v_total := ceil((v_provider + v_fxs + v_mk) * 100000000) / 100000000;

  return jsonb_build_object(
    'base_usd', v_base_usd, 'provider_eur', v_provider, 'fx_eur', v_fxs,
    'markup_eur', v_mk, 'total_eur', v_total);
end;
$$;

-- Modellbeschreibung plus gültige Preis-IDs für die Edge Function.
create or replace function public.prepare_request(p_model_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m public.model_configs%rowtype; s record;
begin
  select * into m from public.model_configs where id = p_model_id and status = 'enabled';
  if not found then raise exception 'model_unavailable'; end if;
  select * into s from public.pricing_state(p_model_id);
  if s.error is not null then raise exception '%', s.error; end if;
  return jsonb_build_object(
    'provider', m.provider, 'api_model_id', m.api_model_id, 'efforts', m.efforts,
    'default_effort', m.default_effort, 'supports_web_search', m.supports_web_search,
    'context_tokens', m.context_tokens, 'max_output_cap', m.max_output_cap,
    'price_version_id', s.price_version_id, 'fx_rate_id', s.fx_rate_id);
end;
$$;

-- Wechselkurs speichern (Edge Function liefert den EZB-Referenzkurs: USD je 1 EUR).
create or replace function public.insert_fx_rate(p_usd_per_eur numeric, p_source text, p_rate_date date)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_usd_per_eur is null or p_usd_per_eur < 0.1 or p_usd_per_eur > 10 then
    raise exception 'fx_rate_implausible';
  end if;
  insert into public.fx_rates (usd_per_eur, eur_per_usd, source, rate_date)
  values (p_usd_per_eur, 1 / p_usd_per_eur, p_source, p_rate_date)
  returning id into v_id;
  return v_id;
end;
$$;

---------------------------------------------------------------------------
-- Reservierung und Abrechnung
---------------------------------------------------------------------------
create or replace function public.max_affordable_output(
  p_user uuid, p_model_id text, p_est_input bigint, p_search_cap integer, p_cap bigint)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare pr record; v_bal numeric; v_c0 numeric; v_c1 numeric; v_slope numeric; v_n bigint;
begin
  select balance_eur into v_bal from public.credit_accounts where user_id = p_user;
  if v_bal is null then return 0; end if;
  select * into pr from public.current_pricing(p_model_id);
  v_c0 := (public.compute_cost(pr.price_version_id, pr.fx_rate_id, p_est_input, 0, 0, 0, p_search_cap) ->> 'total_eur')::numeric;
  v_c1 := (public.compute_cost(pr.price_version_id, pr.fx_rate_id, p_est_input, 1000000, 0, 0, p_search_cap) ->> 'total_eur')::numeric;
  v_slope := (v_c1 - v_c0) / 1000000;
  if v_bal <= v_c0 or v_slope <= 0 then return 0; end if;
  v_n := floor((v_bal - v_c0 - 0.000001) / v_slope);
  return greatest(0, least(p_cap, v_n));
end;
$$;

create or replace function public.reserve_credit(
  p_request_id uuid, p_user uuid, p_chat uuid, p_model_id text,
  p_est_input bigint, p_max_output bigint, p_search_cap integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_open int; v_max int; v_ttl int;
  pr record; v_cost jsonb; v_amt numeric;
begin
  select status into v_status from public.profiles where id = p_user;
  if v_status is distinct from 'active' then raise exception 'account_blocked'; end if;

  v_max := public.setting_num('max_concurrent_requests')::int;
  v_ttl := public.setting_num('reservation_ttl_minutes')::int;
  select count(*) into v_open from public.reservations
   where user_id = p_user and status = 'reserved'
     and created_at > now() - make_interval(mins => v_ttl);
  if v_open >= v_max then raise exception 'too_many_concurrent'; end if;

  select * into pr from public.current_pricing(p_model_id);
  v_cost := public.compute_cost(pr.price_version_id, pr.fx_rate_id,
                                p_est_input, p_max_output, 0, 0, p_search_cap);
  v_amt := (v_cost ->> 'total_eur')::numeric;

  insert into public.reservations
    (request_id, user_id, chat_id, model_id, price_version_id, fx_rate_id, reserved_eur)
  values (p_request_id, p_user, p_chat, p_model_id, pr.price_version_id, pr.fx_rate_id, v_amt)
  on conflict (request_id) do nothing;
  if not found then
    return jsonb_build_object('duplicate', true);
  end if;

  -- Zeilensperre auf dem Konto: parallele Anfragen werden hintereinander geprüft.
  update public.credit_accounts
     set balance_eur = balance_eur - v_amt,
         reserved_eur = reserved_eur + v_amt,
         updated_at = now()
   where user_id = p_user and balance_eur >= v_amt;
  if not found then raise exception 'insufficient_credit'; end if;

  insert into public.ledger_entries
    (user_id, entry_type, amount_eur, idempotency_key, reference_type, reference_id, note)
  values (p_user, 'reservation', -v_amt, 'res:' || p_request_id, 'request', p_request_id::text, 'Reservierung für Anfrage');

  return jsonb_build_object('reserved_eur', v_amt);
end;
$$;

create or replace function public.settle_request(
  p_request_id uuid, p_input bigint, p_output bigint, p_cache_read bigint, p_cache_write bigint,
  p_search integer, p_source text, p_outcome text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.reservations%rowtype;
  v_cost jsonb; v_total numeric; v_charge numeric; v_short numeric;
begin
  select * into r from public.reservations where request_id = p_request_id for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if r.status <> 'reserved' then
    return jsonb_build_object('already', r.status);
  end if;

  v_cost := public.compute_cost(r.price_version_id, r.fx_rate_id,
              greatest(p_input, 0), greatest(p_output, 0),
              greatest(p_cache_read, 0), greatest(p_cache_write, 0), greatest(p_search, 0));
  v_total := (v_cost ->> 'total_eur')::numeric;
  v_charge := least(v_total, r.reserved_eur);
  v_short := v_total - v_charge;

  insert into public.ledger_entries
    (user_id, entry_type, amount_eur, idempotency_key, reference_type, reference_id, note)
  values (r.user_id, 'release', r.reserved_eur, 'rel:' || p_request_id, 'request', p_request_id::text, 'Reservierung freigegeben');
  if v_charge > 0 then
    insert into public.ledger_entries
      (user_id, entry_type, amount_eur, idempotency_key, reference_type, reference_id, note)
    values (r.user_id, 'charge', -v_charge, 'chg:' || p_request_id, 'request', p_request_id::text,
            case when p_source = 'estimated' then 'Abbuchung (geschätzt)' else 'Abbuchung' end);
  end if;

  update public.credit_accounts
     set balance_eur = balance_eur + r.reserved_eur - v_charge,
         reserved_eur = greatest(reserved_eur - r.reserved_eur, 0),
         updated_at = now()
   where user_id = r.user_id;

  update public.reservations
     set status = 'settled', settled_at = now(), final_eur = v_charge
   where request_id = p_request_id;

  insert into public.usage_events
    (request_id, user_id, chat_id, model_id, price_version_id, fx_rate_id,
     input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, search_requests,
     base_cost_usd, provider_cost_eur, fx_surcharge_eur, markup_eur,
     total_eur, charged_eur, shortfall_eur, reserved_eur, usage_source, outcome)
  values
    (p_request_id, r.user_id, r.chat_id, r.model_id, r.price_version_id, r.fx_rate_id,
     greatest(p_input, 0), greatest(p_output, 0), greatest(p_cache_read, 0), greatest(p_cache_write, 0), greatest(p_search, 0),
     (v_cost ->> 'base_usd')::numeric, (v_cost ->> 'provider_eur')::numeric,
     (v_cost ->> 'fx_eur')::numeric, (v_cost ->> 'markup_eur')::numeric,
     v_total, v_charge, v_short, r.reserved_eur, p_source, p_outcome);

  return jsonb_build_object('charged_eur', v_charge, 'total_eur', v_total, 'shortfall_eur', v_short,
                            'reserved_eur', r.reserved_eur, 'estimated', p_source = 'estimated');
end;
$$;

-- Gibt eine Reservierung ohne Kosten frei (z. B. Anbieterfehler vor der Antwort).
create or replace function public.release_reservation(p_request_id uuid, p_reason text, p_new_status text default 'released')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.reservations%rowtype;
begin
  select * into r from public.reservations where request_id = p_request_id for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if r.status <> 'reserved' then return jsonb_build_object('already', r.status); end if;

  insert into public.ledger_entries
    (user_id, entry_type, amount_eur, idempotency_key, reference_type, reference_id, note)
  values (r.user_id, 'release', r.reserved_eur, 'rel:' || p_request_id, 'request', p_request_id::text,
          left('Reservierung freigegeben: ' || coalesce(p_reason, ''), 200));

  update public.credit_accounts
     set balance_eur = balance_eur + r.reserved_eur,
         reserved_eur = greatest(reserved_eur - r.reserved_eur, 0),
         updated_at = now()
   where user_id = r.user_id;

  update public.reservations
     set status = p_new_status, settled_at = now(), final_eur = 0
   where request_id = p_request_id;
  return jsonb_build_object('released_eur', r.reserved_eur);
end;
$$;

-- Räumt hängende Reservierungen auf (kostenlos freigegeben, im Admin sichtbar als "expired").
create or replace function public.expire_stale_reservations()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; v_ttl int;
begin
  v_ttl := public.setting_num('reservation_ttl_minutes')::int;
  for r in select request_id from public.reservations
            where status = 'reserved' and created_at < now() - make_interval(mins => v_ttl)
            for update skip locked
  loop
    perform public.release_reservation(r.request_id, 'Zeitüberschreitung', 'expired');
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.check_rate_limit(p_user uuid, p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_start timestamptz; v_hits int;
begin
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits (user_id, bucket, window_start, hits)
  values (p_user, p_bucket, v_start, 1)
  on conflict (user_id, bucket, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return v_hits <= p_limit;
end;
$$;

-- Betreiber: Guthaben von Hand buchen (im SQL Editor ausführen). Begründung ist Pflicht.
create or replace function public.admin_add_credit(p_user uuid, p_amount numeric, p_reason text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_amount is null or p_amount = 0 then raise exception 'amount_required'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then raise exception 'reason_required'; end if;
  if not exists (select 1 from public.credit_accounts where user_id = p_user) then
    raise exception 'user_not_found';
  end if;

  insert into public.ledger_entries
    (user_id, entry_type, amount_eur, idempotency_key, reference_type, note)
  values (p_user, 'admin_adjustment', p_amount, 'adm:' || gen_random_uuid(), 'admin', left(trim(p_reason), 200))
  returning id into v_id;

  update public.credit_accounts
     set balance_eur = balance_eur + p_amount, updated_at = now()
   where user_id = p_user;

  insert into public.admin_audit_log (admin_user, action, target_user, details)
  values (auth.uid(), 'add_credit', p_user, jsonb_build_object('amount_eur', p_amount, 'reason', p_reason, 'ledger_id', v_id));
  return v_id;
end;
$$;

-- Konsistenzprüfung: Kontostand muss der Summe der Buchungen entsprechen.
create or replace function public.ledger_consistency()
returns table (user_id uuid, balance_eur numeric, ledger_sum numeric, difference numeric)
language sql stable security definer set search_path = public as $$
  select a.user_id, a.balance_eur, coalesce(sum(l.amount_eur), 0), a.balance_eur - coalesce(sum(l.amount_eur), 0)
    from public.credit_accounts a
    left join public.ledger_entries l on l.user_id = a.user_id
   group by a.user_id, a.balance_eur
  having a.balance_eur - coalesce(sum(l.amount_eur), 0) <> 0
$$;

---------------------------------------------------------------------------
-- Für die Oberfläche
---------------------------------------------------------------------------
create or replace function public.list_models_public()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m record; s record; pv public.price_versions%rowtype; fx public.fx_rates%rowtype;
  v_out jsonb := '[]'::jsonb; v_factor numeric; v_avail boolean; v_reason text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  v_factor := 1 + (public.setting_num('markup_percent') + public.setting_num('fx_markup_percent')) / 100;

  for m in select * from public.model_configs where status = 'enabled' order by sort_order, id loop
    select * into s from public.pricing_state(m.id);
    v_avail := s.error is null; v_reason := s.error;
    pv := null; fx := null;
    if s.price_version_id is not null then select * into pv from public.price_versions where id = s.price_version_id; end if;
    if s.fx_rate_id is not null then select * into fx from public.fx_rates where id = s.fx_rate_id; end if;
    v_out := v_out || jsonb_build_object(
      'id', m.id, 'provider', m.provider, 'display_name', m.display_name,
      'speed_class', m.speed_class, 'reasoning_class', m.reasoning_class, 'description', m.description,
      'efforts', m.efforts, 'default_effort', m.default_effort,
      'supports_web_search', m.supports_web_search,
      'context_tokens', m.context_tokens, 'max_output_cap', m.max_output_cap,
      'available', v_avail, 'unavailable_reason', v_reason,
      'price_usd_in', pv.input_usd_per_mtok, 'price_usd_out', pv.output_usd_per_mtok,
      'price_eur_in', case when fx.id is not null and pv.id is not null then pv.input_usd_per_mtok * fx.eur_per_usd * v_factor end,
      'price_eur_out', case when fx.id is not null and pv.id is not null then pv.output_usd_per_mtok * fx.eur_per_usd * v_factor end,
      'search_eur_per_request', case when fx.id is not null and pv.id is not null then pv.search_usd_per_request * fx.eur_per_usd * v_factor end,
      'price_valid_until', pv.valid_until);
  end loop;
  return v_out;
end;
$$;

create or replace function public.search_chats(p_query text)
returns setof public.chats language sql stable security invoker set search_path = public as $$
  select c.* from public.chats c
   where c.user_id = auth.uid()
     and (c.title ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or exists (select 1 from public.messages m where m.chat_id = c.id
                      and m.content ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'))
   order by c.updated_at desc limit 50
$$;

---------------------------------------------------------------------------
-- Rechte und Row Level Security
---------------------------------------------------------------------------
alter table public.app_settings     enable row level security;
alter table public.model_configs    enable row level security;
alter table public.price_versions   enable row level security;
alter table public.fx_rates         enable row level security;
alter table public.chats            enable row level security;
alter table public.messages         enable row level security;
alter table public.reservations     enable row level security;
alter table public.usage_events     enable row level security;
alter table public.rate_limits      enable row level security;
alter table public.admin_audit_log  enable row level security;

revoke all on public.app_settings, public.model_configs, public.price_versions, public.fx_rates,
  public.chats, public.messages, public.reservations, public.usage_events, public.rate_limits,
  public.admin_audit_log from anon, authenticated;

grant select, delete on public.chats to authenticated;
grant update (title) on public.chats to authenticated;
grant select on public.messages to authenticated;
grant select on public.usage_events to authenticated;

drop policy if exists chats_select_own on public.chats;
create policy chats_select_own on public.chats for select to authenticated using (user_id = auth.uid());
drop policy if exists chats_update_own on public.chats;
create policy chats_update_own on public.chats for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists chats_delete_own on public.chats;
create policy chats_delete_own on public.chats for delete to authenticated using (user_id = auth.uid());

drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages for select to authenticated using (user_id = auth.uid());

drop policy if exists usage_select_own on public.usage_events;
create policy usage_select_own on public.usage_events for select to authenticated using (user_id = auth.uid());

-- Interne Funktionen: nur die Serverseite (service_role) darf sie aufrufen.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('pricing_state', 'current_pricing', 'compute_cost', 'prepare_request',
                         'insert_fx_rate', 'max_affordable_output', 'reserve_credit', 'settle_request',
                         'release_reservation', 'expire_stale_reservations', 'check_rate_limit',
                         'admin_add_credit', 'ledger_consistency', 'setting_num')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;

  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('list_models_public', 'search_chats')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
