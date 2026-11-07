-- Fragio – Migration 0010: Nutzungsübersicht für Nutzer (nur eigene Daten)
-- Voraussetzung: 0001 bis 0009. Sicher wiederholbar.

-- Zusammenfassung des eigenen Kontos
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
        'surcharges_eur', coalesce(sum(fx_surcharge_eur + markup_eur), 0),
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
               coalesce(sum(fx_surcharge_eur + markup_eur), 0) as surcharges_eur,
               coalesce(sum(charged_eur), 0) as charged_eur
          from public.usage_events where user_id = v_user and created_at > now() - make_interval(days => v_days)
         group by model_id) r));
end;
$$;

-- Einzelne Anfragen mit Aufschlüsselung je Kostenart (Tokens x Preis, in Euro, vor Aufschlägen)
create or replace function public.my_usage_list(p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'unauthorized'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) from (
    select e.id, e.created_at, e.model_id, e.usage_source, e.outcome,
           e.input_tokens, e.output_tokens, e.cache_read_tokens, e.cache_write_tokens, e.search_requests,
           e.provider_cost_eur, e.fx_surcharge_eur, e.markup_eur, e.total_eur, e.charged_eur, e.shortfall_eur, e.reserved_eur,
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

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('my_usage_summary', 'my_usage_list') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
