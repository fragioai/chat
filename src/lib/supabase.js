import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Schutz: ein geheimer Schlüssel darf niemals im Browser landen.
function looksSecret(k) {
  if (k.startsWith('sb_secret_')) return true;
  try {
    const part = k.split('.')[1];
    if (!part) return false;
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

let problem = null;
if (!url || !key) {
  problem =
    'Die öffentlichen Supabase-Einstellungen fehlen (VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY). ' +
    'Trage sie in GitHub unter Settings → Secrets and variables → Actions → Variables ein und starte die Veröffentlichung neu.';
} else if (!/^https:\/\//.test(url)) {
  problem = 'VITE_SUPABASE_URL muss mit https:// beginnen.';
} else if (looksSecret(key)) {
  problem =
    'ACHTUNG: In VITE_SUPABASE_ANON_KEY steht ein GEHEIMER Schlüssel. Er wurde nicht verwendet. ' +
    'Lösche ihn sofort in GitHub und rotiere den Schlüssel in Supabase. Verwende nur den öffentlichen (publishable/anon) Schlüssel.';
}

export const configError = problem;

export const supabase = problem
  ? null
  : createClient(url, key, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
