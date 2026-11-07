import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import Logo from '../components/Logo.jsx';

const redirectTo = window.location.origin + import.meta.env.BASE_URL;
// Google-Anmeldung ist vorerst ausgeschaltet. Einschalten: GitHub-Variable VITE_GOOGLE_LOGIN = true
const GOOGLE_ENABLED = import.meta.env.VITE_GOOGLE_LOGIN === 'true';

function germanError(error) {
  const m = (error && error.message ? error.message : '').toLowerCase();
  if (m.includes('invalid login')) return 'E-Mail oder Passwort ist falsch.';
  if (m.includes('email not confirmed')) return 'Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Bestätigungs-Mail).';
  if (m.includes('rate limit') || m.includes('too many')) return 'Zu viele Versuche. Bitte warte einige Minuten und versuche es erneut.';
  if (m.includes('password') && m.includes('characters')) return 'Das Passwort ist zu kurz.';
  if (m.includes('network') || m.includes('failed to fetch')) return 'Keine Verbindung. Prüfe dein Internet und versuche es erneut.';
  return 'Das hat leider nicht geklappt. Bitte versuche es erneut.';
}

export default function AuthPage({ recovery, onRecoveryDone }) {
  const [mode, setMode] = useState('login'); // login | register | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const switchMode = (m) => {
    setMode(m);
    setError('');
    setInfo('');
  };

  async function run(fn) {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await fn();
    } catch (e) {
      setError(germanError(e));
    } finally {
      setBusy(false);
    }
  }

  const submit = (e) => {
    e.preventDefault();
    if (recovery) {
      return run(async () => {
        if (password.length < 8) throw new Error('Das Passwort ist zu kurz (characters)');
        const { error: err } = await supabase.auth.updateUser({ password });
        if (err) throw err;
        onRecoveryDone();
      });
    }
    if (mode === 'login') {
      return run(async () => {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
      });
    }
    if (mode === 'register') {
      return run(async () => {
        if (password.length < 8) throw new Error('Das Passwort ist zu kurz (characters)');
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim().slice(0, 60) }, emailRedirectTo: redirectTo },
        });
        if (err) throw err;
        if (!data.session) {
          setInfo('Fast geschafft: Wir haben dir eine E-Mail geschickt. Klicke auf den Link darin, um dein Konto zu bestätigen. Schau auch im Spam-Ordner nach.');
        }
      });
    }
    return run(async () => {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (err) throw err;
      setInfo('Wenn zu dieser E-Mail ein Konto existiert, haben wir einen Link zum Zurücksetzen geschickt.');
    });
  };

  const google = () =>
    run(async () => {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (err) throw err;
    });

  const title = recovery
    ? 'Neues Passwort festlegen'
    : mode === 'login'
    ? 'Anmelden'
    : mode === 'register'
    ? 'Konto erstellen'
    : 'Passwort zurücksetzen';

  return (
    <main className="center-card">
      <Logo />
      <h1>{title}</h1>
      <form onSubmit={submit} className="form" noValidate={false}>
        {mode === 'register' && !recovery && (
          <label>
            Anzeigename
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="nickname" required />
          </label>
        )}
        {!recovery && (
          <label>
            E-Mail
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required />
          </label>
        )}
        {(recovery || mode !== 'reset') && (
          <label>
            {recovery ? 'Neues Passwort (mindestens 8 Zeichen)' : 'Passwort'}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' && !recovery ? 'current-password' : 'new-password'}
              minLength={mode === 'login' && !recovery ? undefined : 8}
              required
            />
          </label>
        )}
        {error && <p className="msg error" role="alert">{error}</p>}
        {info && <p className="msg ok" role="status">{info}</p>}
        <button className="btn primary" disabled={busy} type="submit">
          {busy ? 'Bitte warten …' : recovery ? 'Passwort speichern' : mode === 'login' ? 'Anmelden' : mode === 'register' ? 'Konto erstellen' : 'Link senden'}
        </button>
      </form>

      {GOOGLE_ENABLED && !recovery && mode !== 'reset' && (
        <>
          <div className="divider"><span>oder</span></div>
          <button className="btn google" onClick={google} disabled={busy} type="button">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            <span>Mit Google fortfahren</span>
          </button>
        </>
      )}

      {!recovery && (
        <p className="links">
          {mode !== 'login' && <button className="link" onClick={() => switchMode('login')}>Zur Anmeldung</button>}
          {mode !== 'register' && <button className="link" onClick={() => switchMode('register')}>Konto erstellen</button>}
          {mode === 'login' && <button className="link" onClick={() => switchMode('reset')}>Passwort vergessen?</button>}
        </p>
      )}
    </main>
  );
}
