# Fragio – Phase 7a: E-Mail (Gmail) und Google Sheets, Google-Logo

**Ehrlich vorab:** Nicht live getestet. Besonders ungeprüft: der Gmail-Versand über die Bibliothek `denomailer` (Port 465) und der Zugriff auf Google Sheets mit dem Dienstkonto. Die Admin-Seite hat Testknöpfe, damit du beides sofort prüfen kannst.

## Was neu ist
- **Ausgangsbox (Outbox):** Jede Nutzung und jede Geldbuchung (Einzahlung, Erstattung, Korrektur, Admin-Buchung) wird automatisch als Ereignis gespeichert und von dort in **Google Sheets** geschrieben (Blätter „Nutzung“ und „Buchungen“). Fällt Google aus, bleibt das Ereignis gespeichert und wird mit Wartezeiten wiederholt (1, 5, 30, 120, 360, 720 Minuten, dann täglich, höchstens 8 Versuche). Doppelte Zeilen werden verhindert (die Ereignis-ID steht in Spalte A und wird vor dem Schreiben geprüft).
- **E-Mail:** Versand über Gmail mit App-Passwort. Im Admin kannst du einem Nutzer eine E-Mail schreiben (Begründung Pflicht, höchstens 5 pro Nutzer und Tag, protokolliert) und eine **Testmail** an dich senden. Zahlungsmails an dich kommen mit Phase 7b.
- **Admin → Integrationen:** Zähler (wartend, wird wiederholt, endgültig fehlgeschlagen), Knöpfe „Jetzt verarbeiten“, „Testmail an mich“, „Test-Zeile in Sheet“, „Fehlgeschlagene erneut versuchen“ und die Liste der letzten Ereignisse mit Fehlertext.
- **Wichtig:** Solange E-Mail oder Sheets nicht eingerichtet sind, **bleiben alle Ereignisse gespeichert** und gehen nicht verloren. Sobald du die Secrets einträgst, werden sie nachgeholt.
- **Google-Logo** am Knopf „Mit Google fortfahren“.

## Was in Google Sheets landet
Blatt „Nutzung“: Ereignis-ID, Zeit, Nutzer-ID, E-Mail, Name, Modell, Tokens je Art, Suchen, Anbieterkosten, Aufschlag, Wechselkurs-Aufschlag, Gesamtkosten, abgebucht, reserviert, Quelle (Anbieter oder geschätzt), Ergebnis, Anfrage-ID. Blatt „Buchungen“: Ereignis-ID, Zeit, Nutzer-ID, E-Mail, Art, Betrag, Bezug, Notiz. **Keine** Chat-Inhalte, keine Schlüssel, keine Kartendaten. Texte werden als reiner Text eingetragen (keine Formeln). Zahlungsdaten bekommen mit Phase 7b ein eigenes Blatt.
**Datenschutz:** Das Sheet enthält E-Mail-Adressen und Nutzer-IDs und liegt in deinem Google-Konto. Das gehört in die Datenschutzerklärung. Abrechnungsdaten müssen unter Umständen länger aufbewahrt werden als Chats. Beim Löschen eines Kontos werden bereits geschriebene Sheet-Zeilen **nicht** automatisch gelöscht.

## Einrichtung

### 1. Dateien und Datenbank
1. **Fragio-Phase7a.zip** hochladen, **Actions → Dateien entpacken → Run workflow**.
2. SQL Editor: `supabase/migrations/0011_outbox.sql` ausführen (bei Warnung **Run and enable RLS**), dann `supabase/tests/phase7a_checks.sql`: überall `true`.

### 2. Gmail-App-Passwort
Nimm ein eigenes Gmail-Konto für Fragio (nicht dein persönliches, wenn du es trennen willst).
1. Auf dem iPhone: **myaccount.google.com → Sicherheit**. Die **Bestätigung in zwei Schritten** muss eingeschaltet sein.
2. Danach **myaccount.google.com/apppasswords** öffnen (falls nicht auffindbar: im Suchfeld „App-Passwörter“ suchen). Name `Fragio` eingeben, **Erstellen**. Google zeigt ein 16-stelliges Passwort. Kopieren und **ohne Leerzeichen** verwenden.

### 3. Google Sheets: Dienstkonto und Tabelle
1. **console.cloud.google.com**, dein Projekt `Fragio` wählen. **APIs & Dienste → Bibliothek → „Google Sheets API“ → Aktivieren.**
2. **IAM & Verwaltung → Dienstkonten → Dienstkonto erstellen:** Name `fragio-sheets`, keine Rollen nötig, fertig.
3. Das Dienstkonto öffnen → Reiter **Schlüssel → Schlüssel hinzufügen → Neuen Schlüssel erstellen → JSON.** Die Datei wird heruntergeladen (Dateien-App). Öffne sie und **kopiere den gesamten Text**. Falls Google die Schlüsselerstellung durch eine Organisationsrichtlinie sperrt, sag mir Bescheid, dann suchen wir eine Alternative.
4. Notiere die **E-Mail-Adresse des Dienstkontos** (steht im JSON bei `client_email`, endet auf `.iam.gserviceaccount.com`).
5. In Google Sheets (sheets.google.com) eine neue Tabelle `Fragio Abrechnung` anlegen. **Teilen** → die E-Mail des Dienstkontos als **Bearbeiter** hinzufügen (ohne Benachrichtigung).
6. Aus der Adresszeile die **Tabellen-ID** kopieren: `https://docs.google.com/spreadsheets/d/<DAS-HIER>/edit`. Die Blätter und Kopfzeilen legt Fragio selbst an.

### 4. Secrets in Supabase (Edge Functions → Secrets)
| Name | Wert |
|---|---|
| `GMAIL_USER` | die Gmail-Adresse |
| `GMAIL_APP_PASSWORD` | das 16-stellige App-Passwort ohne Leerzeichen |
| `OPERATOR_EMAIL` | Adresse, an die Fragio dir Mails schickt (kann dieselbe sein) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | der komplette Inhalt der JSON-Datei |
| `GOOGLE_SHEET_ID` | die Tabellen-ID |
`CRON_SECRET` ist schon vorhanden. **Nichts davon** gehört in GitHub oder in die Seite.

### 5. Funktionen
- **outbox-worker (neu):** Deploy a new function → Via Editor → Name `outbox-worker` → Inhalt von `supabase/functions/outbox-worker/index.ts`. **Verify JWT ausschalten.**
- **admin:** Code durch `supabase/functions/admin/index.ts` ersetzen, Deploy.

### 6. Zeitplan
Neue Datei `.github/workflows/outbox.yml` mit dem Inhalt aus **Anhang A**. Sie ruft alle 10 Minuten die Ausgangsbox auf. Wird sie rot (Ereignis endgültig fehlgeschlagen), schickt dir GitHub normalerweise eine E-Mail. GitHub schaltet geplante Abläufe in öffentlichen Repositories nach 60 Tagen ohne Aktivität ab, und geplante Läufe können sich verzögern. Im Admin geht „Jetzt verarbeiten“ jederzeit.

### 7. Prüfen
1. **Admin → Integrationen → Testmail an mich:** Meldung „gesendet 1“, die Mail kommt an. Bei Fehler steht der Grund in der Meldung und in „Letzte Ereignisse“.
2. **Test-Zeile in Sheet:** Im Sheet entsteht das Blatt „Test“ mit Kopfzeile und einer Zeile.
3. Dir selbst über **Admin → Nutzer → deinen Nutzer → E-Mail an den Nutzer senden** eine Mail schicken: kommt an.
4. Nach der ersten echten Anfrage oder einer Admin-Buchung (Guthaben korrigieren) erscheinen Zeilen in „Nutzung“ beziehungsweise „Buchungen“ (spätestens nach 10 Minuten oder mit „Jetzt verarbeiten“).
5. Dienst-Ausfall prüfen: Gmail-Passwort in den Secrets absichtlich falsch machen, Testmail senden: Das Ereignis wird „wiederholt“, nicht verloren. Danach Passwort richtig setzen, „Jetzt verarbeiten“.

## Fehlerbehebung
| Meldung | Ursache |
|---|---|
| Authentication / 535 | Gmail-App-Passwort falsch oder Zwei-Schritt-Bestätigung aus |
| SMTP-Verbindung | Port 465 gesperrt oder Gmail blockiert den Zugriff. Meldung an mich schicken |
| Google Sheets HTTP 403 | Tabelle nicht mit dem Dienstkonto geteilt oder Sheets API nicht aktiviert |
| Google Sheets HTTP 404 | Tabellen-ID falsch |
| Google-Anmeldung fehlgeschlagen | JSON unvollständig eingefügt |
| „outbox-worker nicht bereitgestellt“ | Funktion fehlt oder falscher Name |

## Grenzen
- Zustellung ist „mindestens einmal“: Ein Teilausfall nach dem Schreiben kann kurzzeitig zu einer Wiederholung führen, doppelte Zeilen werden anhand der Ereignis-ID in Spalte A verhindert (geprüft werden bis zu 50.000 Zeilen pro Blatt, danach brauchst du eine neue Tabelle).
- Gmail begrenzt die Anzahl gesendeter Mails pro Tag (Größenordnung einige hundert, bitte bei Google prüfen).
- Die Bibliothek für den Versand (`denomailer`) und der Port 465 sind ungeprüft. Falls es nicht klappt, wechsle ich die Bibliothek.
- Zahlungs-E-Mails, Zahlungs-Blatt, Webhook-Status und automatische Aufladung kommen mit Phase 7b.

## Anhang A: outbox.yml
```yaml
name: Ausgangsbox verarbeiten

on:
  schedule:
    - cron: '*/10 * * * *'
  workflow_dispatch:

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - name: Ausgangsbox aufrufen
        env:
          URL: ${{ vars.VITE_SUPABASE_URL }}
          ANON: ${{ vars.VITE_SUPABASE_ANON_KEY }}
          SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          code=$(curl -sS -o resp.json -w '%{http_code}' -X POST "$URL/functions/v1/outbox-worker" \
            -H "x-cron-secret: $SECRET" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{}')
          cat resp.json; echo
          if [ "$code" != "200" ]; then
            echo "FEHLER: Ausgangsbox meldet HTTP $code (mindestens ein Ereignis ist endgültig fehlgeschlagen oder die Funktion ist nicht erreichbar)."
            exit 1
          fi
```
