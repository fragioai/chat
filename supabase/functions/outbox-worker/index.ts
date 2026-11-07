// Fragio – Edge Function "outbox-worker"
// Stellt Ereignisse aus der Ausgangsbox zu: E-Mails über Gmail (SMTP, Port 465) und Zeilen in Google Sheets.
// WICHTIG: "Verify JWT" AUSSCHALTEN. Aufruf nur mit Geheimwort (CRON_SECRET) im Header x-cron-secret.
// Antwort 500, wenn ein Ereignis endgültig fehlgeschlagen ist ("dead"): GitHub schickt dir dann eine E-Mail.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const safeEqual = (a: string, b: string) => a.length === b.length && [...a].every((c, i) => c === b[i]);
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const HEADERS: Record<string, string[]> = {
  Nutzung: ['Ereignis-ID', 'Zeit (UTC)', 'Nutzer-ID', 'E-Mail', 'Name', 'Modell', 'Eingabe-Tokens', 'Ausgabe-Tokens', 'Cache-lesen-Tokens',
    'Cache-schreiben-Tokens', 'Suchen', 'Anbieterkosten EUR', 'Aufschlag EUR', 'Wechselkurs-Aufschlag EUR', 'Gesamtkosten EUR',
    'Abgebucht EUR', 'Reserviert EUR', 'Quelle', 'Ergebnis', 'Anfrage-ID'],
  Buchungen: ['Ereignis-ID', 'Zeit (UTC)', 'Nutzer-ID', 'E-Mail', 'Art', 'Betrag EUR', 'Bezug', 'Notiz'],
  Test: ['Ereignis-ID', 'Zeit (UTC)', 'Text'],
};

// ---- Google Sheets: Zugriff über Dienstkonto ----
async function sheetsToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(enc.encode(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3300,
  })));
  const pem = sa.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${claim}`));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(sig)}` }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Google-Anmeldung fehlgeschlagen (HTTP ${r.status})`);
  return (await r.json()).access_token as string;
}

async function gfetch(token: string, url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Google Sheets HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function appendRows(token: string, sheetId: string, tab: string, rows: string[][]) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  const meta = await gfetch(token, `${base}?fields=sheets.properties.title`);
  const titles: string[] = (meta.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title);
  if (!titles.includes(tab)) {
    await gfetch(token, `${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }) });
  }
  const q = encodeURIComponent(`'${tab}'`);
  // Vorhandene Ereignis-IDs lesen (Spalte A), um doppelte Zeilen nach einem Teilausfall zu vermeiden.
  const col = await gfetch(token, `${base}/values/${q}!A1:A50000`);
  const have = new Set<string>((col.values ?? []).map((r: string[]) => r[0]));
  const out: string[][] = [];
  if (!have.size && HEADERS[tab]) out.push(HEADERS[tab]);
  for (const r of rows) if (!have.has(r[0])) out.push(r);
  if (!out.length) return 0;
  await gfetch(token, `${base}/values/${q}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST', body: JSON.stringify({ values: out }),
  });
  return out.length;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secret = Deno.env.get('CRON_SECRET') ?? '';
  if (!secret || !safeEqual(secret, req.headers.get('x-cron-secret') ?? '')) return json({ error: 'unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'server_misconfigured' }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const gmailUser = Deno.env.get('GMAIL_USER');
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD');
  const operator = Deno.env.get('OPERATOR_EMAIL');
  const saRaw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  const sheetId = Deno.env.get('GOOGLE_SHEET_ID');
  const emailReady = !!(gmailUser && gmailPass);
  const sheetsReady = !!(saRaw && sheetId);
  const kinds = [...(emailReady ? ['email'] : []), ...(sheetsReady ? ['sheet'] : [])];

  const report = { sent: 0, failed: 0, dead: 0, email_configured: emailReady, sheets_configured: sheetsReady, details: [] as string[] };
  if (!kinds.length) return json({ ok: true, ...report, note: 'Weder E-Mail noch Google Sheets sind eingerichtet. Ereignisse bleiben gespeichert.' });

  const { data: claimed, error } = await db.rpc('outbox_claim', { p_limit: 40, p_kinds: kinds });
  if (error) { console.error('outbox-worker: claim', error.message); return json({ error: 'internal' }, 500); }
  const events = (claimed ?? []) as { id: number; kind: string; payload: any }[];

  const mark = async (id: number, ok: boolean, msg = '') => {
    const { data: st } = await db.rpc('outbox_mark', { p_id: id, p_ok: ok, p_error: msg });
    if (ok) report.sent++;
    else if (st === 'dead') { report.dead++; report.details.push(`#${id}: ${msg.slice(0, 120)}`); }
    else { report.failed++; report.details.push(`#${id}: ${msg.slice(0, 120)}`); }
  };

  // ---- E-Mails ----
  const mails = events.filter((e) => e.kind === 'email');
  if (mails.length) {
    let client: SMTPClient | null = null;
    try {
      client = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: gmailUser!, password: gmailPass! } } });
      for (const m of mails) {
        const to = m.payload.to === 'OPERATOR' ? operator : String(m.payload.to);
        if (!to) { await db.rpc('outbox_defer', { p_id: m.id, p_note: 'OPERATOR_EMAIL fehlt' }); continue; }
        try {
          await client.send({ from: `Fragio <${gmailUser}>`, to, subject: String(m.payload.subject), content: String(m.payload.text) });
          await mark(m.id, true);
        } catch (e) { await mark(m.id, false, `E-Mail: ${String(e)}`); }
      }
    } catch (e) {
      for (const m of mails) await mark(m.id, false, `SMTP-Verbindung: ${String(e)}`);
    } finally { try { await client?.close(); } catch { /* ignorieren */ } }
  }

  // ---- Google Sheets (gruppiert nach Tabellenblatt) ----
  const sheets = events.filter((e) => e.kind === 'sheet');
  if (sheets.length) {
    try {
      const token = await sheetsToken(JSON.parse(saRaw!));
      const byTab = new Map<string, typeof sheets>();
      for (const s of sheets) byTab.set(s.payload.tab, [...(byTab.get(s.payload.tab) ?? []), s]);
      for (const [tab, list] of byTab) {
        try {
          await appendRows(token, sheetId!, tab, list.map((s) => (s.payload.row as unknown[]).map(String)));
          for (const s of list) await mark(s.id, true);
        } catch (e) { for (const s of list) await mark(s.id, false, String(e)); }
      }
    } catch (e) {
      for (const s of sheets) await mark(s.id, false, String(e));
    }
  }

  return json({ ok: report.dead === 0, ...report }, report.dead > 0 ? 500 : 200);
});
