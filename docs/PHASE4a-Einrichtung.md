# Fragio – Einrichtung Phase 4a (Abrechnung und Chat-Server)

Phase 4a ist der **Server-Teil**: Datenbank für Chats, Modelle, Preise, Reservierung und Abrechnung sowie die Funktionen `chat` und `models`. Die Chat-Oberfläche (Phase 4b) folgt danach. Bis dahin kannst du die Funktionen prüfen, aber noch nicht in der App chatten.

**Wichtig:** Der Code ist hier nicht live getestet. Darum gibt es zwei SQL-Selbsttests. Sag mir bei jeder Abweichung den genauen Text der Meldung.

## 1. Dateien aktualisieren

1. Lade **Fragio-Phase4a.zip** herunter und lade sie im Repository in den **Hauptordner** hoch (**Add file → Upload files**).
2. **Actions → Dateien entpacken → Run workflow.** Danach liegen neue Dateien in `supabase/` und `docs/`.
   Falls das nicht klappt: Die Dateien einzeln wie in Phase 3 hochladen. Wichtig sind `supabase/migrations/0003_chat_abrechnung.sql`, `0004_modelle_preise_seed.sql` und `supabase/functions/chat/index.ts`, `supabase/functions/models/index.ts`.

## 2. Datenbank aktualisieren (SQL Editor)

Immer: SQL Editor → **New query** → Inhalt der Datei aus GitHub (Raw) einfügen → **Run**. Bei der Warnung „destructive operations“ oder „tables without RLS“: **Run and enable RLS** wählen.

Reihenfolge:
1. `supabase/migrations/0003_chat_abrechnung.sql`
2. `supabase/migrations/0004_modelle_preise_seed.sql`
3. `supabase/tests/phase4a_checks.sql`: Erwartung: in der Spalte `ok` überall `true`.
4. `supabase/tests/phase4a_selftest.sql`: Erwartung: Der Editor zeigt einen **Fehler** mit dem Text `SELFTEST BESTANDEN (alles zurückgerollt)`. Das ist hier das gewünschte Ergebnis. Der Test rechnet 5 € Testguthaben durch (Reservieren, Abrechnen, Freigeben, doppelte Anfrage, zu teure Anfrage, Ledger-Schutz) und rollt danach alles zurück. Jede andere Meldung bedeutet einen Fehler.

### Aufschläge prüfen
Die Tabelle `app_settings` enthält die Aufschläge. **Der Wechselkurs-Aufschlag steht vorläufig auf 2 %, das ist mein Vorschlag und noch nicht mit dir abgesprochen.** Ändern geht so:
```
update public.app_settings set value = '2' where key = 'fx_markup_percent';
```
Der vereinbarte Aufschlag von 10 % steht in `markup_percent`.

## 3. Edge Functions bereitstellen (Dashboard)

Für jede Funktion: Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor** (bei `delete-account`: die vorhandene Funktion öffnen und den Code ersetzen).

| Funktionsname | Datei im Repository |
|---|---|
| `models` | `supabase/functions/models/index.ts` |
| `chat` | `supabase/functions/chat/index.ts` |
| `delete-account` | `supabase/functions/delete-account/index.ts` (jetzt mit deiner Adresse fragioai als Standard) |

Den Namen genau so schreiben. „Verify JWT“ eingeschaltet lassen. Wenn der Editor mehrere Dateien anbietet, den Code in die Hauptdatei (`index.ts`) einfügen.

## 4. Secrets eintragen (Edge Functions → Secrets)

| Name | Wert |
|---|---|
| `ANTHROPIC_API_KEY` | dein Schlüssel aus der Anthropic Console |
| `GEMINI_API_KEY` | dein Schlüssel aus Google AI Studio |
| `ALLOWED_ORIGIN` | `https://fragioai.github.io` (ohne `/chat/`) |

Diese Werte gehören **nur** hierhin, niemals in GitHub oder in die Seite. Hast du einen Schlüssel versehentlich irgendwo anders eingefügt, lösche und erneuere ihn sofort.

**Zahlungskarte später:** Solange bei den Anbietern keine Zahlungsmethode hinterlegt ist, lehnen sie Anfragen ab oder bieten nur einen Gratis-Rahmen. Das verursacht für dich keine Kosten. Wichtig dabei:
- **Google:** Der kostenlose Tarif von Google erlaubt, dass Inhalte zur Verbesserung der Google-Produkte verwendet werden. Nutze Fragio mit fremden Personen erst, wenn der Schlüssel auf einem **bezahlten Tarif** läuft (dort werden Inhalte laut Googles Preisseite nicht dafür verwendet). Gemini 4 Argon gibt es nur im bezahlten Tarif.
- **Anthropic:** Setze in der Console beim Aufladen zusätzlich ein **monatliches Ausgabenlimit** als Notbremse.

## 5. Funktionstest ohne Kosten

1. **Modellliste:** Es gibt noch keine App-Oberfläche dafür. Du kannst die Funktion trotzdem im Supabase-Dashboard unter **Edge Functions → models → Logs** beobachten. Die Prüfung über die Oberfläche folgt in Phase 4b.
2. **Testguthaben (nur für dich):** Supabase → **Authentication → Users** → deine Nutzer-ID (UUID) kopieren. Im SQL Editor:
```
select public.admin_add_credit('DEINE-UUID', 2, 'Testguthaben Entwicklung');
```
Das bucht 2 € ins Ledger, mit Begründung und Protokoll.
3. **Konsistenz:** `select * from public.ledger_consistency();` muss **leer** sein (keine Zeilen).

## 6. Was beim ersten echten Test geprüft wird (Phase 4b)

Diese Punkte konnte ich ohne echten Schlüssel nicht ausprobieren. Ich habe sie nach der offiziellen Doku gebaut, aber sie sind **ungeprüft**:
- Claude: Name des Websuche-Werkzeugs (`web_search_20260209`) und die Felder der Nutzungsdaten im Stream.
- Gemini: genaue Schreibweise der Denkstufen (`thinkingLevel`) und Aufbau der Suchquellen.
- Zeitlimit des Free-Tarifs (ca. 150 s): Sehr lange Antworten werden bei 140 s abgebrochen und mit der Schätzung abgerechnet.

Wenn einer der Punkte falsch ist, zeigt die App eine allgemeine Fehlermeldung und **berechnet nichts**, solange keine Antwort kam. Im Dashboard unter **Edge Functions → chat → Logs** steht die genaue Anbieter-Meldung. Schick sie mir, dann passe ich es an.

## 7. So funktioniert die Abrechnung (Kurzfassung)

1. Vor jeder Anfrage berechnet die **Datenbank** eine Obergrenze (geschätzte Eingabe mit 3 % Puffer plus maximale Antwortlänge, plus eventuell Suchen) und reserviert diesen Betrag **atomar**. Reicht das Guthaben nicht, wird die Antwortlänge verkleinert oder die Anfrage abgelehnt. Eine Überziehung ist nicht möglich.
2. Nach der Antwort werden die **tatsächlichen Tokenzahlen des Anbieters** abgerechnet: Anbieterkosten in USD, umgerechnet mit dem EZB-Referenzkurs, plus 10 % Aufschlag und den Wechselkurs-Aufschlag. Der Puffer von 3 % wird **nicht** zusätzlich berechnet.
3. Der Rest der Reservierung wird zurückgebucht. Alles steht als unveränderliche Buchung im Ledger.
4. Bei Abbruch oder fehlenden Nutzungsdaten wird geschätzt und als „geschätzt“ markiert. Gerechnet wird dann eher hoch.
5. Kosten über der Reservierung trägst du als Betreiber (selten; dokumentiert in `usage_events.shortfall_eur`).
6. Gemini-Suchen berechne ich zum Listenpreis (14 USD je 1.000). Google gewährt 5.000 Suchen pro Monat frei. Diesen Vorteil gebe ich nicht weiter. Sag mir, wenn du es anders willst.

## 8. Preise ändern oder aktualisieren

Preise stehen in `price_versions`. **Niemals** eine alte Zeile überschreiben: eine neue Zeile mit neuem `valid_from` einfügen. Zwei Preisänderungen sind schon eingeplant: Gemini 4 Argon ab 01.12.2026 und Gemini 3.8 Flash ab 01.01.2027. Wenn für ein Modell kein gültiger Preis vorliegt oder `verified_at` älter als 90 Tage ist, startet die Anfrage nicht.

Preise erneut bestätigen (nach Prüfung der Anbieterseiten):
```
update public.price_versions set verified_at = now() where status = 'active' and model_id = 'claude-sonnet-5-5';
```

## 9. Fehlerbehebung

| Meldung | Ursache |
|---|---|
| Selftest: „kein Konto vorhanden“ | Zuerst in der App ein Konto registrieren. |
| Selftest: „falsche Kosten …“ | Preise oder Aufschläge wurden verändert. Meldung an mich schicken. |
| Checks zeigen `false` | Migration 0003 nicht vollständig gelaufen. Erneut ausführen. |
| Funktion nicht erreichbar | Name der Funktion falsch geschrieben oder nicht bereitgestellt. |
| Anfrage: „noch nicht eingerichtet“ | Der Schlüssel (Secret) für den Anbieter fehlt. |
| Anfrage: „kein gültiger Preis“ | Preis abgelaufen oder zu alt (Abschnitt 8). |
