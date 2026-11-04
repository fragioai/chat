# Fragio – KI-Chat mit Guthaben

Status: **Phase 3 (Grundsystem)**. Funktioniert: Registrierung, Anmeldung (E-Mail und Google),
Passwort-Reset, Konto mit Guthabenanzeige und Buchungsliste, Kontolöschung, Hell/Dunkel.
**Noch nicht vorhanden:** Chat, Modelle, Dateien, Zahlungen (kommen in den Phasen 4 bis 7).

Einrichtung für das iPhone: `docs/PHASE3-Einrichtung.md`.

Struktur: `src/` Frontend (Vite + React), `supabase/migrations/` SQL, `supabase/functions/` Edge Functions,
`supabase/tests/` SQL-Selbsttest. Geheime Schlüssel gehören nie in dieses Repository.
