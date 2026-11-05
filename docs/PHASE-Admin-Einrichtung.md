# Fragio – Einrichtung Administration

**Ehrlich vorab:** Der Admin-Bereich ist hier nicht live getestet. Er ist so gebaut, dass im Zweifel **nichts passiert** (Aktion wird abgelehnt) statt etwas Falsches. Sag mir jede Abweichung.

## Was enthalten ist
- **Übersicht** (7/30/90/365 Tage): Nutzer, Guthaben der Nutzer, API-Grundkosten, Aufschläge, abgebuchte Summe, nicht belastete Beträge, Nutzung nach Modell (Tokens, Suchen), Zustand (Reservierungen, Fehler, Sicherheitsereignisse, Buchungsabweichungen), Wechselkurs, letzte Preisprüfung.
- **Nutzer:** Suche, Details (Buchungen, Nutzung, Fehler, Ereignisse), **sperren/entsperren**, **Guthaben korrigieren**.
- **Modelle & Preise:** Modelle ein/ausschalten, Preisgültigkeit, Preisversionen, unplausible Preise **freigeben**, Preise manuell eintragen, Preise als geprüft bestätigen, Protokoll der Preisautomatik.
- **Betrieb:** Reservierungen (offene manuell freigeben), fehlgeschlagene API-Anfragen, Sicherheitsereignisse, Missbrauchsindikatoren (Anfragen pro Stunde), Buchungsprüfung.
- **Einstellungen:** Aufschläge, Limits, Fristen.
- **Protokoll:** jede Admin-Aktion mit Begründung.
- **Export:** CSV für Nutzung/Abrechnung, Buchungen, Nutzerliste, Protokoll.
- **Zahlungen:** Platzhalter mit der Liste dessen, was mit Phase 7 kommt (Zahlungen, Rückerstattungen, Webhooks, automatische Aufladung, E-Mail, Google Sheets, Nutzer per E-Mail anschreiben). **Das ist noch nicht vorhanden**, weil die Daten dafür erst mit Phase 7 entstehen.

## Schutz
1. Nur Konten mit Rolle `admin` in der Tabelle `user_roles` (nur per SQL vergebbar).
2. **Zwei-Faktor-Anmeldung** (Authenticator-App) ist Pflicht. Ohne sie lehnt der Server jede Admin-Aktion ab.
3. Jede Änderung braucht **Begründung** (mindestens 5 Zeichen) **und** das Wort BESTÄTIGEN. Der Server prüft beides erneut.
4. Jede Änderung steht im Admin-Protokoll. Ledger-Buchungen bleiben unveränderlich; Korrekturen sind neue Buchungen. Das Guthaben kann durch eine Korrektur nicht unter 0 fallen.
5. Du kannst dein eigenes Konto nicht sperren. Versuche normaler Nutzer, Admin-Funktionen aufzurufen, werden als Sicherheitsereignis protokolliert.
6. CSV-Exporte schützen vor Formel-Einschleusung in Tabellenprogrammen.

## Einrichtung

### 1. Dateien
**Fragio-PhaseAdmin.zip** hochladen, **Actions → Dateien entpacken → Run workflow**. Die Website baut sich danach neu.

### 2. Datenbank
SQL Editor: `supabase/migrations/0006_admin.sql` ausführen (bei Warnung **Run and enable RLS**). Danach `supabase/tests/phase_admin_checks.sql`: alles `true` außer „Mindestens ein Admin eingetragen“ (kommt in Schritt 5).

### 3. Funktionen
- **admin (neu):** Edge Functions → Deploy a new function → Via Editor → Name `admin` → Inhalt von `supabase/functions/admin/index.ts`. „Verify JWT“ eingeschaltet lassen.
- **chat:** Code durch den neuen Inhalt von `supabase/functions/chat/index.ts` ersetzen (protokolliert jetzt Fehler und Sicherheitsereignisse und nutzt die Anfragen-pro-Minute-Einstellung).

### 4. Zwei-Faktor-Anmeldung in Supabase prüfen
Supabase → **Authentication** → **Sign In / Providers** (oder „Multi-Factor“): Die **TOTP**-Authenticator-App muss aktiviert sein. Das ist nach meiner Kenntnis auf dem kostenlosen Tarif möglich, bitte in der Oberfläche prüfen. Die Menüs ändern sich.

### 5. Dich zum Admin machen
In Supabase unter **Authentication → Users** deine Nutzer-ID (UUID) kopieren, dann im SQL Editor:
```
insert into public.user_roles (user_id, role) values ('DEINE-UUID', 'admin') on conflict do nothing;
```
Danach `phase_admin_checks.sql` noch einmal: alles `true`.

### 6. Erster Aufruf
Seite neu laden, abmelden und anmelden. Oben erscheint der Reiter **Admin**.
1. **Authenticator einrichten** tippen. Du bekommst einen Einrichtungsschlüssel. iPhone: App **Passwörter** öffnen → neuer Eintrag mit Einrichtungsschlüssel (die genauen Schritte stehen in der Apple-Hilfe zu Bestätigungscodes) oder eine andere Authenticator-App verwenden.
2. 6-stelligen Code eintragen → **Bestätigen**. Ab dann ist die Übersicht sichtbar.
3. Beim nächsten Anmelden fragt Fragio nur noch nach dem Code.

**Wichtig:** Sichere den Einrichtungsschlüssel, sonst sperrst du dich bei einem Handy-Verlust selbst aus. Notfall: In Supabase unter Authentication → Users den Faktor des Kontos entfernen.

### 7. Testliste
1. Übersicht lädt ohne Fehler, Zeitraum umschalten.
2. Nutzer suchen, Details öffnen.
3. Mit einem **zweiten Testkonto**: Sperren (mit Begründung und BESTÄTIGEN). Das Testkonto bekommt beim Chatten die Meldung „Dein Konto ist gesperrt.“ Danach entsperren.
4. Guthaben korrigieren: +1 € mit Begründung. Es erscheint in „Letzte Buchungen“ und im Protokoll. Dann -1 €.
5. Eine Korrektur, die unter 0 führen würde, wird abgelehnt.
6. **Betrieb → Buchungsprüfung:** leer („Alles in Ordnung“).
7. Export: CSV laden. Prüfen, ob es sich in Dateien/Numbers öffnen lässt.
8. Mit dem zweiten Testkonto die Adresse `#/admin` aufrufen: „Kein Zugriff“, und in **Betrieb → Sicherheitsereignisse** steht `admin_denied`.
9. **Protokoll** zeigt alle Änderungen.

## Bekannte Grenzen
- Zahlungen, Webhooks, automatische Aufladungen, E-Mail-Versand an Nutzer und Google-Sheets-Status fehlen bis Phase 7.
- Kein Admin-Löschen von Nutzern (das Konto löscht der Nutzer selbst). Admin-Rechte vergibst du nur per SQL.
- Listen zeigen die letzten 100 bis 200 Einträge, Exporte bis 50.000 Zeilen.
- „Umsatz“ bedeutet hier Aufschläge brutto. Zahlungsgebühren, Steuern und Anbieterrechnungen sind nicht enthalten und kommen später dazu.
