import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { adminCall } from '../lib/admin.js';
import { Overview, Users, ModelsPrices, Operations, Settings, Audit, ExportTab, PaymentsInfo } from './AdminSections.jsx';

const TABS = [
  ['overview', 'Übersicht'], ['users', 'Nutzer'], ['models', 'Modelle & Preise'], ['ops', 'Betrieb'],
  ['settings', 'Einstellungen'], ['audit', 'Protokoll'], ['export', 'Export'], ['payments', 'Zahlungen'],
];

// Zwei-Faktor-Schritt: Authenticator-App (TOTP). Ohne Stufe aal2 lehnt der Server jede Aktion ab.
function MfaGate({ onDone }) {
  const [factor, setFactor] = useState(null);      // { id, secret, uri } bei Neueinrichtung
  const [factorId, setFactorId] = useState(null);  // vorhandener bestätigter Faktor
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const t = (data?.totp || []).find((f) => f.status === 'verified');
      if (t) setFactorId(t.id);
    });
  }, []);

  async function enroll() {
    setError('');
    const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Fragio Admin ${Date.now()}` });
    if (err) { setError('Die Einrichtung ist fehlgeschlagen. Ist die Zwei-Faktor-Anmeldung in Supabase aktiviert?'); return; }
    setFactor({ id: data.id, secret: data.totp.secret, uri: data.totp.uri });
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const id = factor ? factor.id : factorId;
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code: code.trim() });
    setBusy(false);
    if (err) { setError('Der Code ist falsch oder abgelaufen.'); return; }
    await supabase.auth.refreshSession();
    onDone();
  }

  return (
    <section className="card">
      <h1>Zwei-Faktor-Bestätigung</h1>
      <p>Der Admin-Bereich ist besonders geschützt. Bitte bestätige dich mit einer Authenticator-App.</p>
      {!factorId && !factor && (
        <>
          <p className="muted">Du hast noch keinen zweiten Faktor eingerichtet.</p>
          <button className="btn primary" onClick={enroll}>Authenticator einrichten</button>
        </>
      )}
      {factor && (
        <div className="stack">
          <p>Auf dem iPhone: Öffne die App <strong>Passwörter</strong> (oder eine Authenticator-App), lege einen neuen Eintrag an und gib diesen Einrichtungsschlüssel ein:</p>
          <p className="secret">{factor.secret}</p>
          <p><a href={factor.uri}>In Authenticator-App öffnen</a></p>
          <p className="muted">Danach zeigt die App einen 6-stelligen Code. Trage ihn unten ein.</p>
        </div>
      )}
      {(factorId || factor) && (
        <form className="form" onSubmit={verify}>
          <label>
            6-stelliger Code
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
          </label>
          {error && <p className="msg error" role="alert">{error}</p>}
          <button className="btn primary" disabled={busy || code.trim().length !== 6}>Bestätigen</button>
        </form>
      )}
      {error && !factorId && !factor && <p className="msg error" role="alert">{error}</p>}
    </section>
  );
}

export default function AdminPage() {
  const [state, setState] = useState('loading'); // loading | denied | mfa | ready | error
  const [tab, setTab] = useState('overview');

  const check = useCallback(async () => {
    setState('loading');
    try {
      const w = await adminCall('whoami');
      if (!w.is_admin) setState('denied');
      else if (w.aal !== 'aal2') setState('mfa');
      else setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => { check(); }, [check]);

  if (state === 'loading') return <p aria-busy="true">Wird geladen …</p>;
  if (state === 'denied') return <section className="card"><h1>Kein Zugriff</h1><p>Dieses Konto hat keine Administrator-Rechte.</p></section>;
  if (state === 'error') return <section className="card"><h1>Fehler</h1><p>Der Admin-Bereich ist nicht erreichbar. Ist die Funktion „admin“ bereitgestellt?</p><button className="btn" onClick={check}>Erneut versuchen</button></section>;
  if (state === 'mfa') return <MfaGate onDone={check} />;

  const View = { overview: Overview, users: Users, models: ModelsPrices, ops: Operations, settings: Settings, audit: Audit, export: ExportTab, payments: PaymentsInfo }[tab];
  return (
    <div className="stack">
      <h1>Administration</h1>
      <nav className="tabs" aria-label="Admin-Bereiche">
        {TABS.map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>{label}</button>
        ))}
      </nav>
      <View />
    </div>
  );
}
