import { supabase } from './supabase.js';

// Ruft die Admin-Funktion auf. Wirft Error mit verständlicher Meldung (err.code = technischer Code).
export async function adminCall(action, params = {}) {
  const { data, error } = await supabase.functions.invoke('admin', { body: { action, params } });
  if (error) {
    let code = 'error';
    let message = 'Die Aktion ist fehlgeschlagen.';
    try {
      const j = await error.context.json();
      code = j.error || code;
      message = j.message || message;
    } catch {
      /* keine JSON-Antwort */
    }
    const e = new Error(message);
    e.code = code;
    throw e;
  }
  return data;
}

export const num = (v, digits = 0) =>
  Number(v ?? 0).toLocaleString('de-DE', { maximumFractionDigits: digits });
