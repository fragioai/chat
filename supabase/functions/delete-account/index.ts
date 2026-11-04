// Fragio – Edge Function "delete-account"
// Löscht das Konto des angemeldeten Nutzers. Läuft ausschließlich serverseitig.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://fragioai.github.io';

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    console.error('delete-account: SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt');
    return json({ error: 'server_misconfigured' }, 500);
  }

  // Identität serverseitig aus dem Token bestimmen – niemals aus dem Request-Body.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: 'unauthorized' }, 401);

  let body: { confirm?: string; forfeit_balance?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (body?.confirm !== 'KONTO LÖSCHEN') return json({ error: 'confirmation_required' }, 400);

  const { data: account, error: accountError } = await admin
    .from('credit_accounts')
    .select('balance_eur, reserved_eur')
    .eq('user_id', user.id)
    .maybeSingle();
  if (accountError) {
    console.error('delete-account: Konto lesen fehlgeschlagen', accountError.message);
    return json({ error: 'internal' }, 500);
  }

  const balance = Number(account?.balance_eur ?? 0);
  const reserved = Number(account?.reserved_eur ?? 0);

  if (reserved > 0) return json({ error: 'open_reservations' }, 409);
  if (balance < 0) return json({ error: 'negative_balance' }, 409);
  if (balance > 0 && body.forfeit_balance !== true) {
    return json({ error: 'balance_forfeit_required' }, 409);
  }

  // Verfallendes Guthaben nachvollziehbar im Ledger festhalten (Gegenbuchung).
  if (balance > 0) {
    const { error: ledgerError } = await admin.from('ledger_entries').insert({
      user_id: user.id,
      entry_type: 'correction',
      amount_eur: -balance,
      idempotency_key: `account_deletion:${user.id}`,
      reference_type: 'account_deletion',
      reference_id: user.id,
      note: 'Restguthaben bei Kontolöschung verfallen',
    });
    // 23505 = Buchung existiert schon (Wiederholung) – dann ist alles in Ordnung.
    if (ledgerError && ledgerError.code !== '23505') {
      console.error('delete-account: Ledger-Eintrag fehlgeschlagen', ledgerError.message);
      return json({ error: 'internal' }, 500);
    }
  }

  await admin.from('profiles').update({ status: 'deletion_requested' }).eq('id', user.id);

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('delete-account: deleteUser fehlgeschlagen', deleteError.message);
    return json({ error: 'delete_failed' }, 500);
  }

  return json({ ok: true });
});
