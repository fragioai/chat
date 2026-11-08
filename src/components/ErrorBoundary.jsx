import { Component } from 'react';

// Fängt Darstellungsfehler ab, damit nie eine leere weiße Seite bleibt.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Nur in der Konsole, keine Daten werden gesendet.
    console.error('Fragio-Darstellungsfehler:', error, info && info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const text = `Fragio-Fehler\nZeit: ${new Date().toISOString()}\nSeite: ${window.location.href.split('?')[0]}\nMeldung: ${String(error && error.message ? error.message : error).slice(0, 300)}\nBrowser: ${navigator.userAgent}`;
    return (
      <main className="center-card" role="alert">
        <h1>Etwas ist schiefgelaufen</h1>
        <p>Die Seite konnte nicht angezeigt werden. Deine Daten sind nicht verloren.</p>
        <div className="row">
          <button className="btn primary" onClick={() => window.location.reload()}>Seite neu laden</button>
          <button className="btn" onClick={() => { window.location.hash = '#/'; this.setState({ error: null }); }}>Zum Chat</button>
        </div>
        <details>
          <summary className="muted">Technische Angaben für den Support</summary>
          <pre className="plainpre">{text}</pre>
          <button className="btn small" onClick={() => navigator.clipboard && navigator.clipboard.writeText(text)}>Angaben kopieren</button>
        </details>
      </main>
    );
  }
}
