import { useState } from 'react';

// Geschützte Aktion: Begründung (Pflicht) und Bestätigungswort. Der Server prüft beides erneut.
export default function SensitiveForm({ title, children, onSubmit, submitLabel = 'Ausführen', danger = false }) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const ok = reason.trim().length >= 5 && confirm === 'BESTÄTIGEN';

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setDone(false);
    try {
      await onSubmit({ reason: reason.trim(), confirm });
      setReason('');
      setConfirm('');
      setDone(true);
    } catch (er) {
      setError(er.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sens form" onSubmit={submit}>
      <h3>{title}</h3>
      {children}
      <label>
        Begründung (Pflicht, mindestens 5 Zeichen)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
      </label>
      <label>
        Zur Bestätigung <strong>BESTÄTIGEN</strong> eintippen
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" autoCapitalize="characters" />
      </label>
      {error && <p className="msg error" role="alert">{error}</p>}
      {done && <p className="msg ok" role="status">Erledigt und protokolliert.</p>}
      <button className={`btn ${danger ? 'danger-btn' : 'primary'}`} disabled={!ok || busy} type="submit">
        {busy ? 'Bitte warten …' : submitLabel}
      </button>
    </form>
  );
}
