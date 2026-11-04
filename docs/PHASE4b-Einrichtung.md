# Fragio – Einrichtung Phase 4b (Chat-Oberfläche) und automatische Preisprüfung

**Voraussetzung:** Phase 3 und 4a laufen, der Selbsttest aus 4a ist „bestanden“.

**Ehrlich vorab:** Auch dieser Code ist hier nicht live getestet, weder die Oberfläche noch die Funktionen. Ein echter Chat braucht außerdem einen Anthropic-Schlüssel **mit Guthaben** (Karte bei Anthropic). Ohne das lehnt Anthropic jede Anfrage ab, es entstehen dann keine Kosten, aber auch keine Antworten.

## Neu in dieser Version
- Chat-Oberfläche: Verlauf mit Suche, Umbenennen, Löschen, Mehr laden; Streaming; Stopp; Neu generieren; Nachricht bearbeiten; Kopieren; Markdown mit Tabellen, Links, Code mit Farben und Kopieren-Knopf; Sprung-nach-unten-Knopf; automatisches Scrollen nur, wenn du am Ende bist.
- Modellauswahl (nur die vier Claude-Modelle), Denkstärke pro Modell, Websuche-Schalter mit Preis, Preisanzeige je Modell.
- Konto: verfügbares Guthaben und Tabelle „Nutzung“ mit Eingabe, Ausgabe, Anbieterkosten, Aufschlägen und Gesamtbetrag.
- Automatische Preisprüfung jeden Tag.

## 1. Dateien hochladen
1. **Fragio-Phase4b.zip** in den Hauptordner des Repositories hochladen, dann **Actions → Dateien entpacken → Run workflow**. Danach startet die Veröffentlichung selbst. Dauert diesmal etwas länger, weil neue Pakete installiert werden.
2. Wenn **Website veröffentlichen** rot wird: roten Schritt antippen und die Meldung an mich schicken.

## 2. Datenbank
SQL Editor → New query → Inhalt von `supabase/migrations/0005_preis_automatik.sql` einfügen → Run (bei Warnungen **Run and enable RLS**). Erwartet: „Success“.

## 3. Funktionen bereitstellen (Supabase → Edge Functions)
1. **chat:** Funktion öffnen und den Code durch den neuen Inhalt von `supabase/functions/chat/index.ts` ersetzen, **Deploy**.
2. **update-prices (neu):** Deploy a new function → Via Editor → Name `update-prices` → Inhalt von `supabase/functions/update-prices/index.ts` → Deploy. Danach in den Einstellungen dieser Funktion **Verify JWT ausschalten** (die Funktion schützt sich selbst mit einem Geheimwort).
3. **Secret `CRON_SECRET`:** Edge Functions → Secrets → neuer Eintrag. Wert: ein langes zufälliges Passwort (iPhone: Passwort-Vorschlag verwenden). **Gleichen Wert merken**, du brauchst ihn gleich noch einmal.

## 4. GitHub: Geheimwort und Zeitplan
1. Repository → **Settings → Secrets and variables → Actions → Secrets → New repository secret:** Name `CRON_SECRET`, Wert wie oben. (Diesmal **Secrets**, nicht Variables.)
2. **Add file → Create new file**, Name `.github/workflows/update-prices.yml`, Inhalt aus **Anhang A**, Commit.
3. **Actions → Preise prüfen → Run workflow.**
   - **Grün:** Die Antwort zeigt `"ok":true` und die vier Modelle bei `confirmed`. Fertig.
   - **Rot:** Der Text im roten Schritt nennt den Grund. Solange bei Anthropic noch keine Karte hinterlegt ist, schlägt der Schritt „Leser-Modell“ fehl. Das ist erwartet. Schick mir sonst die Meldung.

Ab jetzt läuft die Prüfung täglich. Bei Problemen wird der Ablauf rot, und GitHub schickt dir normalerweise eine E-Mail.

### So arbeitet die Automatik
- Sie liest die offizielle Preisseite von Anthropic. Ein Claude-Haiku-Aufruf (Kosten: wenige Cent im Monat, trägst du als Betreiber) wandelt den Seitentext in Zahlen um. **Jede Zahl muss wörtlich auf der Seite stehen**, sonst wird nichts geändert.
- Gleiche Preise: werden als „bestätigt“ vermerkt.
- Geänderte, plausible Preise: gelten ab sofort für **neue** Anfragen. Alte Abrechnungen bleiben unverändert (jede Anfrage merkt sich ihre Preisversion).
- Unplausible Sprünge (unter 25 % oder über 400 %) oder neue Preisstufen: werden **nicht** aktiv und der Ablauf wird rot.
- Fehlt die Bestätigung länger als 14 Tage, startet keine kostenpflichtige Anfrage mehr, damit nie mit alten Preisen gerechnet wird.

**Zwei Grenzen, die du kennen musst:**
1. GitHub schaltet geplante Abläufe in öffentlichen Repositories nach **60 Tagen ohne Aktivität** ab. Dann bleibt die Prüfung stehen, nach weiteren 14 Tagen stoppt der Chat mit der Meldung „kein gültiger Preis“. Dann unter **Actions** den Ablauf wieder einschalten. Jede Änderung im Repository setzt die Frist zurück.
2. Ändert Anthropic das Layout der Preisseite so, dass die Zahlen nicht mehr lesbar sind, bleibt der alte Preis bis zu 14 Tage gültig und du wirst per roter Meldung gewarnt.

Das Protokoll siehst du im SQL Editor: `select * from public.price_update_log order by run_at desc limit 10;`

## 5. Testliste für den Chat
Voraussetzungen: Testguthaben (`select public.admin_add_credit('DEINE-UUID', 2, 'Testguthaben');`) und Anthropic-Schlüssel mit Guthaben.
1. Seite öffnen → Reiter **Chat**: Modellliste erscheint, Modelle sind wählbar (sonst „nicht eingerichtet“ oder „kein gültiger Preis“).
2. **Claude Haiku 5.5**, Denkstärke „Schnell“: „Sag Hallo in einem Satz.“ Antwort streamt, darunter stehen „Kosten: …“. Oben sinkt das Guthaben.
3. **Konto → Nutzung**: Eintrag mit Tokens und Beträgen.
4. Lange Antwort anfordern und **Stopp** drücken: Antwort bleibt stehen, Hinweis „geschätzt abgerechnet“.
5. **Neu generieren**, **Bearbeiten**, **Kopieren**.
6. Code anfordern („Schreibe ein Python-Beispiel“): Farben und Kopieren-Knopf am Codeblock. Tabelle anfordern: scrollt seitlich auf dem iPhone.
7. **Websuche** an und nach aktuellen Nachrichten fragen: Quellenlinks unter der Antwort.
8. Verlauf: Suche, Umbenennen, Löschen. Seite neu laden: Chat bleibt erhalten.
9. Guthaben auf 0 lassen (oder fast): Anfrage wird mit klarer Meldung abgelehnt, es entsteht keine Abbuchung.

## 6. Bekannte Grenzen von 4b
- Quellenlinks und Kosten-Hinweise stehen nur direkt nach der Antwort. Nach dem Neuladen ist nur der Text da (in „Konto → Nutzung“ bleiben die Kosten).
- Noch keine Datei-Uploads und Downloads (Phase 5). Die Denk-Texte der Modelle werden nicht angezeigt, nur „Denkt nach …“.
- Antworten sind pro Modell längenbegrenzt (Haiku 16.000, Sonnet 12.000, Opus 10.000, Fable 8.000 Tokens) wegen des Zeitlimits von ca. 150 Sekunden im kostenlosen Supabase-Tarif. Eingabe bis 200.000 Tokens.
- Bei Abbruch oder Zeitlimit wird geschätzt abgerechnet, eher hoch.

## Anhang A: update-prices.yml
```yaml
name: Preise prüfen

on:
  schedule:
    - cron: '17 5 * * *'
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Preisprüfung aufrufen
        env:
          URL: ${{ vars.VITE_SUPABASE_URL }}
          ANON: ${{ vars.VITE_SUPABASE_ANON_KEY }}
          SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          code=$(curl -sS -o resp.json -w '%{http_code}' -X POST "$URL/functions/v1/update-prices" \
            -H "x-cron-secret: $SECRET" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{}')
          cat resp.json; echo
          if [ "$code" != "200" ]; then
            echo "FEHLER: Preisprüfung meldet HTTP $code. Details siehe oben."
            exit 1
          fi
```
