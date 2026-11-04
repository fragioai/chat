import { useState } from 'react';
import { formatDate } from '../lib/format.js';

export default function Sidebar({
  chats, activeId, query, onQuery, hasMore, onMore, onNew, onOpen, onRename, onDelete, open, onClose, loading,
}) {
  const [renamingId, setRenamingId] = useState(null);
  const [title, setTitle] = useState('');
  const [confirmId, setConfirmId] = useState(null);

  function startRename(c) {
    setRenamingId(c.id);
    setTitle(c.title);
    setConfirmId(null);
  }
  async function saveRename(e) {
    e.preventDefault();
    const t = title.trim();
    if (t) await onRename(renamingId, t.slice(0, 120));
    setRenamingId(null);
  }

  return (
    <>
      {open && <div className="scrim" onClick={onClose} aria-hidden="true" />}
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Chatverlauf">
        <div className="sidebar-head">
          <button className="btn primary block" onClick={onNew}>Neuer Chat</button>
          <input
            type="search"
            placeholder="Chats durchsuchen"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            aria-label="Chats durchsuchen"
          />
        </div>
        <ul className="chat-list">
          {chats.map((c) => (
            <li key={c.id} className={c.id === activeId ? 'active' : ''}>
              {renamingId === c.id ? (
                <form onSubmit={saveRename} className="rename">
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus aria-label="Neuer Titel" />
                  <button className="btn small primary" type="submit">OK</button>
                  <button className="btn small" type="button" onClick={() => setRenamingId(null)}>Abbrechen</button>
                </form>
              ) : confirmId === c.id ? (
                <div className="rename">
                  <span>Chat löschen?</span>
                  <button className="btn small danger-btn" onClick={() => { setConfirmId(null); onDelete(c.id); }}>Löschen</button>
                  <button className="btn small" onClick={() => setConfirmId(null)}>Nein</button>
                </div>
              ) : (
                <>
                  <button className="chat-item" onClick={() => onOpen(c.id)} title={formatDate(c.updated_at)}>
                    {c.title}
                  </button>
                  <span className="chat-actions">
                    <button className="btn small ghost" onClick={() => startRename(c)} aria-label={`${c.title} umbenennen`}>Umbenennen</button>
                    <button className="btn small ghost" onClick={() => setConfirmId(c.id)} aria-label={`${c.title} löschen`}>Löschen</button>
                  </span>
                </>
              )}
            </li>
          ))}
          {!loading && chats.length === 0 && <li className="muted pad">{query ? 'Keine Treffer.' : 'Noch keine Chats.'}</li>}
        </ul>
        {hasMore && !query && <button className="btn block" onClick={onMore}>Mehr laden</button>}
      </aside>
    </>
  );
}
