// Fragio – Edge Function "update-prices"
// Prüft täglich die offizielle Anthropic-Preisseite und aktualisiert die Preise automatisch.
// Schutzmaßnahmen:
//  - Aufruf nur mit geheimem Header (CRON_SECRET), JWT-Prüfung für diese Funktion AUSSCHALTEN.
//  - Claude Haiku liest nur die Seite; jede gelesene Zahl muss wörtlich auf der Seite stehen.
//  - Unplausible Sprünge (unter 25 % oder über 400 % des alten Preises) werden NICHT aktiv geschaltet,
//    sondern als "pending" gespeichert und gemeldet.
//  - Kann eine Zahl nicht sicher gelesen werden, ändert sich nichts. Alte Preise verfallen nach 14 Tagen
//    ohne Bestätigung, dann starten keine Anfragen mehr.
//  - Antwort-Status 500 bei Problemen: der GitHub-Ablauf wird rot und GitHub schickt dir eine E-Mail.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing';
const READER_MODEL = 'claude-haiku-5-5';
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const near = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) < 1e-9;
const ratioOk = (n: number, o: number) => o === 0 ? n === 0 : n / o >= 0.25 && n / o <= 4;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secret = Deno.env.get('CRON_SECRET') ?? '';
  const given = req.headers.get('x-cron-secret') ?? '';
  if (!secret || !safeEqual(secret, given)) return json({ error: 'unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!url || !serviceKey) return json({ error: 'server_misconfigured' }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const report: Record<string, unknown> = { confirmed: [], changed: [], pending: [], failed: [] };
  const fail = async (reason: string) => {
    report.failed = [...(report.failed as string[]), reason];
    await admin.rpc('log_price_update', { p_status: 'failed', p_details: report });
    return json({ ok: false, ...report }, 500);
  };

  if (!apiKey) return await fail('ANTHROPIC_API_KEY fehlt');

  // 1) Offizielle Seite laden
  let pageText = '';
  try {
    const r = await fetch(PRICING_URL, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return await fail(`Preisseite HTTP ${r.status}`);
    pageText = htmlToText(await r.text());
  } catch (e) {
    return await fail(`Preisseite nicht erreichbar: ${String(e).slice(0, 100)}`);
  }
  if (pageText.length < 3000) return await fail('Preisseite enthält zu wenig Text');

  // 2) Aktive Claude-Modelle und aktuelle Preise
  const { data: models } = await admin.from('model_configs').select('id, api_model_id, display_name')
    .eq('provider', 'anthropic').eq('status', 'enabled');
  if (!models?.length) return await fail('Keine aktiven Claude-Modelle');
  const current: Record<string, any> = {};
  for (const m of models) {
    const { data } = await admin.from('price_versions').select('*').eq('model_id', m.id).eq('status', 'active')
      .lte('valid_from', new Date().toISOString()).order('valid_from', { ascending: false }).limit(5);
    const row = (data ?? []).find((r: any) => !r.valid_until || new Date(r.valid_until) > new Date());
    if (!row) return await fail(`Kein aktueller Preis für ${m.id}`);
    current[m.id] = row;
  }

  // 3) Haiku liest die Seite (Kosten: wenige Cent pro Monat, trägt der Betreiber)
  const wanted = models.map((m: any) => `${m.api_model_id} (Seitenname: "${m.display_name}")`).join('; ');
  const prompt =
    `Lies den folgenden Text der offiziellen Preisseite und gib die Standard-API-Preise (Batch- und Fast-Mode-Preise ignorieren) ` +
    `in US-Dollar je 1 Million Tokens für diese Modelle zurück: ${wanted}.\n` +
    `Antworte NUR mit JSON in dieser Form, ohne Text davor oder danach:\n` +
    `{"models":[{"api_model_id":"...","input":0,"output":0,"cache_read":0,"cache_write_5m":0,` +
    `"long_threshold_tokens":null,"long_input":null,"long_output":null,"long_cache_read":null,"long_cache_write_5m":null}],` +
    `"web_search_usd_per_1000":null}\n` +
    `Regeln: Zahlen exakt wie auf der Seite. Gibt es für ein Modell ab einer Prompt-Länge höhere Preise, trage die Schwelle in Tokens und die höheren Preise in die long_*-Felder ein, sonst null. ` +
    `Wenn du einen Wert nicht sicher findest, schreibe null.\n\nSEITENTEXT:\n${pageText.slice(0, 90_000)}`;

  let parsed: any;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: READER_MODEL, max_tokens: 2000, output_config: { effort: 'low' }, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) return await fail(`Leser-Modell HTTP ${r.status}`);
    const j = await r.json();
    const text = (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    parsed = JSON.parse(text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
  } catch (e) {
    return await fail(`Preise konnten nicht gelesen werden: ${String(e).slice(0, 100)}`);
  }

  // 4) Jede gelesene Zahl muss auf der Seite stehen (Schutz vor Fehllesung)
  const onPage = new Set<number>();
  for (const n of pageText.match(/\d+(?:[.,]\d+)?/g) ?? []) onPage.add(parseFloat(n.replace(',', '.')));
  const verify = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && onPage.has(v));
  const numOrNull = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);

  const searchPer1000 = numOrNull(parsed?.web_search_usd_per_1000);
  if (searchPer1000 === null || !verify(searchPer1000)) return await fail('Preis der Websuche nicht sicher lesbar');
  const searchPerRequest = searchPer1000 / 1000;

  const toConfirm: number[] = [];
  for (const m of models) {
    const x = (parsed?.models ?? []).find((p: any) => p.api_model_id === m.api_model_id);
    const cur = current[m.id];
    if (!x) { report.failed = [...(report.failed as string[]), `${m.id}: nicht gefunden`]; continue; }
    const f = {
      input: numOrNull(x.input), output: numOrNull(x.output), cr: numOrNull(x.cache_read), cw: numOrNull(x.cache_write_5m),
      th: numOrNull(x.long_threshold_tokens), lin: numOrNull(x.long_input), lout: numOrNull(x.long_output),
      lcr: numOrNull(x.long_cache_read), lcw: numOrNull(x.long_cache_write_5m),
    };
    if (f.input === null || f.output === null || f.cr === null || f.cw === null ||
        ![x.input, x.output, x.cache_read, x.cache_write_5m, x.long_input, x.long_output, x.long_cache_read, x.long_cache_write_5m].every(verify)) {
      report.failed = [...(report.failed as string[]), `${m.id}: Zahlen nicht sicher lesbar`];
      continue;
    }
    const hasLongDb = cur.long_context_threshold !== null;
    if (hasLongDb && (f.th === null || f.lin === null || f.lout === null)) {
      report.failed = [...(report.failed as string[]), `${m.id}: Langkontext-Preise nicht lesbar`];
      continue;
    }
    if (!hasLongDb && f.th !== null) {
      report.pending = [...(report.pending as string[]), `${m.id}: neue Preisstufe nach Prompt-Länge entdeckt, bitte prüfen`];
      continue;
    }

    const same = near(f.input, +cur.input_usd_per_mtok) && near(f.output, +cur.output_usd_per_mtok) &&
      near(f.cr, +cur.cache_read_usd_per_mtok) && near(f.cw, +cur.cache_write_usd_per_mtok) &&
      near(searchPerRequest, +cur.search_usd_per_request) &&
      (!hasLongDb || (near(f.th, cur.long_context_threshold) && near(f.lin, +cur.long_input_usd_per_mtok) &&
        near(f.lout, +cur.long_output_usd_per_mtok) && near(f.lcr, cur.long_cache_read_usd_per_mtok === null ? null : +cur.long_cache_read_usd_per_mtok) &&
        near(f.lcw, cur.long_cache_write_usd_per_mtok === null ? null : +cur.long_cache_write_usd_per_mtok)));

    if (same) { toConfirm.push(cur.id); (report.confirmed as string[]).push(m.id); continue; }

    const plausible = ratioOk(f.input, +cur.input_usd_per_mtok) && ratioOk(f.output, +cur.output_usd_per_mtok) &&
      ratioOk(f.cr, +cur.cache_read_usd_per_mtok) && ratioOk(f.cw, +cur.cache_write_usd_per_mtok);
    const { error } = await admin.rpc('apply_price_update', {
      p_model_id: m.id, p_in: f.input, p_out: f.output, p_cr: f.cr, p_cw: f.cw,
      p_long_threshold: hasLongDb ? f.th : null, p_long_in: hasLongDb ? f.lin : null, p_long_out: hasLongDb ? f.lout : null,
      p_long_cr: hasLongDb ? f.lcr : null, p_long_cw: hasLongDb ? f.lcw : null,
      p_search: searchPerRequest, p_source: PRICING_URL,
      p_note: plausible ? 'Automatisch aktualisiert' : 'Unplausible Änderung, NICHT aktiv: bitte prüfen',
      p_status: plausible ? 'active' : 'pending',
    });
    if (error) { report.failed = [...(report.failed as string[]), `${m.id}: ${error.message}`]; continue; }
    const entry = `${m.id}: ${cur.input_usd_per_mtok}/${cur.output_usd_per_mtok} -> ${f.input}/${f.output}`;
    if (plausible) (report.changed as string[]).push(entry);
    else (report.pending as string[]).push(entry);
  }

  if (toConfirm.length) await admin.rpc('confirm_prices', { p_ids: toConfirm });

  const bad = (report.failed as string[]).length > 0 || (report.pending as string[]).length > 0;
  const status = (report.failed as string[]).length ? 'failed' : (report.pending as string[]).length ? 'pending'
    : (report.changed as string[]).length ? 'changed' : 'ok';
  await admin.rpc('log_price_update', { p_status: status, p_details: report });
  return json({ ok: !bad, ...report }, bad ? 500 : 200);
});
