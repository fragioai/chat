import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';

// Fragio-Widget dauerhaft rechts mittig positionieren
function fixWidgetPosition() {
  const host = document.getElementById('kk-agent-host');

  if (!host || !host.shadowRoot) return;

  const widget = host.shadowRoot.querySelector('.w');

  if (!widget) return;

  widget.style.setProperty('position', 'fixed', 'important');
  widget.style.setProperty('top', '50%', 'important');
  widget.style.setProperty('right', '16px', 'important');
  widget.style.setProperty('bottom', 'auto', 'important');
  widget.style.setProperty('left', 'auto', 'important');
  widget.style.setProperty('transform', 'translateY(-50%)', 'important');
  widget.style.setProperty('z-index', '2147483000', 'important');
}

// Auf das Widget warten und Änderungen überwachen
const widgetObserver = new MutationObserver(() => {
  fixWidgetPosition();
});

widgetObserver.observe(document.documentElement, {
  childList: true,
  subtree: true
});

// Auch nach dem Laden erneut prüfen
fixWidgetPosition();
window.addEventListener('load', fixWidgetPosition);
window.addEventListener('resize', fixWidgetPosition);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
