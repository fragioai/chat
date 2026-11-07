# Fragio – Einrichtung Phase 5 (Dateien)

**Ehrlich vorab:** Das ist die größte Lieferung bisher und hier **nicht live getestet**. Der Dateiteil mit Claude (Lesen von ZIP/Office-Dateien, Datei-Erzeugung) braucht den Anthropic-Zugang mit Guthaben und lässt sich erst nach dem Hinterlegen deiner Karte prüfen. Alles, was nur dein Speicher betrifft (Hochladen, Prüfen, Vorschau, Löschen, Limits), kannst du schon vorher testen, solange du die Datei **nicht** an eine Nachricht schickst.

## Was jetzt möglich ist
- **Anhängen** (Knopf „Anhängen“): PDF, Bilder (PNG, JPG, GIF, WEBP), ZIP, HTML, DOCX, XLSX, PPTX, TXT, Markdown, CSV, JSON und gängiger Quellcode. Bis 5 Dateien pro Nachricht, **6 MB pro Datei, 70 MB pro Nutzer**, **900 MB für alle zusammen** (Grenzen im Admin unter „Einstellungen“ änderbar, 6 MB ist die Obergrenze des Speichers).
- **Claude liest sie:** PDFs und Bilder direkt. Kleine Textdateien (bis 60 KB) als Text. ZIP, Office-Dateien und größere Dateien in der **Code-Umgebung von Anthropic**, wo Claude sie auspacken und lesen kann.
- **Claude erzeugt echte Dateien** (Schalter „Dateien erzeugen und Code ausführen“, standardmäßig an): DOCX, XLSX, PPTX, PDF, ZIP, HTML, Code usw. Sie erscheinen als Karte unter der Antwort mit **Vorschau, Herunterladen und Löschen**.
- **Vorschau:** PDF, Bilder, Text/Code/JSON/Markdown, CSV und XLSX als Tabelle, DOCX und PPTX als Text, ZIP als Dateiliste, HTML in einem gesperrten Rahmen **ohne Skripte**.

## Schutz
- Privater Speicher, kein Direktzugriff: Der Browser lädt nur über einen kurzlebigen, einmaligen Link hoch und lädt nur über kurzlebige Links (2 Minuten) herunter. Jeder sieht nur seine eigenen Dateien (Datenbank-Regeln plus Prüfung auf dem Server).
- Der Server prüft nach dem Upload den **tatsächlichen Inhalt** (nicht nur die Endung), Größe, ZIP-Aufbau (keine Passwort-ZIPs, keine ZIP-Bomben, keine unsicheren Pfade) und lehnt Ungültiges ab und löscht es.
- Erzeugte Dateien werden genauso geprüft, dem richtigen Nutzer zugeordnet und nie über vom Modell gelieferte Pfade geladen.
- Inhalte aus Dateien gelten als Daten, nicht als Anweisungen (Hinweis an das Modell). Das ist ein Schutz, aber **kein vollständiger** gegen Prompt-Injection.
- Hochgeladene Dateien werden **nicht** auf Viren geprüft. Sie werden nie auf deinem Server ausgeführt, nur in der Umgebung von Anthropic gelesen.

## Datenschutz (für die spätere Datenschutzerklärung)
Dateien werden zur Verarbeitung an **Anthropic** gesendet. Die Kopie dort wird gelöscht, wenn der Nutzer die Datei löscht, beim Löschen des Kontos, und spätestens nach **7 Tagen** durch den täglichen Aufräumjob. Beim Löschen eines Chats werden seine Dateien zum Löschen markiert und vom Aufräumjob entfernt. Beim Löschen des Kontos werden alle Dateien und Kopien entfernt.

## Kosten
- **Code-Umgebung:** Laut Anthropic-Preisseite kostenlos zusammen mit Websuche, sonst 1.550 Gratis-Stunden pro Monat und Organisation, danach 0,05 $ pro Stunde. Ich berechne dafür vorerst nichts. Die normalen Tokens (auch das Werkzeug selbst, ca. 600 Tokens pro Anfrage) werden wie immer abgerechnet.
- **Dateien mit Text/PDF/Bild** erhöhen die Eingabe-Tokens. Vor der Anfrage zählt der Server beim Anbieter die Tokens, damit die Reservierung stimmt.
- **Fortsetzen und Folgefragen** senden angehängte PDFs/Bilder erneut als Eingabe (bis zu 6 Stück pro Chat).
- **Speicher/Egress bei Supabase (Free):** 1 GB Speicher, 5 GB Egress pro Monat. Vorschau und Downloads zählen als Egress.

## Einrichtung
1. **Fragio-Phase5.zip** hochladen, **Actions → Dateien entpacken → Run workflow**.
2. **SQL:** `supabase/migrations/0009_dateien.sql` ausführen (bei Warnung **Run and enable RLS**). Danach `supabase/tests/phase5_checks.sql`: überall `true`.
3. **Edge Functions:**
   - **files (neu):** Deploy a new function → Via Editor → Name `files` → Inhalt von `supabase/functions/files/index.ts`. **Verify JWT ausschalten** (die Funktion prüft die Anmeldung selbst und wird nachts vom Aufräumjob mit einem Geheimwort aufgerufen).
   - **chat:** Code durch `supabase/functions/chat/index.ts` ersetzen, Deploy.
   - **delete-account:** Code durch `supabase/functions/delete-account/index.ts` ersetzen, Deploy.
4. **Aufräumjob:** In GitHub neue Datei `.github/workflows/aufraeumen.yml` mit dem Inhalt aus **Anhang A**. Das Geheimwort `CRON_SECRET` aus der Preis-Automatik wird mitgenutzt. Danach **Actions → Dateien aufräumen → Run workflow**: grün, und die Antwort zeigt `"ok":true`.
5. Die Website baut sich nach dem Entpacken neu (neues Paket `jszip`, dauert etwas länger).

## Tests ohne Anthropic-Zugang
1. **Anhängen** → eine kleine `.txt`: Chip zeigt „Prüft Inhalt …“, dann Größe. Der Dateispeicher-Zähler steigt.
2. Eine **.png**, die in Wirklichkeit eine umbenannte Textdatei ist: wird abgelehnt („Der Inhalt passt nicht zum Dateityp“).
3. Eine Datei über 6 MB: wird abgelehnt.
4. Mit dem **×** am Chip löschen: Zähler sinkt.
5. Zweites Konto: kann eine Datei des ersten nie öffnen (auch nicht mit bekannter ID).
6. Admin → Einstellungen: Dateigrenzen ändern und zurücksetzen.

## Tests mit Anthropic-Zugang (später)
1. PDF und Bild anhängen und Fragen dazu stellen.
2. Ein ZIP mit einem kleinen Projekt anhängen: „Erkläre die Struktur und finde Fehler.“
3. „Erstelle eine Excel-Tabelle mit …“ und „Erstelle eine Word-Datei …“: Datei-Karten erscheinen, Vorschau und Download funktionieren, Dateien öffnen sich in Numbers/Pages.
4. „Ändere die Datei …“ in einer Folgenachricht: Claude bekommt die erzeugte Datei wieder zur Verfügung.
5. Chat löschen: Dateien verschwinden aus dem Speicherzähler nach dem nächsten Aufräumlauf.

## Ungeprüft, weil ohne echten Zugang gebaut (nach offizieller Doku)
- Datei-Upload zu Anthropic (Kopfzeile `files-api-2025-04-14` gesendet, falls Anthropic sie nicht mehr braucht, wird sie normalerweise ignoriert), Format `container_upload`, Werkzeug `code_execution_20250825`, Auslesen der erzeugten Dateien aus den Werkzeug-Ergebnissen, Token-Zählung mit Dateien.
- Ob **alle vier Modelle** das Code-Werkzeug unterstützen. Falls eines die Anfrage ablehnt, die Option „Dateien erzeugen und Code ausführen“ ausschalten und mir die Fehlermeldung aus „Admin → Betrieb → Fehlgeschlagene API-Anfragen“ schicken.
- Direkter Upload über `uploadToSignedUrl` aus dem Browser (Supabase-Funktion).

## Grenzen
- Keine Virenprüfung. Kein Passwort-ZIP, kein ZIP64.
- PDF-Vorschau auf dem iPhone zeigt oft nur die erste Seite. Download zeigt alles.
- PPTX und DOCX haben nur eine Text-Vorschau, keine Optik.
- Bei der Antwort müssen erzeugte Dateien noch heruntergeladen und gespeichert werden. Dafür wird das Zeitlimit mit Code-Werkzeug auf 120 Sekunden gesenkt.
- Sehr große Projekte (ZIP über 6 MB) sind nicht möglich.

## Anhang A: aufraeumen.yml
```yaml
name: Dateien aufräumen

on:
  schedule:
    - cron: '43 4 * * *'
  workflow_dispatch:

jobs:
  purge:
    runs-on: ubuntu-latest
    steps:
      - name: Aufräumen aufrufen
        env:
          URL: ${{ vars.VITE_SUPABASE_URL }}
          ANON: ${{ vars.VITE_SUPABASE_ANON_KEY }}
          SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          code=$(curl -sS -o resp.json -w '%{http_code}' -X POST "$URL/functions/v1/files" \
            -H "x-cron-secret: $SECRET" -H "apikey: $ANON" -H "Content-Type: application/json" \
            -d '{"action":"purge"}')
          cat resp.json; echo
          if [ "$code" != "200" ]; then echo "FEHLER: HTTP $code"; exit 1; fi
```
