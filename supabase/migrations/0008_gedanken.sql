-- Fragio – Migration 0008: Gedanken (zusammengefasste Denk-Texte) pro Antwort speichern
-- Voraussetzung: 0001 bis 0007. Sicher wiederholbar.
alter table public.messages add column if not exists thinking text;
