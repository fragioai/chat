// Fragio – Edge Function "files"
// Datei-Upload (direkt in privaten Speicher per signiertem Link), Prüfung, Löschen, Download-Links, Aufräumen.
// WICHTIG: "Verify JWT" für diese Funktion AUSSCHALTEN. Die Funktion prüft die Anmeldung selbst,
// und der tägliche Aufräumjob ruft sie mit einem Geheimwort (CRON_SECRET) auf.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://fragioai.github.io';
const BUCKET = 'user-files';
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (code: string, s: number, message: string) => json({ error: code, message }, s);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Kind = 'pdf' | 'image' | 'zip' | 'office' | 'text';
const TEXT_EXT = ['txt', 'md', 'csv', 'json', 'html', 'htm', 'xml', 'yaml', 'yml', 'toml', 'ini', 'log', 'sql', 'svg',
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'css', 'scss', 'sh'];
const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', json: 'application/json', md: 'text/markdown', html: 'text/html', htm: 'text/html',
};
function kindOf(ext: string): Kind | null {
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (ext === 'zip') return 'zip';
  if (['docx', 'xlsx', 'pptx'].includes(ext)) return 'office';
  if (TEXT_EXT.includes(ext)) return 'text';
  return null;
}
const mimeOf = (ext: string) => MIME[ext] ?? 'text/plain';
function extOf(name: string) { const m = /\.([A-Za-z0-9]{1,8})$/.exec(name); return m ? m[1].toLowerCase() : ''; }
function cleanName(raw: string) {
  let n = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  n = n.replace(/[^\p{L}\p{N}._ ()\-]/gu, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return n.slice(-100);
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
function zipInfo(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('zip_invalid');
  const total = dv.getUint16(e + 10, true), cdSize = dv.getUint32(e + 12, true), cdOff = dv.getUint32(e + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw new Error('zip_unsupported');
  let p = cdOff, unc = 0;
  const names: string[] = [];
  for (let n = 0; n < total; n++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip_invalid');
    if (dv.getUint16(p + 8, true) & 1) throw new Error('zip_encrypted');
    unc += dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    names.push(new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl)));
    p += 46 + nl + el + cl;
  }
  return { names, unc };
}

// Prüft den tatsächlichen Inhalt (nicht nur die Endung). Wirft Error mit Code bei Problemen.
export function validate(ext: string, b: Uint8Array): { zipEntries: number | null } {
  const kind = kindOf(ext);
  if (!kind) throw new Error('type_not_allowed');
  if (kind === 'pdf') { if (!startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) throw new Error('content_mismatch'); }
  else if (kind === 'image') {
    const ok = (ext === 'png' && startsWith(b, [0x89, 0x50, 0x4e, 0x47])) ||
      ((ext === 'jpg' || ext === 'jpeg') && startsWith(b, [0xff, 0xd8, 0xff])) ||
      (ext === 'gif' && startsWith(b, [0x47, 0x49, 0x46, 0x38])) ||
      (ext === 'webp' && startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8));
    if (!ok) throw new Error('content_mismatch');
  } else if (kind === 'zip' || kind === 'office') {
    if (!startsWith(b, [0x50, 0x4b, 0x03, 0x04])) throw new Error('content_mismatch');
    const z = zipInfo(b);
    if (z.names.length > 3000) throw new Error('zip_too_many');
    if (z.unc > 150 * 1024 * 1024 || z.unc / Math.max(b.length, 1) > 200) throw new Error('zip_bomb');
    if (z.names.some((n) => n.startsWith('/') || n.split(/[\\/]/).includes('..'))) throw new Error('zip_unsafe');
    if (kind === 'office') {
      const need = ext === 'docx' ? 'word/' : ext === 'xlsx' ? 'xl/' : 'ppt/';
      if (!z.names.includes('[Content_Types].xml') || !z.names.some((n) => n.startsWith(need))) throw new Error('content_mismatch');
    }
    return { zipEntries: z.names.length };
  } else {
    let txt: string;
    try { txt = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { throw new Error('text_invalid'); }
    if (txt.includes('\u0000')) throw new Error('text_invalid');
  }
  return { zipEntries: null };
}

const MESSAGES: Record<string, string> = {
  account_blocked: 'Dein Konto ist gesperrt.',
  file_empty: 'Die Datei ist leer.',
  file_too_large: 'Die Datei ist zu groß (höchstens 6 MB).',
  quota_user: 'Dein Speicherplatz (70 MB) ist voll. Lösche zuerst alte Dateien.',
  quota_total: 'Der Speicher der Plattform ist gerade voll. Bitte versuche es später erneut.',
  too_many_pending: 'Es laufen schon zu viele Uploads. Bitte warte kurz.',
  chat_not_found: 'Chat nicht gefunden.',
  type_not_allowed: 'Dieser Dateityp ist nicht erlaubt.',
  content_mismatch: 'Der Inhalt passt nicht zum Dateityp.',
  text_invalid: 'Die Textdatei ist nicht gültig (UTF-8 erwartet, keine Binärdaten).',
  zip_invalid: 'Das ZIP-Archiv ist beschädigt.',
  zip_unsupported: 'Dieses ZIP-Format (ZIP64) wird nicht unterstützt.',
  zip_encrypted: 'Passwortgeschützte ZIP-Dateien werden nicht unterstützt.',
  zip_too_many: 'Das ZIP enthält zu viele Dateien (höchstens 3000).',
  zip_bomb: 'Das ZIP entpackt sich zu groß und wird abgelehnt.',
  zip_unsafe: 'Das ZIP enthält unsichere Pfade.',
  file_not_found: 'Datei nicht gefunden.',
};

async function providerDelete(id: string) {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key || !id) return;
  try {
    await fetch(`https://api.anthropic.com/v1/files/${id}`, {
      method: 'DELETE',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'files-api-2025-04-14' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) { console.error('files: Anbieter-Löschung fehlgeschlagen', String(e)); }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('method_not_allowed', 405, 'Methode nicht erlaubt.');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return fail('server_misconfigured', 500, 'Serverfehler.');
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: { action?: string; params?: Record<string, any> };
  try { body = await req.json(); } catch { return fail('bad_request', 400, 'Ungültige Anfrage.'); }
  const action = String(body.action ?? '');
  const p = body.params ?? {};

  // ---- Aufräumen (nur mit Geheimwort, kein Nutzer) ----
  if (action === 'purge') {
    const secret = Deno.env.get('CRON_SECRET') ?? '';
    const given = req.headers.get('x-cron-secret') ?? '';
    if (!secret || secret.length !== given.length || ![...secret].every((c, i) => c === given[i])) return fail('unauthorized', 401, 'Nicht erlaubt.');
    const report = { removed_objects: 0, removed_provider: 0, abandoned: 0 };
    const { data: dead } = await db.from('files').select('id, storage_path, provider_file_id')
      .or(`deleted_at.not.is.null,and(status.eq.pending,created_at.lt.${new Date(Date.now() - 86400000).toISOString()}),status.eq.rejected`).limit(200);
    for (const f of dead ?? []) {
      await db.storage.from(BUCKET).remove([f.storage_path]);
      if (f.provider_file_id) { await providerDelete(f.provider_file_id); report.removed_provider++; }
      await db.from('files').delete().eq('id', f.id);
      report.removed_objects++;
    }
    const { data: ttl } = await db.from('app_settings').select('value').eq('key', 'provider_file_ttl_days').maybeSingle();
    const days = Number(ttl?.value) || 7;
    const { data: old } = await db.from('files').select('id, provider_file_id')
      .not('provider_file_id', 'is', null).lt('provider_uploaded_at', new Date(Date.now() - days * 86400000).toISOString()).limit(200);
    for (const f of old ?? []) {
      await providerDelete(f.provider_file_id);
      await db.from('files').update({ provider_file_id: null, provider_uploaded_at: null }).eq('id', f.id);
      report.removed_provider++;
    }
    return json({ ok: true, ...report });
  }

  // ---- Nutzeraktionen ----
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return fail('unauthorized', 401, 'Bitte melde dich an.');
  const { data: ud, error: ue } = await db.auth.getUser(token);
  const user = ud?.user;
  if (ue || !user) return fail('unauthorized', 401, 'Bitte melde dich an.');

  const rl = await db.rpc('check_rate_limit', { p_user: user.id, p_bucket: 'files', p_limit: 60, p_window_seconds: 60 });
  if (rl.data === false) return fail('rate_limited', 429, 'Zu viele Anfragen. Bitte warte einen Moment.');

  const known = (m: string) => MESSAGES[m] ?? null;
  try {
    switch (action) {
      case 'quota': {
        const { data } = await db.rpc('file_usage', { p_user: user.id });
        return json(data);
      }
      case 'init': {
        const name = cleanName(p.name);
        const ext = extOf(name);
        const size = Number(p.size);
        if (!name || !kindOf(ext)) return fail('type_not_allowed', 400, MESSAGES.type_not_allowed);
        if (!Number.isFinite(size)) return fail('bad_request', 400, 'Ungültige Anfrage.');
        const chat = p.chat_id && UUID.test(String(p.chat_id)) ? String(p.chat_id) : null;
        const { data, error } = await db.rpc('file_reserve', { p_user: user.id, p_name: name, p_size: Math.floor(size), p_chat: chat });
        if (error) {
          const m = known(error.message);
          if (m) return fail(error.message, 400, m);
          console.error('files: init', error.message);
          return fail('internal', 500, 'Serverfehler.');
        }
        const { data: up, error: ue2 } = await db.storage.from(BUCKET).createSignedUploadUrl(data.path);
        if (ue2 || !up) {
          await db.from('files').delete().eq('id', data.file_id);
          console.error('files: signierter Upload', ue2?.message);
          return fail('internal', 500, 'Serverfehler.');
        }
        return json({ file_id: data.file_id, path: data.path, token: up.token, name });
      }
      case 'finalize': {
        if (!UUID.test(String(p.file_id))) return fail('bad_request', 400, 'Ungültige Anfrage.');
        const { data: f } = await db.from('files').select('id, name, storage_path, status').eq('id', p.file_id).eq('user_id', user.id).is('deleted_at', null).maybeSingle();
        if (!f || f.status !== 'pending') return fail('file_not_found', 404, MESSAGES.file_not_found);
        const reject = async (code: string) => {
          await db.storage.from(BUCKET).remove([f.storage_path]);
          await db.from('files').update({ status: 'rejected', deleted_at: new Date().toISOString() }).eq('id', f.id);
          return fail(code, 400, MESSAGES[code] ?? 'Die Datei wurde abgelehnt.');
        };
        const dl = await db.storage.from(BUCKET).download(f.storage_path);
        if (dl.error || !dl.data) return await reject('file_not_found');
        const bytes = new Uint8Array(await dl.data.arrayBuffer());
        const maxFile = Number((await db.from('app_settings').select('value').eq('key', 'max_file_bytes').maybeSingle()).data?.value) || 6291456;
        if (bytes.length === 0) return await reject('file_empty');
        if (bytes.length > maxFile) return await reject('file_too_large');
        const ext = extOf(f.name);
        let info;
        try { info = validate(ext, bytes); } catch (e) { return await reject((e as Error).message); }
        const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
        const { error } = await db.rpc('file_ready', { p_file: f.id, p_user: user.id, p_size: bytes.length, p_sha: sha, p_mime: mimeOf(ext), p_zip_entries: info.zipEntries });
        if (error) { console.error('files: file_ready', error.message); return fail('internal', 500, 'Serverfehler.'); }
        return json({ ok: true, file: { id: f.id, name: f.name, size: bytes.length, mime: mimeOf(ext), kind: 'upload' } });
      }
      case 'delete': {
        if (!UUID.test(String(p.file_id))) return fail('bad_request', 400, 'Ungültige Anfrage.');
        const { data: f } = await db.from('files').select('id, storage_path, provider_file_id').eq('id', p.file_id).eq('user_id', user.id).maybeSingle();
        if (!f) return fail('file_not_found', 404, MESSAGES.file_not_found);
        await db.storage.from(BUCKET).remove([f.storage_path]);
        if (f.provider_file_id) await providerDelete(f.provider_file_id);
        await db.from('files').delete().eq('id', f.id);
        return json({ ok: true });
      }
      case 'url': {
        if (!UUID.test(String(p.file_id))) return fail('bad_request', 400, 'Ungültige Anfrage.');
        const { data: f } = await db.from('files').select('name, storage_path').eq('id', p.file_id).eq('user_id', user.id).eq('status', 'ready').is('deleted_at', null).maybeSingle();
        if (!f) return fail('file_not_found', 404, MESSAGES.file_not_found);
        const { data, error } = await db.storage.from(BUCKET).createSignedUrl(f.storage_path, 120, p.download ? { download: f.name } : undefined);
        if (error || !data) return fail('internal', 500, 'Serverfehler.');
        return json({ url: data.signedUrl });
      }
      default:
        return fail('unknown_action', 400, 'Unbekannte Aktion.');
    }
  } catch (e) {
    console.error('files:', action, String(e));
    return fail('internal', 500, 'Serverfehler.');
  }
});
