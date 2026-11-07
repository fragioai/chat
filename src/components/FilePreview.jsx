import { useEffect, useState } from 'react';
import { extOf, fileUrl, formatBytes, isImage } from '../lib/files.js';
import { CopyButton } from './Markdown.jsx';

const TEXT_MAX = 400_000;

// Einfache, sichere Vorschauen. Keine fremden Skripte: HTML läuft in einem gesperrten Rahmen ohne Skripte.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const sep = (text.split('\n')[0] || '').split(';').length > (text.split('\n')[0] || '').split(',').length ? ';' : ',';
  for (let i = 0; i < text.length && rows.length < 200; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function zipOf(url) {
  const JSZip = (await import('jszip')).default;
  const buf = await (await fetch(url)).arrayBuffer();
  return JSZip.loadAsync(buf);
}
const xmlDoc = (s) => new DOMParser().parseFromString(s, 'application/xml');

async function previewOffice(url, ext) {
  const zip = await zipOf(url);
  if (ext === 'docx') {
    const x = xmlDoc(await zip.file('word/document.xml').async('string'));
    const paras = [...x.getElementsByTagName('w:p')].map((p) => [...p.getElementsByTagName('w:t')].map((t) => t.textContent).join('')).filter((t) => t.trim());
    return { type: 'text', text: paras.slice(0, 3000).join('\n\n') };
  }
  if (ext === 'xlsx') {
    const ss = zip.file('xl/sharedStrings.xml');
    const strings = ss ? [...xmlDoc(await ss.async('string')).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')) : [];
    const sheetName = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
    if (!sheetName) return { type: 'text', text: 'Keine Tabelle gefunden.' };
    const x = xmlDoc(await zip.file(sheetName).async('string'));
    const rows = [...x.getElementsByTagName('row')].slice(0, 100).map((r) => {
      const out = [];
      for (const c of [...r.getElementsByTagName('c')].slice(0, 26)) {
        const col = (c.getAttribute('r') || '').replace(/\d+/g, '');
        const idx = col.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const v = c.getElementsByTagName('v')[0]?.textContent ?? c.getElementsByTagName('t')[0]?.textContent ?? '';
        out[idx] = c.getAttribute('t') === 's' ? strings[Number(v)] ?? '' : v;
      }
      return Array.from(out, (v) => v ?? '');
    });
    return { type: 'table', rows };
  }
  // pptx: Text je Folie
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)) - Number(b.match(/\d+/)));
  const out = [];
  for (const n of slides.slice(0, 60)) {
    const x = xmlDoc(await zip.file(n).async('string'));
    const t = [...x.getElementsByTagName('a:p')].map((p) => [...p.getElementsByTagName('a:t')].map((e) => e.textContent).join('')).filter((s) => s.trim());
    out.push(`Folie ${out.length + 1}\n${t.join('\n')}`);
  }
  return { type: 'text', text: out.join('\n\n') };
}

export default function FilePreview({ file, onClose }) {
  const [state, setState] = useState({ loading: true });
  const ext = extOf(file.name);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const url = await fileUrl(file.id);
        if (ext === 'pdf') return active && setState({ type: 'pdf', url });
        if (isImage(ext)) return active && setState({ type: 'image', url });
        if (ext === 'zip') {
          const zip = await zipOf(url);
          const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name);
          return active && setState({ type: 'zip', names });
        }
        if (['docx', 'xlsx', 'pptx'].includes(ext)) {
          const r = await previewOffice(url, ext);
          return active && setState(r);
        }
        const text = (await (await fetch(url)).text()).slice(0, TEXT_MAX);
        if (ext === 'csv') return active && setState({ type: 'table', rows: parseCsv(text) });
        if (ext === 'html' || ext === 'htm') return active && setState({ type: 'html', text });
        return active && setState({ type: 'text', text });
      } catch {
        if (active) setState({ error: 'Die Vorschau konnte nicht geladen werden.' });
      }
    })();
    return () => { active = false; };
  }, [file.id, ext]);

  async function download() {
    try { window.location.href = await fileUrl(file.id, true); } catch { setState({ error: 'Der Download ist fehlgeschlagen.' }); }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Vorschau ${file.name}`}>
      <div className="modal-box">
        <div className="row between">
          <strong className="fname">{file.name}</strong>
          <button className="btn small" onClick={onClose}>Schließen</button>
        </div>
        <p className="muted tiny">{formatBytes(file.size_bytes ?? file.size)}</p>
        <div className="preview">
          {state.loading && <p aria-busy="true">Wird geladen …</p>}
          {state.error && <p className="msg error" role="alert">{state.error}</p>}
          {state.type === 'image' && <img src={state.url} alt={file.name} />}
          {state.type === 'pdf' && (<><iframe title={file.name} src={state.url} /><p className="muted tiny">Auf dem iPhone zeigt die Vorschau oft nur die erste Seite. Lade die Datei herunter, um alles zu sehen.</p></>)}
          {state.type === 'text' && <pre className="plainpre">{state.text}</pre>}
          {state.type === 'table' && (
            <div className="table-wrap"><table><tbody>{state.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody></table></div>
          )}
          {state.type === 'zip' && <ul className="ziplist">{state.names.slice(0, 500).map((n) => <li key={n}>{n}</li>)}{state.names.length > 500 && <li>… und {state.names.length - 500} weitere</li>}</ul>}
          {state.type === 'html' && (<><iframe title={file.name} sandbox="" srcDoc={state.text} /><p className="muted tiny">Vorschau ohne Skripte. Interaktive Seiten funktionieren nach dem Herunterladen.</p></>)}
        </div>
        <div className="row">
          <button className="btn primary" onClick={download}>Herunterladen</button>
          {state.text && <CopyButton getText={() => state.text} className="btn" label="Text kopieren" />}
        </div>
      </div>
    </div>
  );
}
