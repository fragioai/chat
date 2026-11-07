// Fragio – Edge Function "admin"
// Einziger Zugang des Browsers zu Administrationsfunktionen.
// Schutz: (1) gültige Anmeldung, (2) Rolle "admin" in der Tabelle user_roles (serverseitig),
// (3) Zwei-Faktor-Anmeldung (Sitzungsstufe aal2), (4) Pflicht-Begründung bei Änderungen, (5) Audit-Protokoll.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://fragioai.github.io';
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const err = (code: string, s: number, message: string) => json({ error: code, message }, s);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_MSG = 'Bitte gib eine Begründung mit mindestens 5 Zeichen an.';

const DB_MESSAGES: Record<string, string> = {
  reason_required: REASON_MSG,
  amount_invalid: 'Der Betrag ist ungültig (nicht 0, höchstens 1000 €).',
  balance_would_be_negative: 'Das Guthaben würde negativ. Diese Korrektur ist nicht erlaubt.',
  user_not_found: 'Nutzer nicht gefunden.',
  cannot_change_self: 'Du kannst dein eigenes Konto nicht sperren.',
  deletion_pending: 'Dieses Konto wird gerade gelöscht.',
  status_invalid: 'Ungültiger Status.',
  model_not_found: 'Modell nicht gefunden.',
  price_not_pending: 'Dieser Preis wartet nicht auf Freigabe.',
  value_invalid: 'Ungültiger Wert.',
  key_or_range_invalid: 'Einstellung oder Wertebereich ungültig.',
  key_invalid: 'Einstellung unbekannt.',
  mail_incomplete: 'Betreff und Text der E-Mail müssen ausgefüllt sein.',
  mail_limit: 'Höchstens 5 E-Mails pro Nutzer und Tag.',
};

function jwtClaims(token: string): Record<string, unknown> {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p));
  } catch { return {}; }
}

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // Schutz vor Formel-Einschleusung in Tabellenprogrammen
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return err('method_not_allowed', 405, 'Methode nicht erlaubt.');

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return err('server_misconfigured', 500, 'Serverfehler.');
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return err('unauthorized', 401, 'Bitte melde dich an.');
  const { data: ud, error: ue } = await db.auth.getUser(token);
  const user = ud?.user;
  if (ue || !user) return err('unauthorized', 401, 'Bitte melde dich an.');

  let body: { action?: string; params?: Record<string, unknown> };
  try { body = await req.json(); } catch { return err('bad_request', 400, 'Ungültige Anfrage.'); }
  const action = String(body.action ?? '');
  const p = (body.params ?? {}) as Record<string, any>;

  // Rolle prüfen (serverseitig, nicht manipulierbar durch den Browser)
  const { data: roleRow } = await db.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle();
  const isAdmin = !!roleRow;
  const aal = String(jwtClaims(token).aal ?? 'aal1');

  if (action === 'whoami') return json({ is_admin: isAdmin, aal });
  if (!isAdmin) {
    await db.rpc('log_security_event', { p_type: 'admin_denied', p_user: user.id, p_details: { action } });
    return err('forbidden', 403, 'Kein Zugriff.');
  }
  if (aal !== 'aal2') return err('mfa_required', 403, 'Bitte bestätige zuerst die Zwei-Faktor-Anmeldung.');

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  // Ausgangsbox sofort abarbeiten lassen (ruft die Funktion "outbox-worker" mit dem Geheimwort auf)
  const runWorker = async () => {
    const secret = Deno.env.get('CRON_SECRET');
    if (!secret) throw Object.assign(new Error('Das Geheimwort CRON_SECRET fehlt in den Supabase-Secrets.'), { bad: true });
    const r = await fetch(`${url}/functions/v1/outbox-worker`, {
      method: 'POST', headers: { 'x-cron-secret': secret, 'Content-Type': 'application/json', apikey: serviceKey }, body: '{}',
      signal: AbortSignal.timeout(100_000),
    });
    let j: Record<string, unknown> = {};
    try { j = await r.json(); } catch { /* keine JSON-Antwort */ }
    if (r.status === 404) throw Object.assign(new Error('Die Funktion "outbox-worker" ist nicht bereitgestellt.'), { bad: true });
    return { http: r.status, ...j };
  };
  const need = (cond: boolean, msg = 'Ungültige Eingabe.') => { if (!cond) throw Object.assign(new Error(msg), { bad: true }); };
  const reason = typeof p.reason === 'string' ? p.reason.trim() : '';
  const confirmed = p.confirm === 'BESTÄTIGEN';
  const dec = (v: unknown) => String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const sensitive = () => { need(reason.length >= 5, REASON_MSG); need(confirmed, 'Bitte tippe zur Bestätigung BESTÄTIGEN.'); };

  try {
    switch (action) {
      // ---------- Lesen ----------
      case 'overview': return json(await rpc('admin_overview', { p_days: Number(p.days) || 30 }));
      case 'users_list':
        return json({ rows: await rpc('admin_users', { p_query: String(p.q ?? '').slice(0, 100), p_limit: 25, p_offset: Math.max(0, Number(p.offset) || 0) }) });
      case 'user_detail': need(UUID.test(String(p.user_id))); return json(await rpc('admin_user_detail', { p_user: p.user_id }));
      case 'models_list': return json({ rows: await rpc('admin_models', {}) });
      case 'prices_list': {
        let q = db.from('price_versions').select('*').order('created_at', { ascending: false }).limit(100);
        if (typeof p.model_id === 'string' && p.model_id) q = q.eq('model_id', p.model_id);
        const [pv, lg] = await Promise.all([q, db.from('price_update_log').select('*').order('run_at', { ascending: false }).limit(20)]);
        return json({ prices: pv.data ?? [], log: lg.data ?? [] });
      }
      case 'settings_list': {
        const { data } = await db.from('app_settings').select('key, value, updated_at').order('key');
        return json({ rows: data ?? [] });
      }
      case 'reservations_list': {
        let q = db.from('reservations').select('request_id, user_id, model_id, reserved_eur, final_eur, status, created_at, settled_at').order('created_at', { ascending: false }).limit(100);
        if (['reserved', 'settled', 'released', 'expired'].includes(String(p.status))) q = q.eq('status', p.status);
        return json({ rows: (await q).data ?? [] });
      }
      case 'errors_list': return json({ rows: (await db.from('api_errors').select('*').order('created_at', { ascending: false }).limit(100)).data ?? [] });
      case 'security_list': {
        const ev = await db.from('security_events').select('*').order('created_at', { ascending: false }).limit(100);
        return json({ rows: ev.data ?? [], rate_top: await rpc('admin_rate_top', {}) });
      }
      case 'audit_list': return json({ rows: (await db.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(200)).data ?? [] });
      case 'outbox_overview': return json(await rpc('outbox_stats', {}));
      case 'outbox_run': return json(await runWorker());
      case 'test_email':
        await rpc('outbox_enqueue_email', { p_to: 'OPERATOR', p_subject: 'Fragio: Testmail', p_body: `Dies ist eine Testmail aus dem Admin-Bereich.\nZeit: ${new Date().toISOString()}`, p_key: `testmail:${crypto.randomUUID()}` });
        return json(await runWorker());
      case 'test_sheet': {
        const id = `testsheet:${crypto.randomUUID()}`;
        await rpc('outbox_enqueue_sheet', { p_tab: 'Test', p_row: [id, new Date().toISOString(), 'Testzeile aus dem Admin-Bereich'], p_key: id });
        return json(await runWorker());
      }
      case 'ledger_check': return json({ rows: await rpc('ledger_consistency', {}) });
      case 'export': {
        need(['usage', 'ledger', 'users', 'audit'].includes(String(p.kind)));
        const rows = await rpc('admin_export', {
          p_kind: p.kind, p_from: p.from ? new Date(String(p.from)).toISOString() : null,
          p_to: p.to ? new Date(String(p.to)).toISOString() : null,
        });
        await rpc('admin_log', { p_admin: user.id, p_action: 'export', p_target: null, p_details: { kind: p.kind, rows: (rows as unknown[]).length } });
        return json({ csv: toCsv(rows as Record<string, unknown>[]), rows: (rows as unknown[]).length });
      }

      // ---------- Ändern (Begründung + Bestätigung Pflicht) ----------
      case 'set_user_status':
        need(UUID.test(String(p.user_id))); sensitive();
        await rpc('admin_set_user_status', { p_admin: user.id, p_user: p.user_id, p_status: p.status, p_reason: reason });
        return json({ ok: true });
      case 'adjust_credit': {
        need(UUID.test(String(p.user_id))); sensitive();
        const amountStr = dec(p.amount);
        need(/^-?\d+(\.\d{1,8})?$/.test(amountStr), 'Der Betrag ist ungültig.');
        return json(await rpc('admin_adjust_credit', { p_admin: user.id, p_user: p.user_id, p_amount: amountStr, p_reason: reason }));
      }
      case 'set_model_status':
        need(typeof p.model_id === 'string'); sensitive();
        await rpc('admin_set_model_status', { p_admin: user.id, p_model: p.model_id, p_status: p.status, p_reason: reason });
        return json({ ok: true });
      case 'approve_price':
        need(Number.isInteger(Number(p.price_id))); sensitive();
        await rpc('admin_approve_price', { p_admin: user.id, p_price_id: Number(p.price_id), p_reason: reason });
        return json({ ok: true });
      case 'add_price': {
        sensitive();
        const n = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(dec(v)));
        const input = n(p.input), output = n(p.output);
        need(typeof p.model_id === 'string' && input !== null && output !== null && input >= 0 && output >= 0);
        const cr = n(p.cache_read), cw = n(p.cache_write), search = n(p.search) ?? 0;
        need([cr, cw, search].every((x) => x === null || (isFinite(x) && x >= 0)));
        const id = await rpc('apply_price_update', {
          p_model_id: p.model_id, p_in: String(input), p_out: String(output),
          p_cr: cr === null ? null : String(cr), p_cw: cw === null ? null : String(cw),
          p_long_threshold: null, p_long_in: null, p_long_out: null, p_long_cr: null, p_long_cw: null,
          p_search: String(search), p_source: 'Manuell durch Admin', p_note: `Manuell: ${reason}`.slice(0, 200), p_status: 'active',
        });
        await rpc('admin_log', { p_admin: user.id, p_action: 'add_price', p_target: null, p_details: { price_id: id, model: p.model_id, input, output, cr, cw, search, reason } });
        return json({ ok: true, price_id: id });
      }
      case 'confirm_prices': {
        sensitive();
        const { data: act } = await db.from('price_versions').select('id').eq('status', 'active');
        const ids = (act ?? []).map((r: { id: number }) => r.id);
        const n = await rpc('confirm_prices', { p_ids: ids });
        await rpc('admin_log', { p_admin: user.id, p_action: 'confirm_prices', p_target: null, p_details: { count: n, reason } });
        return json({ ok: true, count: n });
      }
      case 'retry_dead': {
        sensitive();
        const n = await rpc('outbox_retry_dead', { p_admin: user.id, p_reason: reason });
        return json({ ok: true, count: n });
      }
      case 'email_user': {
        need(UUID.test(String(p.user_id))); sensitive();
        const id = await rpc('admin_email_user', { p_admin: user.id, p_user: p.user_id, p_subject: String(p.subject ?? '').trim(), p_body: String(p.body ?? '').trim(), p_reason: reason });
        let sent: unknown = null;
        try { sent = await runWorker(); } catch { /* wird später zugestellt */ }
        return json({ ok: true, outbox_id: id, worker: sent });
      }
      case 'update_setting':
        need(typeof p.key === 'string'); sensitive();
        await rpc('admin_update_setting', { p_admin: user.id, p_key: p.key, p_value: dec(p.value), p_reason: reason });
        return json({ ok: true });
      case 'release_reservation':
        need(UUID.test(String(p.request_id))); sensitive();
        await rpc('release_reservation', { p_request_id: p.request_id, p_reason: `Admin: ${reason}`.slice(0, 150), p_new_status: 'released' });
        await rpc('admin_log', { p_admin: user.id, p_action: 'release_reservation', p_target: null, p_details: { request_id: p.request_id, reason } });
        return json({ ok: true });
      default:
        return err('unknown_action', 400, 'Unbekannte Aktion.');
    }
  } catch (e) {
    const m = (e as Error).message;
    if ((e as { bad?: boolean }).bad) return err('invalid_input', 400, m);
    if (DB_MESSAGES[m]) return err(m, 400, DB_MESSAGES[m]);
    console.error('admin:', action, m);
    return err('internal', 500, 'Serverfehler.');
  }
});
