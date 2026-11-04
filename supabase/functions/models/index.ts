// Fragio – Edge Function "models": Modellliste mit Preisen und Verfügbarkeit für den angemeldeten Nutzer.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://fragioai.github.io';
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  Vary: 'Origin',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const auth = req.headers.get('Authorization') ?? '';
  if (!url || !anon) return json({ error: 'server_misconfigured' }, 500);
  if (!auth) return json({ error: 'unauthorized' }, 401);

  // Mit dem Token des Nutzers aufrufen: auth.uid() ist in der Datenbankfunktion gesetzt.
  const client = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data, error } = await client.rpc('list_models_public');
  if (error) {
    console.error('models:', error.message);
    return json({ error: error.message === 'unauthorized' ? 'unauthorized' : 'internal' }, error.message === 'unauthorized' ? 401 : 500);
  }

  const keys: Record<string, boolean> = {
    anthropic: !!Deno.env.get('ANTHROPIC_API_KEY'),
    google: !!Deno.env.get('GEMINI_API_KEY'),
  };
  const models = (data as Array<Record<string, unknown>>).map((m) => {
    const configured = keys[String(m.provider)] === true;
    return {
      ...m,
      available: m.available === true && configured,
      unavailable_reason: m.available !== true ? m.unavailable_reason : configured ? null : 'provider_not_configured',
    };
  });
  return json({ models });
});
