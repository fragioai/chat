const BASE = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Sendet eine Chat-Anfrage und liefert die Server-Ereignisse (SSE) nacheinander an onEvent.
export async function streamChat(body, accessToken, onEvent, signal) {
  const res = await fetch(`${BASE}/functions/v1/chat`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    let j = null;
    try {
      j = await res.json();
    } catch {
      /* keine JSON-Antwort */
    }
    const err = new Error((j && j.message) || 'Die Anfrage ist fehlgeschlagen.');
    err.code = (j && j.error) || `http_${res.status}`;
    err.chatId = (j && j.chat_id) || null;
    throw err;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of block.split('\n')) {
        if (line.startsWith('data:')) {
          try {
            onEvent(JSON.parse(line.slice(5).trim()));
          } catch {
            /* unlesbares Ereignis ignorieren */
          }
        }
      }
    }
  }
}

// Stopp-Wunsch an den Server: Er beendet die laufende Antwort und rechnet bis dahin ab.
export async function cancelChat(requestId, accessToken) {
  try {
    await fetch(`${BASE}/functions/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: ANON },
      body: JSON.stringify({ cancel_request_id: requestId }),
    });
  } catch {
    /* Netzwerkfehler: der Server beendet die Antwort spätestens nach dem Zeitlimit */
  }
}
