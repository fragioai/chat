-- Fragio – Funktionstest der Abrechnung (Phase 4a).
-- Läuft komplett in einer Transaktion und wird am Ende IMMER zurückgerollt: es bleiben keine Daten übrig.
-- Erwartung: Der SQL Editor meldet am Ende einen "Fehler" mit dem Text
--   SELFTEST BESTANDEN (alles zurückgerollt)
-- Jede andere Meldung bedeutet: Test fehlgeschlagen. Bitte Text an Claude schicken.
-- Voraussetzung: mindestens ein registriertes Konto, Migrationen 0001 bis 0004.

do $$
declare
  v_user uuid; v_fx bigint; v_req uuid := gen_random_uuid(); v_req2 uuid := gen_random_uuid();
  v_res jsonb; v_bal numeric; v_charged numeric; v_cnt int; v_ok boolean;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'SELFTEST FEHLGESCHLAGEN: kein Konto vorhanden'; end if;

  -- Test-Wechselkurs (wird zurückgerollt)
  v_fx := public.insert_fx_rate(1.10, 'selftest', current_date);

  update public.credit_accounts set balance_eur = 0, reserved_eur = 0 where user_id = v_user;
  delete from public.ledger_entries where false; -- Ledger bleibt unverändert (nur Insert erlaubt)
  perform public.admin_add_credit(v_user, 5, 'Selftest');

  -- 1) Reservierung
  v_res := public.reserve_credit(v_req, v_user, null, 'claude-sonnet-5-5', 1000, 2000, 0);
  select balance_eur into v_bal from public.credit_accounts where user_id = v_user;
  if v_bal >= 5 then raise exception 'SELFTEST FEHLGESCHLAGEN: Reservierung hat das Guthaben nicht verringert'; end if;

  -- 2) Doppelte Anfrage-ID darf nicht doppelt reservieren
  v_res := public.reserve_credit(v_req, v_user, null, 'claude-sonnet-5-5', 1000, 2000, 0);
  if coalesce((v_res ->> 'duplicate')::boolean, false) is not true then
    raise exception 'SELFTEST FEHLGESCHLAGEN: doppelte Anfrage wurde nicht erkannt';
  end if;

  -- 3) Abrechnung mit echten (Test-)Zahlen: 1000 Input, 500 Output
  v_res := public.settle_request(v_req, 1000, 500, 0, 0, 0, 'provider', 'complete');
  v_charged := (v_res ->> 'charged_eur')::numeric;
  -- Erwartung: (1000*2 + 500*10)/1e6 USD = 0,007 USD; *(1/1,10); *1,12 (10 % + 2 %)
  if abs(v_charged - 0.007 / 1.10 * 1.12) > 0.00000002 then
    raise exception 'SELFTEST FEHLGESCHLAGEN: falsche Kosten %, erwartet %', v_charged, 0.007 / 1.10 * 1.12;
  end if;
  select balance_eur into v_bal from public.credit_accounts where user_id = v_user;
  if abs(v_bal - (5 - v_charged)) > 0.00000001 then
    raise exception 'SELFTEST FEHLGESCHLAGEN: Kontostand % passt nicht zu 5 - %', v_bal, v_charged;
  end if;

  -- 4) Zweites Abrechnen derselben Anfrage darf nichts ändern
  v_res := public.settle_request(v_req, 1000, 500, 0, 0, 0, 'provider', 'complete');
  if (v_res ->> 'already') is null then raise exception 'SELFTEST FEHLGESCHLAGEN: doppelte Abrechnung nicht verhindert'; end if;

  -- 5) Zu teure Anfrage wird abgelehnt (Fable, riesige Ausgabe)
  begin
    perform public.reserve_credit(v_req2, v_user, null, 'claude-fable-5-1', 150000, 8000, 3);
    raise exception 'SELFTEST FEHLGESCHLAGEN: zu teure Anfrage wurde nicht abgelehnt';
  exception when others then
    if sqlerrm <> 'insufficient_credit' then raise; end if;
  end;

  -- 6) Freigabe ohne Kosten
  v_res := public.reserve_credit(v_req2, v_user, null, 'claude-haiku-5-5', 500, 500, 0);
  v_res := public.release_reservation(v_req2, 'Selftest');
  select balance_eur into v_bal from public.credit_accounts where user_id = v_user;
  if abs(v_bal - (5 - v_charged)) > 0.00000001 then
    raise exception 'SELFTEST FEHLGESCHLAGEN: Freigabe hat Guthaben nicht zurückgebucht (%)', v_bal;
  end if;

  -- 7) Kontostand = Summe der Buchungen
  select count(*) into v_cnt from public.ledger_consistency() where user_id = v_user;
  if v_cnt <> 0 then raise exception 'SELFTEST FEHLGESCHLAGEN: Kontostand weicht von den Buchungen ab'; end if;

  -- 8) Ledger ist unveränderlich
  begin
    update public.ledger_entries set amount_eur = 0 where user_id = v_user;
    raise exception 'SELFTEST FEHLGESCHLAGEN: Ledger war veränderbar';
  exception when others then
    if sqlerrm like 'SELFTEST%' then raise; end if;
  end;

  raise exception 'SELFTEST BESTANDEN (alles zurückgerollt)';
end $$;
