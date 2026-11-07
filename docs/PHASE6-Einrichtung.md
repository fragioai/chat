# Fragio – Phase 6 (Nutzungsübersicht) und Google-Anmeldung

**Ehrlich vorab:** Nicht live getestet. Die Übersicht lässt sich schon prüfen, sobald es Nutzung gibt. Ohne Anthropic-Zugang kannst du dir mit dem SQL-Selbsttest (Phase 4a) Testdaten ansehen, die aber am Ende zurückgerollt werden. Echte Zahlen entstehen erst mit echten Anfragen.

## Was neu ist (Konto)
- **Guthaben** mit Einzahlungen gesamt, Verbrauch gesamt, Erstattungen, Korrekturen und aktuell reserviertem Betrag.
- **Verbrauch im Zeitraum** (7 Tage bis Alles): Anfragen, Anbieterkosten, Aufschläge (getrennt nach Aufschlag und Wechselkurs), berechneter Betrag und **davon geschätzt**.
- **Nach Modell:** Anfragen, Eingabe-, Ausgabe-Tokens, Suchen, Betrag.
- **Preise je Modell** je 1 Million Tokens in Euro inklusive Aufschläge.
- **Anfragen:** Antippen zeigt je Anfrage die Aufschlüsselung nach Kostenart (Eingabe, Ausgabe, Cache, Suche) mit Menge, Preis und Betrag, danach Anbieterkosten, Aufschlag, Wechselkurs-Aufschlag, berechnet, vorab reserviert und ob **endgültig oder geschätzt**.
- **Buchungen** mit Filter nach Art und „Mehr laden“. **CSV-Export** für Nutzung und Buchungen.
- **Chat:** Vor dem Senden erscheint eine Warnung, wenn die Anfrage **teuer werden kann** (Obergrenze ab 0,25 € oder über deinem Guthaben).

## Was „geschätzt“ bedeutet
Endgültige Beträge nutzen die Zahlen des Anbieters. Geschätzt wird nur bei Abbruch, Zeitlimit oder fehlenden Nutzungsdaten. Die Schätzung ist bewusst eher hoch und überall als „geschätzt“ markiert.

## Einrichtung
1. **Fragio-Phase6.zip** hochladen, **Actions → Dateien entpacken → Run workflow**.
2. SQL Editor: `supabase/migrations/0010_nutzung.sql` ausführen, dann `supabase/tests/phase6_checks.sql`: überall `true`.
3. Keine neue Edge Function nötig.
4. Test: Konto öffnen. Ohne Nutzung steht „Noch keine Nutzung“. Nach dem ersten echten Chat erscheinen die Zeilen.

## Google-Anmeldung einrichten
Die Seite hat den Knopf „Mit Google fortfahren“, er ist nur ausgeblendet. So schaltest du ihn ein:

1. **Google Cloud:** console.cloud.google.com, mit deinem Google-Konto anmelden, oben ein neues Projekt `Fragio` anlegen.
2. **Zustimmungsbildschirm:** Menü **APIs & Dienste → OAuth-Zustimmungsbildschirm** (oder „Google Auth Platform“): Typ **Extern**, App-Name `Fragio`, deine E-Mail als Support- und Entwickler-E-Mail, speichern. Es werden nur `email`, `profile` und `openid` verwendet. Stelle den Status auf **In Produktion** (für diese Standard-Bereiche braucht Google normalerweise keine Prüfung). Bleibt er auf „Test“, können sich nur dort eingetragene Testnutzer anmelden.
3. **Zugangsdaten:** **Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**, Typ **Webanwendung**, Name `Fragio`.
   - Bei **Autorisierte Weiterleitungs-URIs** genau eintragen: `https://hdqghxuizhhxtjehpqgb.supabase.co/auth/v1/callback`
   - Speichern. Google zeigt **Client-ID** und **Clientschlüssel**. Beides kopieren. Der Clientschlüssel ist geheim.
4. **Supabase:** **Authentication → Sign In / Providers → Google** einschalten, Client-ID und Clientschlüssel einfügen, **Save**. (Die Weiterleitungs-URL, die Supabase dort zeigt, muss mit der aus Schritt 3 übereinstimmen.) Unter **URL Configuration** stehen schon deine Site URL und `https://fragioai.github.io/chat/**` aus Phase 3.
5. **GitHub, Variable:** **Settings → Secrets and variables → Actions → Variables → New repository variable:** Name `VITE_GOOGLE_LOGIN`, Wert `true`.
6. **GitHub, Veröffentlichungsablauf anpassen:** Datei `.github/workflows/deploy-pages.yml` öffnen, Stift-Symbol, und durch den Inhalt aus **Anhang A** ersetzen (er reicht die neue Variable an die Seite weiter). **Commit changes**.
7. Mit der ZIP kommt auch die aktuelle `AuthPage.jsx`, die den Knopf nur bei `VITE_GOOGLE_LOGIN = true` zeigt.
8. **Actions → Website veröffentlichen → Run workflow.** Danach zeigt die Anmeldeseite „Mit Google fortfahren“.

**Test:** Knopf tippen → Google-Anmeldung → zurück in Fragio, angemeldet. Das Konto bekommt automatisch Profil und Guthabenkonto. Gibt es dieselbe E-Mail schon mit Passwort, verknüpft Supabase die Anmeldungen normalerweise automatisch (bitte prüfen, ob dein Konto danach nicht doppelt auftaucht; Admin → Nutzer).

**Fehlerbehebung:** „redirect_uri_mismatch“ heißt: Die Weiterleitungs-URI bei Google stimmt nicht Zeichen für Zeichen. „Access blocked“ heißt: App noch im Testmodus und dein Konto nicht als Testnutzer eingetragen.

**Datenschutz:** Bei Google-Anmeldung übermittelt Google Name und E-Mail an Fragio. Das gehört später in die Datenschutzerklärung.

## Grenzen
- Concurrency-Test (zwei Anfragen gleichzeitig) lässt sich nicht in einem einzelnen SQL-Fenster nachstellen. Der Schutz beruht auf einer Zeilensperre in der Datenbank und wird in Phase 9 mit einem Lasttest geprüft.
- „Preis je Kategorie“ für Cache und Suche steht je Anfrage (Aufschlüsselung), die Preistabelle oben zeigt Eingabe, Ausgabe und Suche.

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
