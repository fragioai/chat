# Fragio – Antworten laufen weiter, Prüfen-Knopf, Fortsetzen

## Deine Idee und was davon möglich ist
Du wolltest, dass die Antwort weiter erzeugt wird und man nur auf Knopfdruck nachsieht, ob sie fertig ist. **Das ist jetzt gebaut, mit einer Grenze:**

- Die Funktion auf dem kostenlosen Supabase-Tarif darf **maximal etwa 150 Sekunden** laufen. Das ist ein hartes Limit der Plattform. Länger als das kann keine Antwort weiter erzeugt werden, weder im Vordergrund noch im Hintergrund, denn die Verbindung zum KI-Anbieter hängt an dieser Funktion. Anthropic bietet für diese Art von Anfragen keine Funktion an, bei der die Antwort auf Anbieter-Seite weiterläuft und später abgeholt wird (nach meiner Kenntnis, ungeprüft für die neuen Modelle).
- Was geht: **bis zu diesem Limit läuft die Antwort auf dem Server weiter, auch wenn dein iPhone die Verbindung verliert** (App-Wechsel, Sperrbildschirm, Netzabbruch). Du tippst dann auf **„Prüfen, ob die Antwort fertig ist“**. Es gibt keine automatische Dauerabfrage.
- Wird eine Antwort durch das Zeit- oder Längenlimit gekürzt, steht dort **„Fortsetzen“**. Das Modell schreibt dann an der Stelle weiter. So kommst du Schritt für Schritt auf beliebig lange Antworten.

## Neues Verhalten im Detail
1. **Verbindung weg:** Die Seite zeigt den bisher empfangenen Teil und den Knopf **Prüfen, ob die Antwort fertig ist**. Ein Tipp fragt einmal den Server:
   - fertig: Die komplette Antwort wird angezeigt und abgerechnet.
   - noch in Arbeit: Hinweis, in einer Minute noch einmal zu prüfen.
   - ohne Antwort beendet: nichts wird berechnet. Deine Nachricht ist gespeichert, mit „Antwort anfordern“ oder „Neu generieren“ startest du die Antwort neu.
   - nicht angekommen: dein Text steht wieder im Eingabefeld.
2. **Stopp:** Der Stopp-Knopf schickt eine Stopp-Markierung an den Server. Der Server beendet die Antwort, sobald er die Markierung bemerkt (alle paar Sekunden, nicht während das Modell lange schweigt) und rechnet bis dahin ab.
3. **Gekürzt:** Bei Zeitlimit (140 Sekunden) oder Längenlimit speichert der Server die erzeugte Antwort mit dem Status „gekürzt“. Die Antwort zeigt **Fortsetzen**. Eine Fortsetzung ist eine **neue Anfrage**: Das bisherige Gespräch samt Teilantwort wird erneut als Eingabe gesendet und abgerechnet. Die Kosten stehen einzeln unter „Konto → Nutzung“.

## Abrechnung: Was passiert, wenn nichts mehr zurückkommt
Du wolltest: Wenn nichts mehr zurückkommt, wird die komplette Reservierung abgebucht. **Das habe ich bewusst nicht so gebaut**, und ich bitte dich, es so zu lassen:
- Die Reservierung ist eine **Obergrenze** (maximale Antwortlänge). Sie wäre oft ein Vielfaches der tatsächlich erzeugten Antwort. Nutzer würden für Tokens zahlen, die nie entstanden sind. Das widerspricht deiner Vorgabe „der Nutzer bezahlt die tatsächlichen Kosten plus den vereinbarten Aufschlag“.
- Stattdessen: **tatsächliche Nutzung des Anbieters**, bei Abbruch ohne Nutzungsdaten eine **dokumentierte, eher hohe Schätzung** aus der gespeicherten Textlänge (als „geschätzt“ markiert).
- Stirbt die Funktion ohne Abrechnung (sehr selten, weil sie sich vorher selbst bei 140 Sekunden beendet), wird die Reservierung nach 15 Minuten **ohne Kosten freigegeben** und im Admin unter „Betrieb → Reservierungen“ als „verfallen“ angezeigt. Das Risiko trägst in diesem Ausnahmefall du als Betreiber.
Wenn du eine andere Regel möchtest (zum Beispiel pauschal einen Teil der Reservierung berechnen), sag es mir. Ändern kann ich das, aber ich möchte es nicht stillschweigend ändern.

## Wenn dir 150 Sekunden dauerhaft zu kurz sind
Ein bezahlter Supabase-Tarif erlaubt laut Supabase-Doku eine längere Laufzeit der Funktionen (bitte aktuell bei Supabase prüfen). Das wäre ein Kostenpunkt für dich. Mit „Fortsetzen“ brauchst du das für normale Nutzung nicht.

## Einrichtung
1. **Fragio-PhaseWeiterlaufen.zip** hochladen, **Actions → Dateien entpacken → Run workflow**.
2. SQL Editor: `supabase/migrations/0007_weiterlaufen.sql` ausführen (bei Warnung **Run and enable RLS**). Erwartet: „Success“.
3. Edge Function **chat**: Code durch den neuen Inhalt von `supabase/functions/chat/index.ts` ersetzen, **Deploy**.
4. Website neu bauen lassen (passiert nach dem Entpacken automatisch).

## Testliste (braucht Anthropic-Schlüssel mit Guthaben und Testguthaben)
1. **Kurzer Chat** läuft wie vorher.
2. **Verbindung verlieren:** Eine lange Antwort starten („Schreibe einen langen Text über …“), nach wenigen Sekunden in eine andere App wechseln, 30 Sekunden warten, zurückkommen. **Prüfen, ob die Antwort fertig ist** tippen: Die Antwort steht komplett da, Guthaben ist abgebucht.
3. **Stopp:** Lange Antwort starten, **Stopp** drücken. Nach einigen Sekunden steht der erzeugte Teil da, Status „Gestoppt“, unter „Konto → Nutzung“ ein Eintrag.
4. **Fortsetzen:** Bei einer als „Gekürzt“ markierten oder gestoppten Antwort **Fortsetzen** tippen: Der Text wächst in derselben Antwort weiter.
5. **Flugmodus:** Flugmodus an, Nachricht senden: Fehler, **Prüfen** meldet „nicht angekommen“, dein Text steht im Eingabefeld.
6. **Admin → Betrieb → Reservierungen:** keine dauerhaft offenen Einträge.

## Grenzen
- Der Stopp wirkt mit einigen Sekunden Verzögerung. Bis dahin entstehende Tokens werden berechnet.
- Wenn du nach einem Verbindungsverlust sofort neu sendest, statt zu prüfen, laufen zwei Anfragen. Jede wird einzeln abgerechnet, gleichzeitig sind höchstens 3 Anfragen pro Nutzer erlaubt. Prüfe deshalb zuerst mit dem Knopf, damit nichts doppelt entsteht.
- Nicht live getestet: bitte Auffälligkeiten melden.
