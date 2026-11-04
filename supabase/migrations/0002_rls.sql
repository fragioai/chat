-- Fragio – Migration 0002: Row Level Security und Rechte
-- Grundsatz: Der Browser darf nur EIGENE Daten lesen und fast nichts schreiben.
-- Guthaben, Ledger und Rollen können vom Browser aus NICHT verändert werden.

alter table public.profiles        enable row level security;
alter table public.user_roles      enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.ledger_entries  enable row level security;

-- Alle Standardrechte entziehen, danach gezielt vergeben.
revoke all on public.profiles        from anon, authenticated;
revoke all on public.user_roles      from anon, authenticated;
revoke all on public.credit_accounts from anon, authenticated;
revoke all on public.ledger_entries  from anon, authenticated;
revoke truncate on public.ledger_entries from public;

grant select on public.profiles        to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.credit_accounts to authenticated;
grant select on public.ledger_entries  to authenticated;
-- user_roles: keinerlei Browser-Zugriff.

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists credit_accounts_select_own on public.credit_accounts;
create policy credit_accounts_select_own on public.credit_accounts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists ledger_select_own on public.ledger_entries;
create policy ledger_select_own on public.ledger_entries
  for select to authenticated using (user_id = auth.uid());

-- Kein INSERT/UPDATE/DELETE für authenticated/anon auf credit_accounts, ledger_entries,
-- user_roles: ohne Recht und ohne Policy sind solche Anfragen nicht möglich.

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
