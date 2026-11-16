-- Fragio – Migration 0014: Steuerzuschlag des KI-Anbieters
-- Voraussetzung: 0001 bis 0012 (0013 nicht nötig). Sicher wiederholbar.
-- Neue Einstellung provider_tax_percent (Standard 19). Der Zuschlag wird auf die Anbieterkosten gerechnet,
-- getrennt ausgewiesen und ist im Admin änderbar. Der Aufschlag (10 %) bleibt auf den Anbieterkosten ohne Steuer.

insert into public.app_settings (key, value) values ('provider_tax_percent', '19')
on conflict (key) do nothing;

alter table public.usage_events add column if not exists tax_eur numeric(24, 12) not null default 0;

create or replace function public.compute_cost(
  p_price_version_id bigint, p_fx_rate_id bigint,
  p_input bigint, p_output bigint, p_cache_read bigint, p_cache_write bigint, p_search integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  pv public.price_versions%rowtype;
  fx public.fx_rates%rowtype;
  v_in numeric; v_out numeric; v_cr numeric; v_cw numeric;
  v_base_usd numeric; v_provider numeric; v_fxs numeric; v_mk numeric; v_tax numeric; v_total numeric;
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
  v_tax := v_provider * coalesce(public.setting_num('provider_tax_percent'), 0) / 100;
  v_total := ceil((v_provider + v_fxs + v_mk + v_tax) * 100000000) / 100000000;

  return jsonb_build_object(
    'base_usd', v_base_usd, 'provider_eur', v_provider, 'fx_eur', v_fxs,
    'markup_eur', v_mk, 'tax_eur', v_tax, 'total_eur', v_total);
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
     base_cost_usd, provider_cost_eur, fx_surcharge_eur, markup_eur, tax_eur,
     total_eur, charged_eur, shortfall_eur, reserved_eur, usage_source, outcome)
  values
    (p_request_id, r.user_id, r.chat_id, r.model_id, r.price_version_id, r.fx_rate_id,
     greatest(p_input, 0), greatest(p_output, 0), greatest(p_cache_read, 0), greatest(p_cache_write, 0), greatest(p_search, 0),
     (v_cost ->> 'base_usd')::numeric, (v_cost ->> 'provider_eur')::numeric,
     (v_cost ->> 'fx_eur')::numeric, (v_cost ->> 'markup_eur')::numeric, (v_cost ->> 'tax_eur')::numeric,
     v_total, v_charge, v_short, r.reserved_eur, p_source, p_outcome);

  return jsonb_build_object('charged_eur', v_charge, 'total_eur', v_total, 'shortfall_eur', v_short,
                            'reserved_eur', r.reserved_eur, 'estimated', p_source = 'estimated');
end;
$$;

create or replace function public.list_models_public()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m record; s record; pv public.price_versions%rowtype; fx public.fx_rates%rowtype;
  v_out jsonb := '[]'::jsonb; v_factor numeric; v_avail boolean; v_reason text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  v_factor := 1 + (public.setting_num('markup_percent') + public.setting_num('fx_markup_percent') + coalesce(public.setting_num('provider_tax_percent'), 0)) / 100;

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

create or replace function public.my_usage_summary(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_days integer := least(greatest(coalesce(p_days, 30), 1), 3650);
begin
  if v_user is null then raise exception 'unauthorized'; end if;
  return jsonb_build_object(
    'days', v_days,
    'balance_eur', (select balance_eur from public.credit_accounts where user_id = v_user),
    'reserved_eur', (select reserved_eur from public.credit_accounts where user_id = v_user),
    'deposits_total_eur', (select coalesce(sum(amount_eur), 0) from public.ledger_entries where user_id = v_user and entry_type = 'deposit'),
    'refunds_total_eur', (select coalesce(sum(amount_eur), 0) from public.ledger_entries where user_id = v_user and entry_type = 'refund'),
    'corrections_total_eur', (select coalesce(sum(amount_eur), 0) from public.ledger_entries where user_id = v_user and entry_type in ('correction', 'admin_adjustment')),
    'charged_total_eur', (select coalesce(sum(charged_eur), 0) from public.usage_events where user_id = v_user),
    'period', (select jsonb_build_object(
        'requests', count(*),
        'provider_cost_eur', coalesce(sum(provider_cost_eur), 0),
        'surcharges_eur', coalesce(sum(fx_surcharge_eur + markup_eur + tax_eur), 0),
        'tax_eur', coalesce(sum(tax_eur), 0),
        'markup_eur', coalesce(sum(markup_eur), 0),
        'fx_surcharge_eur', coalesce(sum(fx_surcharge_eur), 0),
        'charged_eur', coalesce(sum(charged_eur), 0),
        'estimated_eur', coalesce(sum(charged_eur) filter (where usage_source = 'estimated'), 0),
        'estimated_requests', count(*) filter (where usage_source = 'estimated'))
        from public.usage_events where user_id = v_user and created_at > now() - make_interval(days => v_days)),
    'by_model', (select coalesce(jsonb_agg(to_jsonb(r) order by r.charged_eur desc), '[]'::jsonb) from (
        select model_id, count(*) as requests,
               coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens,
               coalesce(sum(cache_read_tokens), 0) as cache_read_tokens, coalesce(sum(cache_write_tokens), 0) as cache_write_tokens,
               coalesce(sum(search_requests), 0) as searches,
               coalesce(sum(provider_cost_eur), 0) as provider_cost_eur,
               coalesce(sum(fx_surcharge_eur + markup_eur + tax_eur), 0) as surcharges_eur,
               coalesce(sum(charged_eur), 0) as charged_eur
          from public.usage_events where user_id = v_user and created_at > now() - make_interval(days => v_days)
         group by model_id) r));
end;
$$;

create or replace function public.my_usage_list(p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'unauthorized'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) from (
    select e.id, e.created_at, e.model_id, e.usage_source, e.outcome,
           e.input_tokens, e.output_tokens, e.cache_read_tokens, e.cache_write_tokens, e.search_requests,
           e.provider_cost_eur, e.fx_surcharge_eur, e.markup_eur, e.tax_eur, e.total_eur, e.charged_eur, e.shortfall_eur, e.reserved_eur,
           x.in_usd, x.out_usd, x.cr_usd, x.cw_usd, pv.search_usd_per_request as search_usd,
           f.eur_per_usd,
           e.input_tokens * x.in_usd / 1000000 * f.eur_per_usd as input_eur,
           e.output_tokens * x.out_usd / 1000000 * f.eur_per_usd as output_eur,
           e.cache_read_tokens * x.cr_usd / 1000000 * f.eur_per_usd as cache_read_eur,
           e.cache_write_tokens * x.cw_usd / 1000000 * f.eur_per_usd as cache_write_eur,
           e.search_requests * pv.search_usd_per_request * f.eur_per_usd as search_eur
      from public.usage_events e
      join public.price_versions pv on pv.id = e.price_version_id
      join public.fx_rates f on f.id = e.fx_rate_id
      cross join lateral (
        select case when pv.long_context_threshold is not null
                     and (e.input_tokens + e.cache_read_tokens + e.cache_write_tokens) > pv.long_context_threshold
                    then coalesce(pv.long_input_usd_per_mtok, pv.input_usd_per_mtok) else pv.input_usd_per_mtok end as in_usd,
               case when pv.long_context_threshold is not null
                     and (e.input_tokens + e.cache_read_tokens + e.cache_write_tokens) > pv.long_context_threshold
                    then coalesce(pv.long_output_usd_per_mtok, pv.output_usd_per_mtok) else pv.output_usd_per_mtok end as out_usd,
               coalesce(case when pv.long_context_threshold is not null
                     and (e.input_tokens + e.cache_read_tokens + e.cache_write_tokens) > pv.long_context_threshold
                    then pv.long_cache_read_usd_per_mtok else pv.cache_read_usd_per_mtok end,
                    case when pv.long_context_threshold is not null
                     and (e.input_tokens + e.cache_read_tokens + e.cache_write_tokens) > pv.long_context_threshold
                    then coalesce(pv.long_input_usd_per_mtok, pv.input_usd_per_mtok) else pv.input_usd_per_mtok end) as cr_usd,
               coalesce(case when pv.long_context_threshold is not null
                     and (e.input_tokens + e.cache_read_tokens + e.cache_write_tokens) > pv.long_context_threshold
                    then pv.long_cache_write_usd_per_mtok else pv.cache_write_usd_per_mtok end,
                    case when pv.long_context_threshold is not null
                     and (e.input_tokens + e.cache_read_tokens + e.cache_write_tokens) > pv.long_context_threshold
                    then coalesce(pv.long_input_usd_per_mtok, pv.input_usd_per_mtok) else pv.input_usd_per_mtok end) as cw_usd
      ) x
     where e.user_id = v_user
     order by e.created_at desc
     limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) r);
end;
$$;

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
        'tax_eur', coalesce(sum(tax_eur), 0),
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
               coalesce(sum(fx_surcharge_eur + markup_eur + tax_eur), 0) as surcharges_eur,
               coalesce(sum(tax_eur), 0) as tax_eur,
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

create or replace function public.admin_export(p_kind text, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_from timestamptz := coalesce(p_from, now() - interval '30 days'); v_to timestamptz := coalesce(p_to, now());
begin
  if p_kind = 'usage' then
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v from (
      select e.created_at, e.request_id, e.user_id, u.email, e.model_id, e.price_version_id, e.fx_rate_id,
             e.input_tokens, e.output_tokens, e.cache_read_tokens, e.cache_write_tokens, e.search_requests,
             e.base_cost_usd, e.provider_cost_eur, e.fx_surcharge_eur, e.markup_eur, e.tax_eur, e.total_eur,
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
    new.total_eur::text, new.charged_eur::text, new.reserved_eur::text, new.usage_source, new.outcome, new.request_id::text, new.tax_eur::text)))
  on conflict (event_key) do nothing;
  return new;
exception when others then
  -- Die Abrechnung darf niemals an der Dokumentation scheitern.
  return new;
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
    (p_key = 'reservation_ttl_minutes' and v_num between 2 and 120) or
    (p_key = 'max_file_bytes' and v_num between 100000 and 6291456) or
    (p_key = 'max_user_bytes' and v_num between 1000000 and 1073741824) or
    (p_key = 'max_total_bytes' and v_num between 10000000 and 1073741824) or
    (p_key = 'max_files_per_message' and v_num between 1 and 10) or
    (p_key = 'provider_file_ttl_days' and v_num between 1 and 30) or
    (p_key = 'provider_tax_percent' and v_num between 0 and 30)
  ) then raise exception 'key_or_range_invalid'; end if;
  select value into v_old from public.app_settings where key = p_key for update;
  if not found then raise exception 'key_invalid'; end if;
  update public.app_settings set value = p_value, updated_at = now() where key = p_key;
  insert into public.admin_audit_log (admin_user, action, details)
  values (p_admin, 'update_setting', jsonb_build_object('key', p_key, 'from', v_old, 'to', p_value, 'reason', p_reason));
end;
$$;
