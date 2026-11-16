-- Fragio – Funktionstest der Abrechnung (Phase 4a).
-- Läuft komplett in einer Transaktion und wird am Ende IMMER zurückgerollt: es bleiben keine Daten übrig.
-- Erwartung: Der SQL Editor meldet am Ende einen "Fehler" mit dem Text
--   SELFTEST BESTANDEN (alles zurückgerollt)
-- Jede andere Meldung bedeutet: Test fehlgeschlagen. Bitte Text an Claude schicken.
-- Voraussetzung: Migrationen 0001 bis 0004. Ohne Konto legt der Test ein Testkonto an (wird zurückgerollt).

do $$
declare
  v_user uuid; v_fx bigint; v_req uuid := gen_random_uuid(); v_req2 uuid := gen_random_uuid();
  v_factor numeric; v_res jsonb; v_bal numeric; v_charged numeric; v_cnt int; v_cnt0 int; v_base numeric;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then
    -- Kein Konto vorhanden: Testkonto anlegen (wird am Ende zurückgerollt)
    v_user := gen_random_uuid();
    insert into auth.users (id, email) values (v_user, 'selftest@example.invalid');
    if not exists (select 1 from public.credit_accounts where user_id = v_user) then
      raise exception 'SELFTEST FEHLGESCHLAGEN: Registrierungs-Trigger hat kein Guthabenkonto angelegt';
    end if;
  end if;

  -- Test-Wechselkurs (wird zurückgerollt)
  v_fx := public.insert_fx_rate(1.10, 'selftest', current_date);

  -- Ausgangslage merken (vorhandenes Guthaben und Buchungen bleiben unberührt)
  select balance_eur into v_base from public.credit_accounts where user_id = v_user;
  select count(*) into v_cnt0 from public.ledger_consistency() where user_id = v_user;
  perform public.admin_add_credit(v_user, 5, 'Selftest');

  -- 1) Reservierung
  v_res := public.reserve_credit(v_req, v_user, null, 'claude-sonnet-5-5', 1000, 2000, 0);
  select balance_eur into v_bal from public.credit_accounts where user_id = v_user;
  if v_bal >= v_base + 5 then raise exception 'SELFTEST FEHLGESCHLAGEN: Reservierung hat das Guthaben nicht verringert'; end if;

  -- 2) Doppelte Anfrage-ID darf nicht doppelt reservieren
  v_res := public.reserve_credit(v_req, v_user, null, 'claude-sonnet-5-5', 1000, 2000, 0);
  if coalesce((v_res ->> 'duplicate')::boolean, false) is not true then
    raise exception 'SELFTEST FEHLGESCHLAGEN: doppelte Anfrage wurde nicht erkannt';
  end if;

  select 1 + (public.setting_num('markup_percent') + public.setting_num('fx_markup_percent') + coalesce(public.setting_num('provider_tax_percent'), 0)) / 100 into v_factor;
  -- 3) Abrechnung mit echten (Test-)Zahlen: 1000 Input, 500 Output
  v_res := public.settle_request(v_req, 1000, 500, 0, 0, 0, 'provider', 'complete');
  v_charged := (v_res ->> 'charged_eur')::numeric;
  -- Erwartung: (1000*2 + 500*10)/1e6 USD = 0,007 USD; *(1/1,10); *1,12 (10 % + 2 %)
  if abs(v_charged - 0.007 / 1.10 * v_factor) > 0.00000002 then
    raise exception 'SELFTEST FEHLGESCHLAGEN: falsche Kosten %, erwartet %', v_charged, 0.007 / 1.10 * v_factor;
  end if;
  select balance_eur into v_bal from public.credit_accounts where user_id = v_user;
  if abs(v_bal - (v_base + 5 - v_charged)) > 0.00000001 then
    raise exception 'SELFTEST FEHLGESCHLAGEN: Kontostand % passt nicht zu % + 5 - %', v_bal, v_base, v_charged;
  end if;

  -- 4) Zweites Abrechnen derselben Anfrage darf nichts ändern
  v_res := public.settle_request(v_req, 1000, 500, 0, 0, 0, 'provider', 'complete');
  if (v_res ->> 'already') is null then raise exception 'SELFTEST FEHLGESCHLAGEN: doppelte Abrechnung nicht verhindert'; end if;

  -- 5) Zu teure Anfrage wird abgelehnt (Fable, 1 Mio. Eingabe-Tokens kosten rund 10 USD, mehr als 5 EUR Guthaben)
  begin
    perform public.reserve_credit(v_req2, v_user, null, 'claude-fable-5-1', 1000000, 8000, 3);
    raise exception 'SELFTEST FEHLGESCHLAGEN: zu teure Anfrage wurde nicht abgelehnt';
  exception when others then
    if sqlerrm <> 'insufficient_credit' then raise; end if;
  end;

  -- 6) Freigabe ohne Kosten
  v_res := public.reserve_credit(v_req2, v_user, null, 'claude-haiku-5-5', 500, 500, 0);
  v_res := public.release_reservation(v_req2, 'Selftest');
  select balance_eur into v_bal from public.credit_accounts where user_id = v_user;
  if abs(v_bal - (v_base + 5 - v_charged)) > 0.00000001 then
    raise exception 'SELFTEST FEHLGESCHLAGEN: Freigabe hat Guthaben nicht zurückgebucht (%)', v_bal;
  end if;

  -- 7) Kontostand = Summe der Buchungen
  select count(*) into v_cnt from public.ledger_consistency() where user_id = v_user;
  if v_cnt <> v_cnt0 then raise exception 'SELFTEST FEHLGESCHLAGEN: Der Test hat eine Abweichung zwischen Kontostand und Buchungen erzeugt'; end if;
  if v_cnt0 > 0 then raise exception 'SELFTEST FEHLGESCHLAGEN: Schon VOR dem Test wich der Kontostand von den Buchungen ab (select * from ledger_consistency())'; end if;

  -- 8) Ledger ist unveränderlich
  begin
    update public.ledger_entries set amount_eur = 0 where user_id = v_user;
    raise exception 'SELFTEST FEHLGESCHLAGEN: Ledger war veränderbar';
  exception when others then
    if sqlerrm like 'SELFTEST%' then raise; end if;
  end;

  raise exception 'SELFTEST BESTANDEN (alles zurückgerollt)';
end $$;
