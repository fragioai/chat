import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { streamChat, cancelChat } from '../lib/api.js';
import { formatEur } from '../lib/format.js';
import Markdown, { CopyButton } from '../components/Markdown.jsx';
import Sidebar from '../components/Sidebar.jsx';
import FilePreview from '../components/FilePreview.jsx';
import { ACCEPT, filesCall, formatBytes, uploadFile } from '../lib/files.js';

const PAGE = 30;
const MODEL_KEY = 'fragio-model';
const readLS = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignorieren */ } };

export default function ChatPage({ chatId }) {
  const [models, setModels] = useState([]);
  const [modelsError, setModelsError] = useState('');
  const [modelId, setModelId] = useState(() => readLS(MODEL_KEY));
  const [effort, setEffort] = useState('');
  const [webSearch, setWebSearch] = useState(false);
  const [messages, setMessages] = useState([]);
  const [meta, setMeta] = useState({});          // Zusatzinfos pro Nachricht (Kosten, Quellen)
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [balance, setBalance] = useState(null);
  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState('');
  const [showJump, setShowJump] = useState(false);
  const [attachments, setAttachments] = useState([]);   // { key, name, size, id?, stage, error? }
  const [chatFiles, setChatFiles] = useState([]);
  const [quota, setQuota] = useState(null);
  const [codeTools, setCodeTools] = useState(true);
  const [preview, setPreview] = useState(null);
  const fileInput = useRef(null);
  const [lost, setLost] = useState(null);       // { requestId, chatId }: Verbindung ging verloren, Antwort läuft evtl. weiter
  const [checking, setChecking] = useState(false);

  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const stick = useRef(true);
  const skipLoad = useRef(null);
  const textareaRef = useRef(null);
  const activeReq = useRef(null);
  const userStopped = useRef(false);

  const model = useMemo(() => models.find((m) => m.id === modelId) || null, [models, modelId]);

  // ---------- Daten laden ----------
  useEffect(() => {
    let active = true;
    supabase.functions.invoke('models').then(({ data, error: err }) => {
      if (!active) return;
      if (err || !data || !data.models) {
        setModelsError('Die Modellliste konnte nicht geladen werden.');
        return;
      }
      setModels(data.models);
      const stored = readLS(MODEL_KEY);
      const pick =
        data.models.find((m) => m.id === stored && m.available) ||
        data.models.find((m) => m.available) ||
        data.models[0];
      if (pick) setModelId(pick.id);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!model) return;
    if (!model.efforts.some((e) => e.value === effort)) setEffort(model.default_effort);
    if (!model.supports_web_search) setWebSearch(false);
  }, [model, effort]);

  const loadBalance = useCallback(async () => {
    const { data } = await supabase.from('credit_accounts').select('balance_eur').maybeSingle();
    if (data) setBalance(Number(data.balance_eur));
  }, []);
  useEffect(() => { loadBalance(); }, [loadBalance]);

  const loadChats = useCallback(async (reset = true, q = query) => {
    setChatsLoading(true);
    if (q.trim()) {
      const { data } = await supabase.rpc('search_chats', { p_query: q.trim() });
      setChats(data || []);
      setHasMore(false);
    } else {
      const from = reset ? 0 : chats.length;
      const { data } = await supabase.from('chats').select('id, title, updated_at, model_id')
        .order('updated_at', { ascending: false }).range(from, from + PAGE - 1);
      const rows = data || [];
      setChats(reset ? rows : [...chats, ...rows]);
      setHasMore(rows.length === PAGE);
    }
    setChatsLoading(false);
  }, [query, chats]);

  useEffect(() => {
    const t = setTimeout(() => loadChats(true, query), query ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const loadMessages = useCallback(async (id) => {
    if (!id) { setMessages([]); setChatFiles([]); return; }
    const { data, error: err } = await supabase.from('messages')
      .select('id, role, content, status, thinking, model_id, created_at')
      .eq('chat_id', id).order('created_at', { ascending: true });
    if (err) { setError('Der Chat konnte nicht geladen werden.'); return; }
    setMessages(data || []);
    const { data: fl } = await supabase.from('files').select('id, name, size_bytes, mime, kind, message_id, created_at').eq('chat_id', id).order('created_at', { ascending: true });
    setChatFiles(fl || []);
  }, []);

  const loadQuota = useCallback(async () => {
    try { setQuota(await filesCall('quota')); } catch { /* Anzeige ist optional */ }
  }, []);
  useEffect(() => { loadQuota(); }, [loadQuota]);

  useEffect(() => {
    if (skipLoad.current && skipLoad.current === chatId) { skipLoad.current = null; return; }
    setError(''); setNotice(''); setEditing(null);
    stick.current = true;
    loadMessages(chatId);
  }, [chatId, loadMessages]);

  // ---------- Scrollen ----------
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    setShowJump(!near);
  }
  function jumpToEnd() {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
    stick.current = true;
    setShowJump(false);
  }
  useEffect(() => {
    if (stick.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, status]);

  // ---------- Senden ----------
  async function send({ text = '', regenerate = false, editId = null, continueId = null, sendFiles = [] }) {
    if (streaming) return;
    setError(''); setNotice(''); setStatus(''); setLost(null);
    stick.current = true;
    const requestId = crypto.randomUUID();
    activeReq.current = requestId;
    userStopped.current = false;
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) { setError('Bitte melde dich erneut an.'); return; }

    setMessages((prev) => {
      let base = [...prev];
      if (editId) {
        const idx = base.findIndex((m) => m.id === editId);
        if (idx >= 0) base = base.slice(0, idx);
      } else if (regenerate && base.length && base[base.length - 1].role === 'assistant') {
        base = base.slice(0, -1);
      }
      if (continueId) return base.map((m) => (m.id === continueId ? { ...m, streaming: true } : m));
      if (!regenerate) base.push({ id: `tmp-${requestId}`, role: 'user', content: text || 'Bitte sieh dir die angehängten Dateien an.' });
      base.push({ id: 'streaming', role: 'assistant', content: '', streaming: true });
      return base;
    });
    const targetId = continueId || 'streaming';
    const baseText = continueId ? (messages.find((m) => m.id === continueId)?.content || '') : '';
    const baseThink = continueId ? (messages.find((m) => m.id === continueId)?.thinking || '') : '';
    let think = '';

    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let useChatId = chatId || null;
    let acc = '';
    let done = null;
    let failure = null;
    let gotStart = false;

    try {
      await streamChat(
        {
          request_id: requestId, model_id: modelId, effort, web_search: webSearch, text,
          chat_id: chatId || undefined, regenerate, edit_message_id: editId || undefined,
          continue_message_id: continueId || undefined,
          file_ids: sendFiles, code_tools: codeTools,
        },
        sess.session.access_token,
        (ev) => {
          if (ev.type === 'start') {
            gotStart = true;
            useChatId = ev.chat_id;
            if (ev.reduced) setNotice('Die Antwortlänge wurde wegen deines Guthabens begrenzt.');
          } else if (ev.type === 'delta') {
            acc += ev.text;
            setStatus('');
            setMessages((prev) => prev.map((m) => (m.id === targetId ? { ...m, content: baseText + acc } : m)));
          } else if (ev.type === 'thinking_delta') {
            think += ev.text;
            setStatus('');
            setMessages((prev) => prev.map((m) => (m.id === targetId ? { ...m, thinking: baseThink + (baseThink && think ? '\n\n' : '') + think } : m)));
          } else if (ev.type === 'thinking') setStatus((cur) => cur || 'Denkt nach …');
          else if (ev.type === 'searching') setStatus('Sucht im Web …');
          else if (ev.type === 'working') setStatus(ev.text);
          else if (ev.type === 'notice' && ev.code === 'max_tokens') setNotice('Die Antwort wurde wegen der Längenbegrenzung gekürzt.');
          else if (ev.type === 'done') done = ev;
          else if (ev.type === 'error') { failure = new Error(ev.message); failure.code = ev.code || 'provider_error'; }
        },
        ac.signal,
      );
    } catch (e) {
      if (e.name !== 'AbortError') {
        failure = e;
        if (e.chatId) useChatId = e.chatId;
      }
    }

    abortRef.current = null;
    setStreaming(false);
    setStatus('');
    const stoppedByUser = userStopped.current;
    // Verbindung verloren (z. B. App gewechselt oder Netz weg): Server rechnet weiter, wir fragen nur auf Knopfdruck nach.
    const connectionLost = !done && !stoppedByUser && (!failure || failure.code === undefined);
    if (connectionLost) {
      setLost({ requestId, chatId: useChatId, text });
      setNotice('Die Verbindung wurde unterbrochen. Falls die Anfrage angekommen ist, wird die Antwort auf dem Server weiter erzeugt. Tippe auf „Prüfen, ob die Antwort fertig ist“.');
    } else {
      if (failure) setError(failure.message || 'Die Anfrage ist fehlgeschlagen.');
      if (done && done.status === 'truncated' && !done.has_answer) setNotice('Zeitlimit erreicht, bevor eine sichtbare Antwort entstand (das Modell hat nur nachgedacht). Wähle eine niedrigere Denkstärke oder teile die Aufgabe auf. Die angefallenen Kosten werden geschätzt abgerechnet.');
      else if (done && done.skipped_files && done.skipped_files.length) setNotice(`Nicht gespeichert: ${done.skipped_files.join('; ')}`);
      else if (done && done.status === 'truncated') setNotice('Die Antwort wurde gekürzt (Zeit- oder Längenlimit). Mit „Fortsetzen“ schreibt das Modell weiter.');
      if (!done && stoppedByUser) setNotice('Gestoppt. Bis dahin erzeugte Teile werden nach tatsächlicher Nutzung abgerechnet.');
    }

    if (connectionLost) {
      // Angezeigten Teil stehen lassen; geladen wird erst beim Knopf „Prüfen“.
      setMessages((prev) => prev.map((m) => (m.id === targetId ? { ...m, id: continueId || 'partial', streaming: false } : m)));
      loadBalance();
      return;
    }
    if (useChatId) {
      if (!chatId) { skipLoad.current = useChatId; window.location.hash = `#/chat/${useChatId}`; }
      if (!done) await new Promise((r) => setTimeout(r, stoppedByUser ? 3500 : 1500));
      await loadMessages(useChatId);
      if (done && done.message_id) {
        setMeta((p) => ({ ...p, [done.message_id]: {
          charged: done.charged_eur, estimated: done.estimated, sources: done.sources || [], usage: done.usage } }));
      }
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== 'streaming'));
    }
    loadBalance();
    loadQuota();
    loadChats(true, query);
  }

  async function stop() {
    userStopped.current = true;
    const { data: sess } = await supabase.auth.getSession();
    if (activeReq.current && sess.session) cancelChat(activeReq.current, sess.session.access_token);
    if (abortRef.current) abortRef.current.abort();
  }

  async function checkAnswer() {
    if (!lost) return;
    setChecking(true); setError('');
    const { data: st, error: err } = await supabase.rpc('request_status', { p_request_id: lost.requestId });
    if (err) { setError('Die Prüfung hat nicht geklappt. Bitte versuche es gleich noch einmal.'); setChecking(false); return; }
    if (st === 'reserved') {
      setNotice('Die Antwort wird noch erzeugt. Bitte tippe in einer Minute noch einmal auf „Prüfen“.');
      setChecking(false);
      return;
    }
    const targetChat = lost.chatId || chatId;
    if (st === null && lost.text) setInput(lost.text);   // Anfrage kam nicht an: Text zurück ins Eingabefeld
    if (targetChat) {
      if (!chatId) { skipLoad.current = targetChat; window.location.hash = `#/chat/${targetChat}`; }
      await loadMessages(targetChat);
    } else {
      setMessages([]);
    }
    setLost(null);
    setNotice(st === 'settled' ? 'Die Antwort ist fertig und abgerechnet.'
      : st === 'released' || st === 'expired' ? 'Die Anfrage wurde ohne Antwort beendet und nicht berechnet. Du kannst „Antwort anfordern“ oder „Neu generieren“ nutzen.'
      : 'Die Anfrage ist nicht beim Server angekommen. Bitte sende sie erneut.');
    loadBalance(); loadChats(true, query);
    setChecking(false);
  }

  function submit() {
    const text = input.trim();
    const ready = attachments.filter((a) => a.id && !a.error);
    if ((!text && !ready.length) || streaming || attachments.some((a) => a.stage && !a.id && !a.error)) return;
    setInput('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    send({ text, sendFiles: ready.map((a) => a.id) });
  }

  async function pickFiles(e) {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    const maxPer = quota?.max_per_message || 5;
    const room = Math.max(0, maxPer - attachments.length);
    setError('');
    for (const file of list.slice(0, room)) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      if (file.size > (quota?.max_file || 6291456)) {
        setAttachments((p) => [...p, { key, name: file.name, size: file.size, error: 'Größer als 6 MB' }]);
        continue;
      }
      setAttachments((p) => [...p, { key, name: file.name, size: file.size, stage: 'Prüfe …' }]);
      try {
        const f = await uploadFile(file, chatId, (stage) => setAttachments((p) => p.map((a) => (a.key === key ? { ...a, stage } : a))));
        setAttachments((p) => p.map((a) => (a.key === key ? { ...a, id: f.id, stage: '', size: f.size } : a)));
      } catch (er) {
        setAttachments((p) => p.map((a) => (a.key === key ? { ...a, stage: '', error: er.message } : a)));
      }
      loadQuota();
    }
    if (list.length > room) setError(`Höchstens ${maxPer} Dateien pro Nachricht.`);
  }
  async function removeAttachment(a) {
    setAttachments((p) => p.filter((x) => x.key !== a.key));
    if (a.id) { try { await filesCall('delete', { file_id: a.id }); } catch { /* wird später aufgeräumt */ } loadQuota(); }
  }
  async function deleteFile(f) {
    try { await filesCall('delete', { file_id: f.id }); } catch (er) { setError(er.message); return; }
    setChatFiles((p) => p.filter((x) => x.id !== f.id));
    loadQuota();
  }

  function onKeyDown(e) {
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !touch) { e.preventDefault(); submit(); }
  }
  function autosize(e) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 220)}px`;
  }

  // ---------- Chatverwaltung ----------
  async function renameChat(id, title) {
    const { error: err } = await supabase.from('chats').update({ title }).eq('id', id);
    if (err) setError('Umbenennen hat nicht geklappt.');
    loadChats(true, query);
  }
  async function deleteChat(id) {
    const { error: err } = await supabase.from('chats').delete().eq('id', id);
    if (err) { setError('Löschen hat nicht geklappt.'); return; }
    if (id === chatId) window.location.hash = '#/';
    loadChats(true, query);
  }
  function openChat(id) { setSidebarOpen(false); window.location.hash = `#/chat/${id}`; }
  function newChat() { setSidebarOpen(false); window.location.hash = '#/'; setMessages([]); setError(''); setNotice(''); }

  // ---------- Anzeige ----------
  const last = messages[messages.length - 1];
  const needsAnswer = !streaming && last && last.role === 'user';
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const noCredit = balance !== null && balance <= 0;

  return (
    <div className="chat-layout">
      <Sidebar
        chats={chats} activeId={chatId} query={query} onQuery={setQuery} hasMore={hasMore}
        onMore={() => loadChats(false)} onNew={newChat} onOpen={openChat} onRename={renameChat}
        onDelete={deleteChat} open={sidebarOpen} onClose={() => setSidebarOpen(false)} loading={chatsLoading}
      />
      <section className="chat-main" aria-label="Chat">
        <div className="chat-bar">
          <button className="btn small sidebar-toggle" onClick={() => setSidebarOpen(true)} aria-label="Chatverlauf öffnen">Verlauf</button>
          <a className="balance" href="#/konto" aria-label="Guthaben, zum Konto">
            Guthaben {balance === null ? '…' : formatEur(balance)}
          </a>
        </div>

        <div className="messages" ref={scrollRef} onScroll={onScroll} role="log" aria-live="polite">
          {messages.length === 0 && (
            <div className="empty">
              <h1>Wie kann ich helfen?</h1>
              <p className="muted">Wähle unten ein Modell und stelle deine Frage.</p>
            </div>
          )}
          {messages.map((m) => (
            <article key={m.id} className={`msg-row ${m.role}`}>
              {m.role === 'user' && editing === m.id ? (
                <div className="edit-box">
                  <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4} aria-label="Nachricht bearbeiten" />
                  <div className="row">
                    <button className="btn small primary" disabled={!editText.trim() || streaming}
                      onClick={() => { const t = editText.trim(); setEditing(null); send({ text: t, editId: m.id }); }}>
                      Senden
                    </button>
                    <button className="btn small" onClick={() => setEditing(null)}>Abbrechen</button>
                  </div>
                </div>
              ) : (
                <div className={`bubble ${m.role}`}>
                  {m.role === 'user' && chatFiles.filter((f) => f.message_id === m.id).length > 0 && (
                    <div className="chips">
                      {chatFiles.filter((f) => f.message_id === m.id).map((f) => (
                        <button key={f.id} className="chip" onClick={() => setPreview(f)}>{f.name} <span className="muted">{formatBytes(f.size_bytes)}</span></button>
                      ))}
                    </div>
                  )}
                  {m.role === 'user' ? <p className="plain">{m.content}</p> : (
                    <>
                      {m.thinking && (
                        <details className="thinking" open={!!m.streaming && !m.content}>
                          <summary>{m.streaming && !m.content ? 'Gedanken (live)' : 'Gedanken lesen'}</summary>
                          <Markdown text={m.thinking} />
                        </details>
                      )}
                      {m.streaming && !m.content ? <p className="muted">{status || 'Wird geschrieben …'}</p>
                        : m.content ? <Markdown text={m.content} />
                        : chatFiles.some((f) => f.message_id === m.id) ? null
                        : <p className="muted">Es wurde noch keine Antwort geschrieben.</p>}
                      {chatFiles.filter((f) => f.message_id === m.id && f.kind === 'generated').map((f) => (
                        <div key={f.id} className="filecard">
                          <div><strong className="fname">{f.name}</strong><br /><span className="muted tiny">{formatBytes(f.size_bytes)}</span></div>
                          <div className="row">
                            <button className="btn small primary" onClick={() => setPreview(f)}>Vorschau</button>
                            <button className="btn small ghost" onClick={() => deleteFile(f)}>Löschen</button>
                          </div>
                        </div>
                      ))}
                      {m.streaming && m.content && status && <p className="muted">{status}</p>}
                      {m.status === 'aborted' && <p className="muted">Gestoppt.</p>}
                      {m.status === 'truncated' && <p className="muted">Gekürzt (Zeit- oder Längenlimit).</p>}
                    </>
                  )}
                  {!m.streaming && (
                    <div className="msg-actions">
                      <CopyButton getText={() => m.content} />
                      {m.role === 'user' && !m.id.startsWith('tmp-') && (
                        <button className="btn small ghost" disabled={streaming} onClick={() => { setEditing(m.id); setEditText(m.content); }}>Bearbeiten</button>
                      )}
                      {m.role === 'assistant' && m.id === lastAssistantId && (m.status === 'truncated' || m.status === 'aborted') && !!m.content && !lost && (
                        <button className="btn small primary" disabled={streaming} onClick={() => send({ continueId: m.id })}>Fortsetzen</button>
                      )}
                      {m.role === 'assistant' && m.id === lastAssistantId && !lost && (
                        <button className="btn small ghost" disabled={streaming} onClick={() => send({ regenerate: true })}>Neu generieren</button>
                      )}
                    </div>
                  )}
                  {meta[m.id] && (
                    <p className="muted tiny">
                      Kosten: {meta[m.id].charged == null ? '–' : formatEur(meta[m.id].charged)}
                      {meta[m.id].estimated ? ' (geschätzt)' : ''}
                    </p>
                  )}
                  {meta[m.id]?.sources?.length > 0 && (
                    <ul className="sources">
                      {meta[m.id].sources.map((s) => (
                        <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </article>
          ))}
          {lost && (
            <div className="retry">
              <button className="btn primary" onClick={checkAnswer} disabled={checking}>
                {checking ? 'Prüfe …' : 'Prüfen, ob die Antwort fertig ist'}
              </button>
            </div>
          )}
          {needsAnswer && !lost && (
            <div className="retry">
              <p className="muted">Auf deine letzte Nachricht gibt es noch keine Antwort.</p>
              <button className="btn small primary" onClick={() => send({ regenerate: true })}>Antwort anfordern</button>
            </div>
          )}
        </div>

        {showJump && <button className="jump" onClick={jumpToEnd} aria-label="Zum Ende springen">Nach unten</button>}

        <div className="composer">
          {error && <p className="msg error" role="alert">{error}</p>}
          {notice && <p className="msg ok" role="status">{notice}</p>}
          {modelsError && <p className="msg error" role="alert">{modelsError}</p>}
          {noCredit && <p className="msg error">Dein Guthaben ist leer. Aufladen ist noch nicht möglich.</p>}

          {attachments.length > 0 && (
            <div className="chips">
              {attachments.map((a) => (
                <span key={a.key} className={`chip ${a.error ? 'bad' : ''}`}>
                  {a.name} <span className="muted">{a.error ? a.error : a.stage ? a.stage : formatBytes(a.size)}</span>
                  <button type="button" className="x" onClick={() => removeAttachment(a)} aria-label={`${a.name} entfernen`}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="controls">
            <label className="field">
              <span>Modell</span>
              <select value={modelId} onChange={(e) => { setModelId(e.target.value); writeLS(MODEL_KEY, e.target.value); }} disabled={streaming}>
                {models.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.available}>
                    {m.display_name}{m.available ? '' : ' (nicht verfügbar)'}
                  </option>
                ))}
              </select>
            </label>
            {model && (
              <label className="field">
                <span>Denkstärke</span>
                <select value={effort} onChange={(e) => setEffort(e.target.value)} disabled={streaming}>
                  {model.efforts.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                </select>
              </label>
            )}
            {model && model.provider === 'anthropic' && (
              <label className="check">
                <input type="checkbox" checked={codeTools} onChange={(e) => setCodeTools(e.target.checked)} disabled={streaming} />
                Dateien erzeugen und Code ausführen
              </label>
            )}
            {model && model.supports_web_search && (
              <label className="check">
                <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} disabled={streaming} />
                Websuche{model.search_eur_per_request != null ? ` (ca. ${formatEur(model.search_eur_per_request)} je Suche)` : ''}
              </label>
            )}
          </div>
          {model && (
            <p className="muted tiny">
              {model.description} Speed: {model.speed_class}, Reasoning: {model.reasoning_class}.
              {model.price_eur_in != null && ` Preis je 1 Mio. Tokens: Eingabe ${formatEur(model.price_eur_in)}, Ausgabe ${formatEur(model.price_eur_out)} (inkl. Aufschlag).`}
              {!model.available && model.unavailable_reason === 'provider_not_configured' && ' Dieses Modell ist noch nicht eingerichtet.'}
              {!model.available && model.unavailable_reason !== 'provider_not_configured' && ' Gerade kein gültiger Preis, bitte später erneut versuchen.'}
            </p>
          )}

          {quota && <p className="muted tiny">Dateispeicher: {formatBytes(quota.used)} von {formatBytes(quota.user_limit)} belegt. Höchstens {formatBytes(quota.max_file)} pro Datei.</p>}
          <div className="input-row">
            <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={pickFiles} />
            <button type="button" className="btn" onClick={() => fileInput.current && fileInput.current.click()} disabled={streaming || !model || model.provider !== 'anthropic'} aria-label="Dateien anhängen">Anhängen</button>
            <textarea
              ref={textareaRef} value={input} onChange={autosize} onKeyDown={onKeyDown} rows={1}
              placeholder="Nachricht an Fragio" aria-label="Nachricht" maxLength={32000} disabled={streaming}
            />
            {streaming ? (
              <button className="btn danger-btn" onClick={stop}>Stopp</button>
            ) : (
              <button className="btn primary" onClick={submit} disabled={(!input.trim() && !attachments.some((a) => a.id)) || !model || !model.available || attachments.some((a) => a.stage && !a.id && !a.error)}>Senden</button>
            )}
          </div>
        </div>
      </section>
      {preview && <FilePreview file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
