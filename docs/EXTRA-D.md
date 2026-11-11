# Fragio – Extra D: Chat ohne Speichern, Aufbewahrung, Sicherheitsprüfung, Konto

**Ehrlich vorab:** Nicht live getestet. Die Beschreibung der Funktionen steht genau so im Support-Dokument Fassung 2.

## Was neu ist
- **Chat ohne Speichern:** Im Verlauf der Knopf „Chat ohne Speichern“. Der Verlauf liegt nur im Browser, **nichts** wird in der Datenbank gespeichert (weder Nachrichten noch Dateien). Weg nach Verlassen oder Neuladen (die Seite warnt vorher). Nicht möglich: Dateien, Code-Umgebung, „Prüfen, ob die Antwort fertig ist“, Fortsetzen (stattdessen „Bitte fahre fort“ schreiben). Möglich: Websuche, Gedanken live, Neu generieren, Bearbeiten. Kosten werden normal berechnet und stehen in „Konto → Anfragen“, **ohne Inhalt**. Reißt die Verbindung ab, geht die Antwort verloren, wird aber nach Verbrauch berechnet.
- **Chats automatisch löschen nach …:** Im Konto: nie, 30, 90 oder 365 Tage (gerechnet ab der letzten Aktivität). Standard ist nie. Der tägliche Aufräumlauf löscht auch die Dateien dieser Chats.
- **Profil:** Anzeigename ändern. **Passwort ändern** (nicht bei reinen Google-Konten).
- **Meine Dateien:** Liste aller Dateien mit Größe, Vorschau und **einzelnem Löschen** sowie Speicheranzeige.
- **Sicherheitsprüfung bei der Registrierung** (Captcha, Cloudflare Turnstile): erscheint auf Anmelden, Registrieren und Passwort vergessen, sobald du sie einschaltest. Ohne Einrichtung bleibt alles wie bisher.
- „Die Registrierung ist derzeit geschlossen.“ erscheint, wenn du neue Registrierungen in Supabase ausgeschaltet hast.
- **Logo:** wieder das ursprüngliche Logo vom Anfang (blaue Fläche, weiße Sprechblase).

## Einrichtung
1. **Fragio-ExtraD.zip** hochladen, **Dateien entpacken** ausführen.
2. SQL Editor: `supabase/migrations/0012_extra_d.sql` ausführen, dann `supabase/tests/extraD_checks.sql`: überall `true`.
3. Edge Functions ersetzen (Code aus dem Repository kopieren, **Deploy**): **chat** (`supabase/functions/chat/index.ts`) und **files** (`supabase/functions/files/index.ts`, „Verify JWT“ bleibt **aus**).
4. Der Aufräumjob `aufraeumen.yml` läuft schon täglich. Die Aufbewahrung wirkt ab dem nächsten Lauf. Zum Sofort-Test: **Actions → Dateien aufräumen → Run workflow**, in der Antwort steht `chats_deleted`.

### Sicherheitsprüfung (Captcha) einschalten, optional aber empfohlen
**Reihenfolge einhalten:** Erst die Seite mit dem Schlüssel veröffentlichen, **zuletzt** in Supabase einschalten. Sonst kommen alle Anmeldungen mit „Sicherheitsprüfung fehlgeschlagen“ nicht durch.
1. **dash.cloudflare.com**: kostenloses Konto anlegen, links **Turnstile** → **Widget hinzufügen**. Name `Fragio`, Hostname `fragioai.github.io`, Modus **Verwaltet (Managed)**. Danach zeigt Cloudflare einen **Site Key** (öffentlich) und einen **Secret Key** (geheim).
2. GitHub: **Settings → Secrets and variables → Actions → Variables:** neue Variable `VITE_TURNSTILE_SITE_KEY` mit dem Site Key.
3. `.github/workflows/deploy-pages.yml` öffnen (Stift) und durch **Anhang A** ersetzen (reicht die neue Variable durch). **Actions → Website veröffentlichen → Run workflow.** Prüfe, dass auf der Anmeldeseite die Sicherheitsprüfung erscheint.
4. **Jetzt erst** Supabase: **Authentication → Attack Protection** (oder „Bot and Abuse Protection“) → **CAPTCHA** einschalten, Anbieter **Cloudflare Turnstile**, den **Secret Key** eintragen, speichern. Die Menünamen ändern sich bei Supabase, suche im Zweifel nach „CAPTCHA“.
5. Test: Anmelden mit bestandener Prüfung geht, die Prüfung verschwindet nicht nach einem Versuch (sie wird nach jedem Versuch neu gestellt).
Notausgang: In Supabase CAPTCHA wieder ausschalten, dann gehen Anmeldungen auch ohne.

## Registrierung vorübergehend schließen (optional)
Supabase → Authentication → Sign In / Providers → „Allow new users to sign up“ ausschalten. Bestehende Nutzer können sich weiter anmelden. Gilt auch für Google.

## Tests
1. **Chat ohne Speichern** (braucht Anthropic-Zugang für echte Antworten): Chat führen, Seite neu laden: weg. In „Konto → Anfragen“ steht der Verbrauch ohne Inhalt. In der Datenbank (SQL Editor: `select count(*) from public.messages where created_at > now() - interval '1 hour';`) entstehen für diesen Chat keine Zeilen.
2. **Aufbewahrung** auf 30 Tage stellen und prüfen, dass die Einstellung nach Neuladen bleibt. Zum Test den Aufräumlauf starten: Ein künstlich alter Chat (SQL: `update public.chats set updated_at = now() - interval '40 days' where id = '…'`) verschwindet.
3. **Anzeigename** und **Passwort ändern**: nach Passwortwechsel mit dem neuen Passwort anmelden.
4. **Meine Dateien:** Datei löschen, Speicheranzeige sinkt.
5. Captcha wie oben.

## Grenzen
- „Chat ohne Speichern“ verhindert nicht, dass der Anbieter (Anthropic) die Anfrage verarbeitet. Es verhindert nur die Speicherung bei Fragio.
- Die Sicherheitsprüfung lädt ein Skript von Cloudflare. Das gehört in die Datenschutzerklärung.
- Chat-Löschung nach Aufbewahrung ist endgültig und nicht wiederherstellbar.

## Anhang A: deploy-pages.yml
```yaml
name: Website veröffentlichen

on:
  push:
    branches: [main]
  workflow_dispatch:
  workflow_run:
    workflows: ["Dateien entpacken"]
    types: [completed]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Pakete installieren
        run: npm install --no-audit --no-fund
      - name: Website bauen
        env:
          VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ vars.VITE_SUPABASE_ANON_KEY }}
          VITE_GOOGLE_LOGIN: ${{ vars.VITE_GOOGLE_LOGIN }}
          VITE_TURNSTILE_SITE_KEY: ${{ vars.VITE_TURNSTILE_SITE_KEY }}
        run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```
