import { useEffect, useState } from 'react';
import { supabase, configError } from './lib/supabase.js';
import { useRoute } from './lib/route.js';
import { useTheme } from './lib/theme.js';
import AuthPage from './pages/AuthPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import Logo from './components/Logo.jsx';

export default function App() {
  const route = useRoute();
  const { effective, toggle } = useTheme();
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setRecovery(false);
      setReady(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (configError) {
    return (
      <main className="center-card" role="alert">
        <Logo />
        <h1>Einrichtung unvollständig</h1>
        <p>{configError}</p>
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="center-card" aria-busy="true">
        <Logo />
        <p>Wird geladen …</p>
      </main>
    );
  }

  if (!session || recovery) {
    return <AuthPage recovery={recovery} onRecoveryDone={() => setRecovery(false)} />;
  }

  const onAccount = route.startsWith('/konto');
  const chatMatch = /^\/chat\/([0-9a-f-]{36})$/i.exec(route);
  const chatId = chatMatch ? chatMatch[1] : null;
  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/" className="brand" aria-label="Zum Chat">
          <Logo />
        </a>
        <nav aria-label="Hauptnavigation" className="nav">
          <a href="#/" aria-current={onAccount ? undefined : 'page'}>Chat</a>
          <a href="#/konto" aria-current={onAccount ? 'page' : undefined}>Konto</a>
        </nav>
        <div className="topbar-actions">
          <button className="btn ghost" onClick={toggle} aria-label="Zwischen hellem und dunklem Design wechseln">
            {effective === 'dark' ? 'Hell' : 'Dunkel'}
          </button>
          <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Abmelden</button>
        </div>
      </header>
      {onAccount ? (
        <main className="content">
          <AccountPage session={session} />
        </main>
      ) : (
        <main className="chat-wrap">
          <ChatPage chatId={chatId} />
        </main>
      )}
    </div>
  );
}
