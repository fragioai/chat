-- Fragio – Migration 0005: Automatische Preisprüfung (Anthropic)
-- Voraussetzung: 0001 bis 0004. Sicher wiederholbar.

create table if not exists public.price_update_log (
  id bigint generated always as identity primary key,
  run_at timestamptz not null default now(),
  status text not null check (status in ('ok', 'changed', 'pending', 'failed')),
  details jsonb
);
alter table public.price_update_log enable row level security;
revoke all on public.price_update_log from anon, authenticated;

-- Preise gelten nur, wenn sie in den letzten 14 Tagen bestätigt wurden (Automatik läuft täglich).
update public.app_settings set value = '14', updated_at = now() where key = 'price_max_age_days';

-- Bestätigt unveränderte Preise (setzt verified_at).
create or replace function public.confirm_prices(p_ids bigint[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.price_versions set verified_at = now() where id = any (p_ids) and status = 'active';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Übernimmt einen geänderten Preis: alte Version wird beendet, neue beginnt jetzt.
-- Bereits reservierte oder abgerechnete Anfragen behalten ihre alte Preisversion.
create or replace function public.apply_price_update(
  p_model_id text, p_in numeric, p_out numeric, p_cr numeric, p_cw numeric,
  p_long_threshold integer, p_long_in numeric, p_long_out numeric, p_long_cr numeric, p_long_cw numeric,
  p_search numeric, p_source text, p_note text, p_status text default 'active')
returns bigint language plpgsql security definer set search_path = public as $$
declare v_old public.price_versions%rowtype; v_id bigint;
begin
  if p_status not in ('active', 'pending') then raise exception 'invalid_status'; end if;
  select * into v_old from public.price_versions
   where model_id = p_model_id and status = 'active'
     and valid_from <= now() and (valid_until is null or valid_until > now())
   order by valid_from desc limit 1 for update;

  if p_status = 'active' and found then
    update public.price_versions set valid_until = now() where id = v_old.id;
  end if;

  insert into public.price_versions
    (model_id, input_usd_per_mtok, output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok,
     long_context_threshold, long_input_usd_per_mtok, long_output_usd_per_mtok,
     long_cache_read_usd_per_mtok, long_cache_write_usd_per_mtok,
     search_usd_per_request, source_url, valid_from, valid_until, verified_at, status, note)
  values
    (p_model_id, p_in, p_out, p_cr, p_cw, p_long_threshold, p_long_in, p_long_out, p_long_cr, p_long_cw,
     p_search, p_source, now(), null, now(), p_status, p_note)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.log_price_update(p_status text, p_details jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.price_update_log (status, details) values (p_status, p_details) returning id into v_id;
  delete from public.price_update_log where run_at < now() - interval '180 days';
  return v_id;
end;
$$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('confirm_prices', 'apply_price_update', 'log_price_update')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
