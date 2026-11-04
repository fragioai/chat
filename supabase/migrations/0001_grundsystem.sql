-- Fragio – Migration 0001: Grundsystem (Profile, Rollen, Guthaben, Ledger)
-- Sicher wiederholbar: mehrfaches Ausführen überschreibt keine Daten.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  status text not null default 'active'
    check (status in ('active', 'blocked', 'deletion_requested')),
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin')),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- Kontostand wird später ausschließlich durch Serverfunktionen verändert (Phase 6/7).
create table if not exists public.credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_eur numeric(18, 8) not null default 0,
  reserved_eur numeric(18, 8) not null default 0 check (reserved_eur >= 0),
  updated_at timestamptz not null default now()
);

-- Unveränderliches Buchungsjournal. user_id wird beim Löschen eines Kontos auf NULL gesetzt
-- (Anonymisierung), die Buchung selbst bleibt für Abrechnungszwecke erhalten.
create table if not exists public.ledger_entries (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  entry_type text not null check (entry_type in (
    'deposit', 'reservation', 'charge', 'release', 'refund', 'correction', 'admin_adjustment')),
  amount_eur numeric(18, 8) not null,
  idempotency_key text not null unique,
  reference_type text,
  reference_id text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists ledger_entries_user_created_idx
  on public.ledger_entries (user_id, created_at desc);

-- Ledger ist append-only: kein Löschen, kein Ändern.
-- Einzige Ausnahme: user_id von einem Wert auf NULL (Anonymisierung bei Kontolöschung).
create or replace function public.ledger_entries_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ledger_entries ist unveränderlich (DELETE nicht erlaubt)';
  end if;

  if tg_op = 'UPDATE'
     and old.user_id is not null
     and new.user_id is null
     and (new.id, new.entry_type, new.amount_eur, new.idempotency_key,
          new.reference_type, new.reference_id, new.note, new.created_at)
         is not distinct from
         (old.id, old.entry_type, old.amount_eur, old.idempotency_key,
          old.reference_type, old.reference_id, old.note, old.created_at)
  then
    return new;
  end if;

  raise exception 'ledger_entries ist unveränderlich (UPDATE nicht erlaubt)';
end;
$$;

drop trigger if exists ledger_entries_guard_trg on public.ledger_entries;
create trigger ledger_entries_guard_trg
  before update or delete on public.ledger_entries
  for each row execute function public.ledger_entries_guard();

-- Neues Profil und Guthabenkonto automatisch bei Registrierung.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      'Nutzer'), 60)
  )
  on conflict (id) do nothing;

  insert into public.credit_accounts (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admin-Prüfung ausschließlich über die serverseitige Tabelle user_roles.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- Bereits vorhandene Nutzer (falls vor der Migration registriert) nachziehen.
insert into public.profiles (id, display_name)
select u.id, 'Nutzer' from auth.users u
on conflict (id) do nothing;

insert into public.credit_accounts (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;
