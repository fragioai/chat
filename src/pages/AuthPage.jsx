import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import Logo from '../components/Logo.jsx';

const redirectTo = window.location.origin + import.meta.env.BASE_URL;
// Sicherheitsprüfung (Cloudflare Turnstile): nur aktiv, wenn VITE_TURNSTILE_SITE_KEY gesetzt ist.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
// Google-Anmeldung ist vorerst ausgeschaltet. Einschalten: GitHub-Variable VITE_GOOGLE_LOGIN = true
const GOOGLE_ENABLED = import.meta.env.VITE_GOOGLE_LOGIN === 'true';

function germanError(error) {
  const m = (error && error.message ? error.message : '').toLowerCase();
  if (m.includes('invalid login')) return 'E-Mail oder Passwort ist falsch.';
  if (m.includes('email not confirmed')) return 'Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Bestätigungs-Mail).';
  if (m.includes('captcha')) return 'Die Sicherheitsprüfung ist fehlgeschlagen. Bitte versuche es erneut.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled') || m.includes('signups are disabled')) return 'Die Registrierung ist derzeit geschlossen.';
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
  const [captchaToken, setCaptchaToken] = useState('');
  const widgetBox = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    if (!SITE_KEY || recovery) return undefined;
    let cancelled = false;
    function mount() {
      if (cancelled || !window.turnstile || !widgetBox.current || widgetId.current !== null) return;
      widgetId.current = window.turnstile.render(widgetBox.current, {
        sitekey: SITE_KEY, theme: 'auto', language: 'de',
        callback: (t) => setCaptchaToken(t),
        'expired-callback': () => setCaptchaToken(''),
        'error-callback': () => setCaptchaToken(''),
      });
    }
    if (window.turnstile) mount();
    else {
      let el = document.getElementById('turnstile-script');
      if (!el) {
        el = document.createElement('script');
        el.id = 'turnstile-script';
        el.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        el.async = true;
        document.head.appendChild(el);
      }
      el.addEventListener('load', mount);
    }
    return () => {
      cancelled = true;
      if (widgetId.current !== null && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch { /* ignorieren */ }
      }
      widgetId.current = null;
    };
  }, [recovery]);

  // Eine Bestätigung gilt nur für einen Versuch.
  function resetCaptcha() {
    setCaptchaToken('');
    if (widgetId.current !== null && window.turnstile) {
      try { window.turnstile.reset(widgetId.current); } catch { /* ignorieren */ }
    }
  }

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
      if (SITE_KEY && !recovery) resetCaptcha();
    }
  }

  const submit = (e) => {
    e.preventDefault();
    if (SITE_KEY && !recovery && !captchaToken) { setError('Bitte bestätige zuerst die Sicherheitsprüfung.'); return undefined; }
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
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password, options: { captchaToken } });
        if (err) throw err;
      });
    }
    if (mode === 'register') {
      return run(async () => {
        if (password.length < 8) throw new Error('Das Passwort ist zu kurz (characters)');
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim().slice(0, 60) }, emailRedirectTo: redirectTo, captchaToken },
        });
        if (err) throw err;
        if (!data.session) {
          setInfo('Fast geschafft: Wir haben dir eine E-Mail geschickt. Klicke auf den Link darin, um dein Konto zu bestätigen. Schau auch im Spam-Ordner nach.');
        }
      });
    }
    return run(async () => {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo, captchaToken });
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
        {SITE_KEY && !recovery && <div ref={widgetBox} className="captcha" aria-label="Sicherheitsprüfung" />}
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
            <img className="g g-light" src={`${import.meta.env.BASE_URL}google-g-light.png`} width="20" height="20" alt="" />
            <img className="g g-dark" src={`${import.meta.env.BASE_URL}google-g-dark.png`} width="20" height="20" alt="" />
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
