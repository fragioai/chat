import { useEffect, useState } from 'react';
import { supabase, configError } from './lib/supabase.js';
import { useRoute } from './lib/route.js';
import { useTheme } from './lib/theme.js';
import AuthPage from './pages/AuthPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import { adminCall } from './lib/admin.js';
import Logo from './components/Logo.jsx';

export default function App() {
  const route = useRoute();
  const { effective, toggle } = useTheme();
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

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

  useEffect(() => {
    if (!session) { setIsAdmin(false); return; }
    adminCall('whoami').then((w) => setIsAdmin(!!w.is_admin)).catch(() => setIsAdmin(false));
  }, [session]);

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
  const onAdmin = route.startsWith('/admin');
  const chatMatch = /^\/chat\/([0-9a-f-]{36})$/i.exec(route);
  const chatId = chatMatch ? chatMatch[1] : null;
  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/" className="brand" aria-label="Zum Chat">
          <Logo />
        </a>
        <nav aria-label="Hauptnavigation" className="nav">
          <a href="#/" aria-current={onAccount || onAdmin ? undefined : 'page'}>Chat</a>
          <a href="#/konto" aria-current={onAccount ? 'page' : undefined}>Konto</a>
          {isAdmin && <a href="#/admin" aria-current={onAdmin ? 'page' : undefined}>Admin</a>}
        </nav>
        <details className="menu">
          <summary className="btn ghost" aria-label="Menü öffnen">Menü</summary>
          <div className="menu-pop">
            <button onClick={(e) => { e.currentTarget.closest('details').open = false; toggle(); }}>
              {effective === 'dark' ? 'Helles Design' : 'Dunkles Design'}
            </button>
            <button onClick={() => supabase.auth.signOut()}>Abmelden</button>
          </div>
        </details>
      </header>
      {onAdmin ? (
        <main className="content wide">
          <AdminPage />
        </main>
      ) : onAccount ? (
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
