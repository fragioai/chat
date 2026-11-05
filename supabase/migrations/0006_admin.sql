-- Fragio – Migration 0006: Administration (Auswertungen, Protokolle, geschützte Aktionen)
-- Voraussetzung: 0001 bis 0005. Sicher wiederholbar.
-- Alle Funktionen sind nur für die Serverseite (service_role) aufrufbar. Der Browser kommt nur
-- über die Edge Function "admin" heran, die Rolle UND Zwei-Faktor-Anmeldung prüft.

---------------------------------------------------------------------------
-- Protokolltabellen
---------------------------------------------------------------------------
create table if not exists public.api_errors (
  id bigint generated always as identity primary key,
  request_id uuid,
  user_id uuid references auth.users (id) on delete set null,
  model_id text,
  provider text,
  code text not null,
  http_status integer,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists api_errors_created_idx on public.api_errors (created_at desc);

create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  user_id uuid references auth.users (id) on delete set null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists security_events_created_idx on public.security_events (created_at desc);

alter table public.api_errors enable row level security;
alter table public.security_events enable row level security;
revoke all on public.api_errors, public.security_events from anon, authenticated;

create or replace function public.log_api_error(
  p_request_id uuid, p_user uuid, p_model text, p_provider text, p_code text, p_status integer, p_detail text)
returns void language sql security definer set search_path = public as $$
  insert into public.api_errors (request_id, user_id, model_id, provider, code, http_status, detail)
  values (p_request_id, p_user, p_model, p_provider, left(p_code, 80), p_status, left(coalesce(p_detail, ''), 500));
  delete from public.api_errors where created_at < now() - interval '90 days';
$$;

create or replace function public.log_security_event(p_type text, p_user uuid, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.security_events (event_type, user_id, details)
  values (left(p_type, 80), p_user, p_details);
  delete from public.security_events where created_at < now() - interval '180 days';
$$;

---------------------------------------------------------------------------
-- Auswertungen (nur lesen)
---------------------------------------------------------------------------
create or replace function public.admin_overview(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  return jsonb_build_object(
    'days', v_days,
    'users', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'active', (select count(*) from public.profiles where status = 'active'),
      'blocked', (select count(*) from public.profiles where status = 'blocked'),
      'new_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days')),
    'credit', jsonb_build_object(
      'sum_balance', (select coalesce(sum(balance_eur), 0) from public.credit_accounts),
      'sum_reserved', (select coalesce(sum(reserved_eur), 0) from public.credit_accounts)),
    'totals', (
      select jsonb_build_object(
        'requests', count(*),
        'provider_cost_eur', coalesce(sum(provider_cost_eur), 0),
        'fx_surcharge_eur', coalesce(sum(fx_surcharge_eur), 0),
        'markup_eur', coalesce(sum(markup_eur), 0),
        'charged_eur', coalesce(sum(charged_eur), 0),
        'shortfall_eur', coalesce(sum(shortfall_eur), 0),
        'estimated', count(*) filter (where usage_source = 'estimated'))
        from public.usage_events where created_at > now() - make_interval(days => v_days)),
    'by_model', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.model_id), '[]'::jsonb) from (
        select model_id, count(*) as requests,
               coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens,
               coalesce(sum(cache_read_tokens), 0) as cache_read_tokens, coalesce(sum(cache_write_tokens), 0) as cache_write_tokens,
               coalesce(sum(search_requests), 0) as searches,
               coalesce(sum(provider_cost_eur), 0) as provider_cost_eur,
               coalesce(sum(fx_surcharge_eur + markup_eur), 0) as surcharges_eur,
               coalesce(sum(charged_eur), 0) as charged_eur,
               count(*) filter (where usage_source = 'estimated') as estimated
          from public.usage_events where created_at > now() - make_interval(days => v_days)
         group by model_id) r),
    'operations', jsonb_build_object(
      'open_reservations', (select count(*) from public.reservations where status = 'reserved'),
      'expired_24h', (select count(*) from public.reservations where status = 'expired' and settled_at > now() - interval '24 hours'),
      'api_errors_24h', (select count(*) from public.api_errors where created_at > now() - interval '24 hours'),
      'security_events_24h', (select count(*) from public.security_events where created_at > now() - interval '24 hours'),
      'ledger_inconsistencies', (select count(*) from public.ledger_consistency()),
      'shortfall_30d_eur', (select coalesce(sum(shortfall_eur), 0) from public.usage_events where created_at > now() - interval '30 days')),
    'fx', (select to_jsonb(f) from (select usd_per_eur, eur_per_usd, source, rate_date, fetched_at
             from public.fx_rates order by fetched_at desc, id desc limit 1) f),
    'last_price_update', (select to_jsonb(l) from (select run_at, status, details
             from public.price_update_log order by run_at desc limit 1) l),
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.app_settings));
end;
$$;

create or replace function public.admin_users(p_query text, p_limit integer, p_offset integer)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
    select u.id, u.email, p.display_name, p.status, u.created_at, u.last_sign_in_at,
           a.balance_eur, a.reserved_eur,
           (select coalesce(sum(e.charged_eur), 0) from public.usage_events e
             where e.user_id = u.id and e.created_at > now() - interval '30 days') as spent_30d
      from auth.users u
      join public.profiles p on p.id = u.id
      left join public.credit_accounts a on a.user_id = u.id
     where coalesce(p_query, '') = ''
        or u.email ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        or p.display_name ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
     order by u.created_at desc
     limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) r
$$;

create or replace function public.admin_user_detail(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
    'email_confirmed_at', u.email_confirmed_at,
    'display_name', p.display_name, 'status', p.status,
    'balance_eur', a.balance_eur, 'reserved_eur', a.reserved_eur,
    'chats', (select count(*) from public.chats c where c.user_id = u.id),
    'messages', (select count(*) from public.messages m where m.user_id = u.id),
    'ledger', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from (
                 select id, entry_type, amount_eur, note, created_at from public.ledger_entries
                  where user_id = u.id order by created_at desc, id desc limit 50) l),
    'usage', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from (
                 select model_id, input_tokens, output_tokens, search_requests, provider_cost_eur,
                        fx_surcharge_eur, markup_eur, charged_eur, usage_source, outcome, created_at
                   from public.usage_events where user_id = u.id order by created_at desc limit 50) e),
    'errors', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
                 select model_id, code, http_status, created_at from public.api_errors
                  where user_id = u.id order by created_at desc limit 20) x),
    'security', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from (
                 select event_type, details, created_at from public.security_events
                  where user_id = u.id order by created_at desc limit 20) s))
    into v
    from auth.users u
    join public.profiles p on p.id = u.id
    left join public.credit_accounts a on a.user_id = u.id
   where u.id = p_user;
  if v is null then raise exception 'user_not_found'; end if;
  return v;
end;
$$;

create or replace function public.admin_models()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order, r.id), '[]'::jsonb) from (
    select m.id, m.provider, m.api_model_id, m.display_name, m.status, m.sort_order,
           m.context_tokens, m.max_output_cap,
           (select s.error from public.pricing_state(m.id) s) as price_error,
           (select to_jsonb(v) from (
              select id, input_usd_per_mtok, output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok,
                     search_usd_per_request, valid_from, valid_until, verified_at
                from public.price_versions
               where model_id = m.id and status = 'active' and valid_from <= now()
                 and (valid_until is null or valid_until > now())
               order by valid_from desc limit 1) v) as current_price
      from public.model_configs m) r
$$;

create or replace function public.admin_rate_top()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
    select l.user_id, u.email, sum(l.hits) as hits_1h
      from public.rate_limits l left join auth.users u on u.id = l.user_id
     where l.window_start > now() - interval '1 hour'
     group by l.user_id, u.email order by sum(l.hits) desc limit 20) r
$$;

create or replace function public.admin_export(p_kind text, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_from timestamptz := coalesce(p_from, now() - interval '30 days'); v_to timestamptz := coalesce(p_to, now());
begin
  if p_kind = 'usage' then
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v from (
      select e.created_at, e.request_id, e.user_id, u.email, e.model_id, e.price_version_id, e.fx_rate_id,
             e.input_tokens, e.output_tokens, e.cache_read_tokens, e.cache_write_tokens, e.search_requests,
             e.base_cost_usd, e.provider_cost_eur, e.fx_surcharge_eur, e.markup_eur, e.total_eur,
             e.charged_eur, e.shortfall_eur, e.reserved_eur, e.usage_source, e.outcome
        from public.usage_events e left join auth.users u on u.id = e.user_id
       where e.created_at >= v_from and e.created_at < v_to order by e.created_at limit 50000) r;
  elsif p_kind = 'ledger' then
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v from (
      select l.created_at, l.id, l.user_id, u.email, l.entry_type, l.amount_eur, l.reference_type, l.reference_id, l.note
        from public.ledger_entries l left join auth.users u on u.id = l.user_id
       where l.created_at >= v_from and l.created_at < v_to order by l.created_at, l.id limit 50000) r;
  elsif p_kind = 'users' then
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v from (
      select u.id, u.email, p.display_name, p.status, u.created_at, u.last_sign_in_at, a.balance_eur
        from auth.users u join public.profiles p on p.id = u.id
        left join public.credit_accounts a on a.user_id = u.id order by u.created_at limit 50000) r;
  elsif p_kind = 'audit' then
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v from (
      select created_at, id, admin_user, action, target_user, details from public.admin_audit_log
       where created_at >= v_from and created_at < v_to order by created_at limit 50000) r;
  else
    raise exception 'unknown_export';
  end if;
  return v;
end;
$$;

---------------------------------------------------------------------------
-- Geschützte Aktionen (alle mit Pflicht-Begründung und Audit-Eintrag)
---------------------------------------------------------------------------
create or replace function public.admin_adjust_credit(p_admin uuid, p_user uuid, p_amount numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new numeric; v_id bigint;
begin
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000 then raise exception 'amount_invalid'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  perform 1 from public.credit_accounts where user_id = p_user for update;
  if not found then raise exception 'user_not_found'; end if;

  update public.credit_accounts set balance_eur = balance_eur + p_amount, updated_at = now()
   where user_id = p_user and balance_eur + p_amount >= 0
   returning balance_eur into v_new;
  if v_new is null then raise exception 'balance_would_be_negative'; end if;

  insert into public.ledger_entries (user_id, entry_type, amount_eur, idempotency_key, reference_type, note)
  values (p_user, 'admin_adjustment', p_amount, 'adm:' || gen_random_uuid(), 'admin', left(trim(p_reason), 200))
  returning id into v_id;

  insert into public.admin_audit_log (admin_user, action, target_user, details)
  values (p_admin, 'adjust_credit', p_user, jsonb_build_object('amount_eur', p_amount, 'reason', p_reason, 'ledger_id', v_id, 'new_balance', v_new));
  return jsonb_build_object('balance_eur', v_new, 'ledger_id', v_id);
end;
$$;

create or replace function public.admin_set_user_status(p_admin uuid, p_user uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if p_status not in ('active', 'blocked') then raise exception 'status_invalid'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  if p_admin = p_user then raise exception 'cannot_change_self'; end if;
  select status into v_old from public.profiles where id = p_user for update;
  if not found then raise exception 'user_not_found'; end if;
  if v_old = 'deletion_requested' then raise exception 'deletion_pending'; end if;
  update public.profiles set status = p_status where id = p_user;
  insert into public.admin_audit_log (admin_user, action, target_user, details)
  values (p_admin, 'set_user_status', p_user, jsonb_build_object('from', v_old, 'to', p_status, 'reason', p_reason));
end;
$$;

create or replace function public.admin_set_model_status(p_admin uuid, p_model text, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if p_status not in ('enabled', 'disabled') then raise exception 'status_invalid'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  select status into v_old from public.model_configs where id = p_model for update;
  if not found then raise exception 'model_not_found'; end if;
  update public.model_configs set status = p_status where id = p_model;
  insert into public.admin_audit_log (admin_user, action, details)
  values (p_admin, 'set_model_status', jsonb_build_object('model', p_model, 'from', v_old, 'to', p_status, 'reason', p_reason));
end;
$$;

create or replace function public.admin_approve_price(p_admin uuid, p_price_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.price_versions%rowtype;
begin
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  select * into v from public.price_versions where id = p_price_id for update;
  if not found or v.status <> 'pending' then raise exception 'price_not_pending'; end if;
  update public.price_versions set valid_until = now()
   where model_id = v.model_id and status = 'active' and valid_from <= now()
     and (valid_until is null or valid_until > now());
  update public.price_versions set status = 'active', valid_from = now(), valid_until = null, verified_at = now()
   where id = p_price_id;
  insert into public.admin_audit_log (admin_user, action, details)
  values (p_admin, 'approve_price', jsonb_build_object('price_id', p_price_id, 'model', v.model_id, 'reason', p_reason));
end;
$$;

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
    (p_key = 'reservation_ttl_minutes' and v_num between 2 and 120)
  ) then raise exception 'key_or_range_invalid'; end if;
  select value into v_old from public.app_settings where key = p_key for update;
  if not found then raise exception 'key_invalid'; end if;
  update public.app_settings set value = p_value, updated_at = now() where key = p_key;
  insert into public.admin_audit_log (admin_user, action, details)
  values (p_admin, 'update_setting', jsonb_build_object('key', p_key, 'from', v_old, 'to', p_value, 'reason', p_reason));
end;
$$;

create or replace function public.admin_log(p_admin uuid, p_action text, p_target uuid, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.admin_audit_log (admin_user, action, target_user, details)
  values (p_admin, left(p_action, 80), p_target, p_details);
$$;

-- Nur die Serverseite darf diese Funktionen aufrufen.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('log_api_error', 'log_security_event', 'admin_overview', 'admin_users', 'admin_user_detail',
                         'admin_models', 'admin_rate_top', 'admin_export', 'admin_adjust_credit',
                         'admin_set_user_status', 'admin_set_model_status', 'admin_approve_price',
                         'admin_update_setting', 'admin_log')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
