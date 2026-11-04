-- Fragio – Migration 0004: Modelle und Preise (verifiziert am 04.11.2026)
-- Quellen: https://platform.claude.com/docs/en/about-claude/pricing
--          https://ai.google.dev/gemini-api/docs/pricing
--          https://ai.google.dev/gemini-api/docs/thinking
-- Preise in US-Dollar je 1 Mio. Tokens. Sicher wiederholbar (ON CONFLICT DO NOTHING).
-- Änderungen an Preisen: NEUE Zeile mit neuem valid_from anlegen, alte Zeile nicht überschreiben.

insert into public.model_configs
  (id, provider, api_model_id, display_name, speed_class, reasoning_class, description,
   efforts, default_effort, supports_web_search, context_tokens, max_output_cap, status, sort_order)
values
 ('claude-haiku-5-5', 'anthropic', 'claude-haiku-5-5', 'Claude Haiku 5.5', 'sehr schnell', 'solide',
  'Schnell und günstig für einfache Fragen, Zusammenfassungen und Umformulierungen.',
  '[{"value":"low","label":"Schnell"},{"value":"medium","label":"Ausgewogen"},{"value":"high","label":"Gründlich"},{"value":"xhigh","label":"Intensiv"},{"value":"max","label":"Maximal"}]',
  'medium', true, 200000, 16000, 'enabled', 10),
 ('claude-sonnet-5-5', 'anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5', 'schnell', 'stark',
  'Gute Mischung aus Tempo und Qualität für die meisten Aufgaben.',
  '[{"value":"low","label":"Schnell"},{"value":"medium","label":"Ausgewogen"},{"value":"high","label":"Gründlich"},{"value":"xhigh","label":"Intensiv"},{"value":"max","label":"Maximal"}]',
  'high', true, 200000, 12000, 'enabled', 20),
 ('claude-opus-5-5', 'anthropic', 'claude-opus-5-5', 'Claude Opus 5.5', 'mittel', 'sehr stark',
  'Für anspruchsvolle Analyse, Programmierung und lange Aufgaben. Denkt immer mit.',
  '[{"value":"low","label":"Schnell"},{"value":"medium","label":"Ausgewogen"},{"value":"high","label":"Gründlich"},{"value":"xhigh","label":"Intensiv"},{"value":"max","label":"Maximal"}]',
  'medium', true, 200000, 10000, 'enabled', 30),
 ('claude-fable-5-1', 'anthropic', 'claude-fable-5-1', 'Claude Fable 5.1', 'langsamer', 'höchste',
  'Stärkstes Claude-Modell für schwierigste Probleme. Am teuersten, denkt immer mit.',
  '[{"value":"low","label":"Schnell"},{"value":"medium","label":"Ausgewogen"},{"value":"high","label":"Gründlich"},{"value":"xhigh","label":"Intensiv"},{"value":"max","label":"Maximal"}]',
  'high', true, 200000, 8000, 'enabled', 40),
 ('gemini-3-5-flash-lite', 'google', 'gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', 'sehr schnell', 'einfach',
  'Sehr günstig und schnell für einfache Aufgaben und Übersetzungen.',
  '[{"value":"minimal","label":"Minimal"},{"value":"low","label":"Schnell"},{"value":"medium","label":"Ausgewogen"},{"value":"high","label":"Gründlich"}]',
  'minimal', true, 200000, 16000, 'enabled', 110),
 ('gemini-3-8-flash', 'google', 'gemini-3.8-flash', 'Gemini 3.8 Flash', 'schnell', 'stark',
  'Allrounder von Google mit gutem Tempo.',
  '[{"value":"low","label":"Schnell"},{"value":"medium","label":"Ausgewogen"},{"value":"high","label":"Gründlich"}]',
  'medium', true, 200000, 16000, 'enabled', 120),
 ('gemini-3-1-pro-preview', 'google', 'gemini-3.1-pro-preview', 'Gemini 3.1 Pro (Vorschau)', 'mittel', 'sehr stark',
  'Leistungsstarkes Reasoning-Modell von Google. Vorschau-Status, Verfügbarkeit kann sich ändern.',
  '[{"value":"low","label":"Schnell"},{"value":"medium","label":"Ausgewogen"},{"value":"high","label":"Gründlich"}]',
  'high', true, 200000, 12000, 'enabled', 130),
 ('gemini-4-argon', 'google', 'gemini-4-argon', 'Gemini 4 Argon', 'mittel', 'höchste',
  'Googles Flaggschiff für komplexes Denken. Nur im bezahlten Tarif verfügbar.',
  '[{"value":"low","label":"Schnell"},{"value":"medium","label":"Ausgewogen"},{"value":"high","label":"Gründlich"}]',
  'medium', true, 200000, 12000, 'enabled', 140)
on conflict (id) do nothing;

-- Claude (gültig ab 2026-01-01, verifiziert 04.11.2026). Websuche: 10 USD je 1.000 Suchen = 0,01 je Suche.
insert into public.price_versions
  (model_id, input_usd_per_mtok, output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok,
   long_context_threshold, long_input_usd_per_mtok, long_output_usd_per_mtok,
   long_cache_read_usd_per_mtok, long_cache_write_usd_per_mtok,
   search_usd_per_request, source_url, valid_from, valid_until, verified_at, status, note)
values
 ('claude-haiku-5-5', 0.10, 0.50, 0.01, 0.125, 100000, 0.50, 2.50, 0.05, 0.625, 0.01,
  'https://platform.claude.com/docs/en/about-claude/pricing', '2026-01-01', null, '2026-11-04 12:00+00', 'active',
  'Über 100.000 Prompt-Tokens höherer Preis. Cache-Schreiben = 5-Minuten-Preis.'),
 ('claude-sonnet-5-5', 2.00, 10.00, 0.10, 2.50, null, null, null, null, null, 0.01,
  'https://platform.claude.com/docs/en/about-claude/pricing', '2026-01-01', null, '2026-11-04 12:00+00', 'active', null),
 ('claude-opus-5-5', 4.00, 20.00, 0.20, 5.00, null, null, null, null, null, 0.01,
  'https://platform.claude.com/docs/en/about-claude/pricing', '2026-01-01', null, '2026-11-04 12:00+00', 'active', null),
 ('claude-fable-5-1', 10.00, 50.00, 0.25, 12.50, null, null, null, null, null, 0.01,
  'https://platform.claude.com/docs/en/about-claude/pricing', '2026-01-01', null, '2026-11-04 12:00+00', 'active', null)
on conflict (model_id, valid_from) do nothing;

-- Gemini (Standard-Tarif, bezahlt). Websuche (Grounding): 14 USD je 1.000 Anfragen = 0,014 je Suche.
-- Hinweis: Google gewährt 5.000 kostenlose Suchanfragen pro Monat; Fragio berechnet den Listenpreis.
-- Befristete Preise sind als zwei Zeilen hinterlegt. Zeitzone bei Google nicht genannt: Wechsel um 00:00 UTC.
insert into public.price_versions
  (model_id, input_usd_per_mtok, output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok,
   long_context_threshold, long_input_usd_per_mtok, long_output_usd_per_mtok,
   long_cache_read_usd_per_mtok, long_cache_write_usd_per_mtok,
   search_usd_per_request, source_url, valid_from, valid_until, verified_at, status, note)
values
 ('gemini-3-5-flash-lite', 0.30, 2.50, 0.03, null, null, null, null, null, null, 0.014,
  'https://ai.google.dev/gemini-api/docs/pricing', '2026-01-01', null, '2026-11-04 12:00+00', 'active', null),
 ('gemini-3-8-flash', 0.75, 3.75, 0.075, null, null, null, null, null, null, 0.014,
  'https://ai.google.dev/gemini-api/docs/pricing', '2026-01-01', '2027-01-01', '2026-11-04 12:00+00', 'active',
  'Einführungspreis bis 31.12.2026'),
 ('gemini-3-8-flash', 1.50, 7.50, 0.15, null, null, null, null, null, null, 0.014,
  'https://ai.google.dev/gemini-api/docs/pricing', '2027-01-01', null, '2026-11-04 12:00+00', 'active',
  'Regulärer Preis ab 01.01.2027'),
 ('gemini-3-1-pro-preview', 2.00, 12.00, 0.20, null, 200000, 4.00, 18.00, 0.40, null, 0.014,
  'https://ai.google.dev/gemini-api/docs/pricing', '2026-01-01', null, '2026-11-04 12:00+00', 'active',
  'Über 200.000 Prompt-Tokens höherer Preis'),
 ('gemini-4-argon', 2.00, 10.00, 0.10, null, null, null, null, null, null, 0.014,
  'https://ai.google.dev/gemini-api/docs/pricing', '2026-01-01', '2026-12-01', '2026-11-04 12:00+00', 'active',
  'Einführungspreis bis 30.11.2026'),
 ('gemini-4-argon', 4.00, 20.00, 0.20, null, null, null, null, null, null, 0.014,
  'https://ai.google.dev/gemini-api/docs/pricing', '2026-12-01', null, '2026-11-04 12:00+00', 'active',
  'Regulärer Preis ab 01.12.2026')
on conflict (model_id, valid_from) do nothing;
