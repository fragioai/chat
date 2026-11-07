import { supabase } from './supabase.js';

// Ruft die Funktion "files" auf. Wirft Error mit verständlicher Meldung.
export async function filesCall(action, params = {}) {
  const { data, error } = await supabase.functions.invoke('files', { body: { action, params } });
  if (error) {
    let message = 'Die Dateiaktion ist fehlgeschlagen.';
    try {
      const j = await error.context.json();
      message = j.message || message;
    } catch {
      /* keine JSON-Antwort */
    }
    throw new Error(message);
  }
  return data;
}

export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.zip,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.html,.htm,.xml,.yaml,.yml,.toml,.ini,.log,.sql,.svg,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.cs,.go,.rs,.rb,.php,.css,.scss,.sh';

export function formatBytes(n) {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// Lädt eine Datei hoch: reservieren, direkt in den privaten Speicher senden, serverseitig prüfen lassen.
export async function uploadFile(file, chatId, onStage) {
  onStage?.('Prüfe …');
  const init = await filesCall('init', { name: file.name, size: file.size, chat_id: chatId || undefined });
  onStage?.('Lädt hoch …');
  const { error } = await supabase.storage.from('user-files').uploadToSignedUrl(init.path, init.token, file);
  if (error) {
    await filesCall('delete', { file_id: init.file_id }).catch(() => {});
    throw new Error('Der Upload ist fehlgeschlagen. Bitte versuche es erneut.');
  }
  onStage?.('Prüft Inhalt …');
  const res = await filesCall('finalize', { file_id: init.file_id });
  return res.file;
}

export async function fileUrl(id, download = false) {
  const r = await filesCall('url', { file_id: id, download });
  return r.url;
}

export const extOf = (name) => (/\.([A-Za-z0-9]{1,8})$/.exec(name || '') || [])[1]?.toLowerCase() || '';
export const isImage = (e) => ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e);
