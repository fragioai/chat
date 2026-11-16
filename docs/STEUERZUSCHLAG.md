# Fragio – Steuerzuschlag des KI-Anbieters

**Nicht live getestet.** Keine Steuerberatung: Ob und wie viel Steuer der Anbieter dir berechnet, siehst du auf deiner Anthropic-Rechnung.

## Was neu ist
- Neue Einstellung **„Steuerzuschlag des KI-Anbieters (%)“** im Admin unter „Einstellungen“. **Standard 19.** Auf 0 stellen, wenn Anthropic dir keine Steuer berechnet oder du sie dir erstatten lässt (zum Beispiel mit Umsatzsteuer-ID und Vorsteuerabzug).
- Der Zuschlag wird **auf die Anbieterkosten** gerechnet und **getrennt ausgewiesen**. Die 10 % Aufschlag und der Wechselkurs-Aufschlag bleiben auf den Anbieterkosten **ohne** Steuer, so wie bisher.
- Beispiel mit den Standardwerten (10 % Aufschlag, 2 % Wechselkurs, 19 % Steuer), Anbieterkosten 1,00 €: Aufschlag 0,10 €, Kurs 0,02 €, Steuer 0,19 €, **Gesamt 1,31 €** (vorher 1,12 €).
- Wirkt überall: Abrechnung und Reservierung (eine Stelle in der Datenbank), **Preise je Modell** im Konto, Aufschlüsselung je Anfrage („Steuerzuschlag“), Nutzungsübersicht, CSV, Admin-Übersicht und -Export, Google Sheets (neue Spalte „Steuerzuschlag EUR“ am Ende).
- Frühere Abrechnungen bleiben unverändert (Steuerzuschlag 0).

## Einrichtung
1. **Fragio-Steuer.zip** hochladen, **Dateien entpacken** ausführen.
2. SQL Editor: `supabase/migrations/0014_steuerzuschlag.sql` ausführen (bei Warnung **Run and enable RLS**).
3. Edge Function **outbox-worker**: Code durch `supabase/functions/outbox-worker/index.ts` ersetzen, Deploy („Verify JWT“ bleibt aus).
4. Google Sheet, Blatt „Nutzung“: In **Zelle U1** `Steuerzuschlag EUR` eintragen (neue Spalte, die Kopfzeile ergänzt Fragio bei bestehenden Blättern nicht).
5. **Satz prüfen:** Admin → Einstellungen → „Steuerzuschlag des KI-Anbieters“. Wert aus deiner Anthropic-Rechnung übernehmen.
6. Selftest (aktualisiert, rechnet jetzt mit deinen Einstellungen): `supabase/tests/phase4a_selftest.sql` ausführen, erwartet `SELFTEST BESTANDEN (alles zurückgerollt)`.

## Prüfen
- Konto → „Preise je Modell“: Preise sind höher als vorher (um den Steuerzuschlag).
- Nach der ersten echten Anfrage: „Anfragen“ antippen: Zeile „Steuerzuschlag“.

## Hinweise
- Sollen die 10 % Aufschlag auch auf die Steuer gerechnet werden? Dann sag es, das ist eine kleine Änderung.
- Die Texte für Nutzer (Support-Dokument) bekommen den Hinweis in der Schlussfassung nach den Wünschen zu Modellwechsel, Quellen und Erinnerungen.
