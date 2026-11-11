import { Fragment, useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { ENTRY_LABELS, formatDate, formatEur } from '../lib/format.js';
import { filesCall, formatBytes } from '../lib/files.js';
import FilePreview from '../components/FilePreview.jsx';

const DELETE_ERRORS = {
  balance_forfeit_required: 'Du hast noch Guthaben. Bestätige unten, dass es mit der Löschung verfällt.',
  open_reservations: 'Es laufen noch Anfragen mit reserviertem Guthaben. Bitte warte kurz und versuche es erneut.',
  negative_balance: 'Dein Konto hat einen negativen Stand. Bitte kontaktiere den Betreiber.',
  confirmation_required: 'Bitte gib zur Bestätigung KONTO LÖSCHEN ein.',
};
const nf = (n) => Number(n ?? 0).toLocaleString('de-DE');
const usd = (n) => `$${Number(n ?? 0).toLocaleString('de-DE', { maximumFractionDigits: 4 })}`;

function csvEscape(v, text) {
  let s = v === null || v === undefined ? '' : String(v);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // Schutz vor Formeln in Tabellenprogrammen
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(name, cols, rows) {
  const head = cols.map((c) => c.label).join(',');
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c.key], c.text)).join(',')).join('\n');
  const blob = new Blob([`\ufeff${head}\n${body}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

function Line({ label, tokens, price, eur }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{tokens}</td>
      <td className="num">{price}</td>
      <td className="num">{eur}</td>
    </tr>
  );
}

function UsageDetail({ u }) {
  return (
    <div className="table-wrap detail">
      <table>
        <thead><tr><th>Kostenart</th><th className="num">Menge</th><th className="num">Preis je 1 Mio.</th><th className="num">Anbieter (EUR)</th></tr></thead>
        <tbody>
          <Line label="Eingabe" tokens={nf(u.input_tokens)} price={usd(u.in_usd)} eur={formatEur(u.input_eur)} />
          <Line label="Ausgabe (inkl. Denken)" tokens={nf(u.output_tokens)} price={usd(u.out_usd)} eur={formatEur(u.output_eur)} />
          {Number(u.cache_read_tokens) > 0 && <Line label="Cache lesen" tokens={nf(u.cache_read_tokens)} price={usd(u.cr_usd)} eur={formatEur(u.cache_read_eur)} />}
          {Number(u.cache_write_tokens) > 0 && <Line label="Cache schreiben" tokens={nf(u.cache_write_tokens)} price={usd(u.cw_usd)} eur={formatEur(u.cache_write_eur)} />}
          {Number(u.search_requests) > 0 && <Line label="Websuche" tokens={nf(u.search_requests)} price={`${usd(Number(u.search_usd) * 1000)} je 1.000`} eur={formatEur(u.search_eur)} />}
          <tr><td colSpan={3}>Summe Anbieterkosten (Kurs 1 USD = {Number(u.eur_per_usd).toFixed(4)} EUR)</td><td className="num">{formatEur(u.provider_cost_eur)}</td></tr>
          <tr><td colSpan={3}>Aufschlag</td><td className="num">{formatEur(u.markup_eur)}</td></tr>
          <tr><td colSpan={3}>Wechselkurs-Aufschlag</td><td className="num">{formatEur(u.fx_surcharge_eur)}</td></tr>
          <tr><td colSpan={3}><strong>Berechnet</strong></td><td className="num"><strong>{formatEur(u.charged_eur)}</strong></td></tr>
          <tr><td colSpan={3} className="muted">Vorab reserviert (Obergrenze)</td><td className="num muted">{formatEur(u.reserved_eur)}</td></tr>
        </tbody>
      </table>
      <p className="muted tiny">
        {u.usage_source === 'estimated'
          ? 'GESCHÄTZT: Der Anbieter lieferte keine vollständigen Nutzungsdaten (zum Beispiel bei Abbruch oder Zeitlimit). Die Schätzung ist eher hoch angesetzt.'
          : 'ENDGÜLTIG: abgerechnet mit den tatsächlichen Nutzungsdaten des Anbieters.'}
        {Number(u.shortfall_eur) > 0 ? ' Ein Teil der Kosten wurde dir nicht berechnet.' : ''}
      </p>
    </div>
  );
}

export default function AccountPage({ session }) {
  const [days, setDays] = useState(30);
  const [sum, setSum] = useState(null);
  const [usage, setUsage] = useState([]);
  const [usageMore, setUsageMore] = useState(false);
  const [open, setOpen] = useState(null);
  const [entries, setEntries] = useState([]);
  const [entryType, setEntryType] = useState('');
  const [entriesMore, setEntriesMore] = useState(false);
  const [models, setModels] = useState([]);
  const [profile, setProfile] = useState(null);
  const [nameInput, setNameInput] = useState('');
  const [retention, setRetention] = useState('');
  const [profileMsg, setProfileMsg] = useState(null);   // { ok } oder { err }
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwMsg, setPwMsg] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [fileQuota, setFileQuota] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [forfeit, setForfeit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const loadUsage = useCallback(async (reset = true, offset = 0) => {
    const { data, error: err } = await supabase.rpc('my_usage_list', { p_limit: 25, p_offset: offset });
    if (err) { setError('Die Nutzung konnte nicht geladen werden.'); return; }
    setUsage((prev) => (reset ? data : [...prev, ...data]));
    setUsageMore(data.length === 25);
  }, []);

  const loadEntries = useCallback(async (reset = true, offset = 0, type = entryType) => {
    let q = supabase.from('ledger_entries').select('id, entry_type, amount_eur, note, created_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49);
    if (type) q = q.eq('entry_type', type);
    const { data, error: err } = await q;
    if (err) { setError('Die Buchungen konnten nicht geladen werden.'); return; }
    setEntries((prev) => (reset ? data : [...prev, ...data]));
    setEntriesMore(data.length === 50);
  }, [entryType]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [prof, mods] = await Promise.all([
        supabase.from('profiles').select('display_name, retention_days').maybeSingle(),
        supabase.functions.invoke('models'),
      ]);
      setProfile(prof.data);
      setNameInput(prof.data?.display_name || '');
      setRetention(prof.data?.retention_days ? String(prof.data.retention_days) : '');
      setModels(mods.data?.models || []);
      await Promise.all([loadUsage(true, 0), loadEntries(true, 0, '')]);
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    supabase.rpc('my_usage_summary', { p_days: days }).then(({ data, error: err }) => {
      if (err) setError('Die Übersicht konnte nicht geladen werden. Bitte lade die Seite neu.');
      else setSum(data);
    });
  }, [days]);

  const loadFiles = useCallback(async () => {
    const { data } = await supabase.from('files').select('id, name, size_bytes, kind, created_at, mime').order('created_at', { ascending: false }).limit(200);
    setFiles(data || []);
    try { setFileQuota(await filesCall('quota')); } catch { /* Anzeige ist optional */ }
  }, []);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  async function saveName(e) {
    e.preventDefault();
    const n = nameInput.trim().slice(0, 60);
    if (!n) { setProfileMsg({ err: 'Bitte gib einen Namen ein.' }); return; }
    const { error: err } = await supabase.from('profiles').update({ display_name: n }).eq('id', session.user.id);
    if (err) setProfileMsg({ err: 'Der Name konnte nicht gespeichert werden.' });
    else { setProfileMsg({ ok: 'Gespeichert.' }); setProfile((p) => ({ ...p, display_name: n })); }
  }
  async function saveRetention(v) {
    setRetention(v);
    const { error: err } = await supabase.from('profiles').update({ retention_days: v ? Number(v) : null }).eq('id', session.user.id);
    setProfileMsg(err ? { err: 'Die Einstellung konnte nicht gespeichert werden.' } : { ok: 'Gespeichert.' });
  }
  async function savePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    if (pw1.length < 8) { setPwMsg({ err: 'Das Passwort muss mindestens 8 Zeichen haben.' }); return; }
    if (pw1 !== pw2) { setPwMsg({ err: 'Die beiden Passwörter sind nicht gleich.' }); return; }
    setPwBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw1 });
    setPwBusy(false);
    if (err) setPwMsg({ err: 'Das Passwort konnte nicht geändert werden. Melde dich ab, wieder an und versuche es erneut.' });
    else { setPwMsg({ ok: 'Passwort geändert.' }); setPw1(''); setPw2(''); }
  }
  async function removeFile(f) {
    if (!window.confirm(`Datei „${f.name}“ endgültig löschen?`)) return;
    try { await filesCall('delete', { file_id: f.id }); } catch (er) { setError(er.message); return; }
    loadFiles();
  }

  async function exportAll(kind) {
    setError('');
    if (kind === 'usage') {
      let all = [];
      for (let off = 0; off < 1000; off += 100) {
        const { data, error: err } = await supabase.rpc('my_usage_list', { p_limit: 100, p_offset: off });
        if (err) { setError('Der Export ist fehlgeschlagen.'); return; }
        all = all.concat(data);
        if (data.length < 100) break;
      }
      downloadCsv('fragio-nutzung.csv', [
        { key: 'created_at', label: 'Zeit' }, { key: 'model_id', label: 'Modell', text: true },
        { key: 'input_tokens', label: 'Eingabe-Tokens' }, { key: 'output_tokens', label: 'Ausgabe-Tokens' },
        { key: 'cache_read_tokens', label: 'Cache-lesen-Tokens' }, { key: 'cache_write_tokens', label: 'Cache-schreiben-Tokens' },
        { key: 'search_requests', label: 'Suchen' }, { key: 'provider_cost_eur', label: 'Anbieterkosten EUR' },
        { key: 'markup_eur', label: 'Aufschlag EUR' }, { key: 'fx_surcharge_eur', label: 'Wechselkurs-Aufschlag EUR' },
        { key: 'charged_eur', label: 'Berechnet EUR' }, { key: 'reserved_eur', label: 'Reserviert EUR' },
        { key: 'usage_source', label: 'Quelle (provider=endgültig, estimated=geschätzt)', text: true },
      ], all);
    } else {
      let all = [];
      for (let off = 0; off < 2000; off += 500) {
        const { data, error: err } = await supabase.from('ledger_entries').select('created_at, entry_type, amount_eur, note')
          .order('created_at', { ascending: true }).order('id', { ascending: true }).range(off, off + 499);
        if (err) { setError('Der Export ist fehlgeschlagen.'); return; }
        all = all.concat(data);
        if (data.length < 500) break;
      }
      downloadCsv('fragio-buchungen.csv', [
        { key: 'created_at', label: 'Zeit' }, { key: 'entry_type', label: 'Art', text: true },
        { key: 'amount_eur', label: 'Betrag EUR' }, { key: 'note', label: 'Notiz', text: true },
      ], all);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError('');
    const { data, error: err } = await supabase.functions.invoke('delete-account', {
      body: { confirm: confirmText.trim(), forfeit_balance: forfeit },
    });
    if (err) {
      let code = '';
      try { code = (await err.context.json()).error; } catch { /* ignore */ }
      setDeleteError(DELETE_ERRORS[code] || 'Das Konto konnte nicht gelöscht werden. Bitte versuche es später erneut.');
      setDeleting(false);
      return;
    }
    if (data && data.ok) await supabase.auth.signOut();
    setDeleting(false);
  }

  if (loading) return <p aria-busy="true">Wird geladen …</p>;
  const p = sum?.period;
  const balance = Number(sum?.balance_eur ?? 0);
  const hasPassword = (session.user.app_metadata?.providers || ['email']).includes('email');

  return (
    <div className="stack">
      {error && <p className="msg error" role="alert">{error}</p>}

      <section className="card">
        <h1>Dein Konto</h1>
        <dl className="kv">
          <dt>Name</dt><dd>{profile?.display_name || '–'}</dd>
          <dt>E-Mail</dt><dd>{session.user.email}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>Profil</h2>
        <form className="form" onSubmit={saveName}>
          <label>Anzeigename ändern
            <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} maxLength={60} />
          </label>
          <button className="btn" type="submit">Anzeigename speichern</button>
        </form>
        {profileMsg && <p className={`msg ${profileMsg.err ? 'error' : 'ok'}`} role="status">{profileMsg.err || profileMsg.ok}</p>}
      </section>

      {hasPassword && (
        <section className="card">
          <h2>Passwort ändern</h2>
          <form className="form" onSubmit={savePassword}>
            <label>Neues Passwort (mindestens 8 Zeichen)
              <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} autoComplete="new-password" minLength={8} />
            </label>
            <label>Neues Passwort wiederholen
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" minLength={8} />
            </label>
            <button className="btn" type="submit" disabled={pwBusy}>{pwBusy ? 'Bitte warten …' : 'Passwort ändern'}</button>
          </form>
          {pwMsg && <p className={`msg ${pwMsg.err ? 'error' : 'ok'}`} role="status">{pwMsg.err || pwMsg.ok}</p>}
        </section>
      )}

      <section className="card">
        <h2>Chats automatisch löschen nach …</h2>
        <label className="field"><span>Aufbewahrung</span>
          <select value={retention} onChange={(e) => saveRetention(e.target.value)}>
            <option value="">nie (Chats bleiben, bis ich sie lösche)</option>
            <option value="30">30 Tagen</option>
            <option value="90">90 Tagen</option>
            <option value="365">365 Tagen</option>
          </select>
        </label>
        <p className="muted tiny">Gerechnet ab der letzten Aktivität im Chat. Das Löschen läuft einmal täglich, ist endgültig und entfernt auch die Dateien des Chats. Abrechnungsdaten bleiben davon unberührt. Für einen einzelnen Chat ohne Speichern nutze im Verlauf „Chat ohne Speichern“.</p>
      </section>

      <section className="card">
        <h2>Meine Dateien</h2>
        {fileQuota && <p className="muted tiny">{formatBytes(fileQuota.used)} von {formatBytes(fileQuota.user_limit)} belegt. Höchstens {formatBytes(fileQuota.max_file)} pro Datei.</p>}
        {files.length === 0 ? <p className="muted">Keine Dateien.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Art</th><th className="num">Größe</th><th /></tr></thead>
            <tbody>{files.map((f) => (
              <tr key={f.id}>
                <td>{f.name}<span className="muted tiny"><br />{formatDate(f.created_at)}</span></td>
                <td>{f.kind === 'generated' ? 'Erzeugt' : 'Hochgeladen'}</td>
                <td className="num">{formatBytes(f.size_bytes)}</td>
                <td><div className="row"><button className="btn small" onClick={() => setPreviewFile(f)}>Vorschau</button><button className="btn small ghost" onClick={() => removeFile(f)}>Löschen</button></div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="card">
        <h2>Guthaben</h2>
        <p className="big">{formatEur(balance)}</p>
        <p className="muted">Verfügbar. Für laufende Anfragen reserviert (bereits abgezogen): {formatEur(sum?.reserved_eur)}. Aufladen ist noch nicht möglich.</p>
        <div className="stats">
          <div className="stat"><span className="muted">Einzahlungen gesamt</span><strong>{formatEur(sum?.deposits_total_eur)}</strong></div>
          <div className="stat"><span className="muted">Verbrauch gesamt</span><strong>{formatEur(sum?.charged_total_eur)}</strong></div>
          <div className="stat"><span className="muted">Erstattungen</span><strong>{formatEur(sum?.refunds_total_eur)}</strong></div>
          <div className="stat"><span className="muted">Korrekturen</span><strong>{formatEur(sum?.corrections_total_eur)}</strong></div>
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <h2>Verbrauch im Zeitraum</h2>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Zeitraum">
            <option value={7}>7 Tage</option><option value={30}>30 Tage</option><option value={90}>90 Tage</option>
            <option value={365}>1 Jahr</option><option value={3650}>Alles</option>
          </select>
        </div>
        {p && (
          <div className="stats">
            <div className="stat"><span className="muted">Anfragen</span><strong>{nf(p.requests)}</strong></div>
            <div className="stat"><span className="muted">Anbieterkosten</span><strong>{formatEur(p.provider_cost_eur)}</strong></div>
            <div className="stat"><span className="muted">Aufschläge</span><strong>{formatEur(p.surcharges_eur)}</strong><span className="muted tiny">Aufschlag {formatEur(p.markup_eur)}, Kurs {formatEur(p.fx_surcharge_eur)}</span></div>
            <div className="stat"><span className="muted">Berechnet</span><strong>{formatEur(p.charged_eur)}</strong></div>
            <div className="stat"><span className="muted">davon geschätzt</span><strong>{formatEur(p.estimated_eur)}</strong><span className="muted tiny">{nf(p.estimated_requests)} Anfragen</span></div>
          </div>
        )}
        <h3>Nach Modell</h3>
        {sum?.by_model?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Modell</th><th className="num">Anfragen</th><th className="num">Eingabe</th><th className="num">Ausgabe</th><th className="num">Suchen</th><th className="num">Berechnet</th></tr></thead>
            <tbody>{sum.by_model.map((m) => (
              <tr key={m.model_id}><td>{m.model_id}</td><td className="num">{nf(m.requests)}</td><td className="num">{nf(m.input_tokens)}</td><td className="num">{nf(m.output_tokens)}</td><td className="num">{nf(m.searches)}</td><td className="num">{formatEur(m.charged_eur)}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted">Noch keine Nutzung im Zeitraum.</p>}
      </section>

      <section className="card">
        <h2>Preise je Modell</h2>
        <p className="muted tiny">Je 1 Million Tokens, in Euro, inklusive Aufschlag und Wechselkurs-Aufschlag. Die Aufteilung nach Kostenart siehst du bei jeder Anfrage.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Modell</th><th className="num">Eingabe</th><th className="num">Ausgabe</th><th className="num">Suche je Anfrage</th></tr></thead>
          <tbody>{models.map((m) => (
            <tr key={m.id}><td>{m.display_name}</td>
              <td className="num">{m.price_eur_in == null ? '–' : formatEur(m.price_eur_in)}</td>
              <td className="num">{m.price_eur_out == null ? '–' : formatEur(m.price_eur_out)}</td>
              <td className="num">{m.search_eur_per_request == null ? '–' : formatEur(m.search_eur_per_request)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="card">
        <h2>Anfragen</h2>
        <p className="muted tiny">Antippen zeigt die Aufschlüsselung. „Geschätzt“ bedeutet: Der Anbieter lieferte keine vollständigen Nutzungsdaten, die Schätzung ist eher hoch.</p>
        {usage.length === 0 ? <p className="muted">Noch keine Anfragen.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Zeit</th><th>Modell</th><th className="num">Berechnet</th></tr></thead>
            <tbody>{usage.map((u) => (
              <Fragment key={u.id}>
                <tr className="clickable" onClick={() => setOpen(open === u.id ? null : u.id)}>
                  <td>{formatDate(u.created_at)}</td><td>{u.model_id}</td>
                  <td className="num">{formatEur(u.charged_eur)}{u.usage_source === 'estimated' ? ' (geschätzt)' : ''}</td>
                </tr>
                {open === u.id && <tr><td colSpan={3}><UsageDetail u={u} /></td></tr>}
              </Fragment>
            ))}</tbody>
          </table></div>
        )}
        {usageMore && <button className="btn" onClick={() => loadUsage(false, usage.length)}>Mehr laden</button>}
      </section>

      <section className="card">
        <h2>Buchungen</h2>
        <label className="field"><span>Art</span>
          <select value={entryType} onChange={(e) => { setEntryType(e.target.value); loadEntries(true, 0, e.target.value); }}>
            <option value="">alle</option>
            {Object.entries(ENTRY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {entries.length === 0 ? <p className="muted">Keine Buchungen.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Zeitpunkt</th><th>Art</th><th className="num">Betrag</th></tr></thead>
            <tbody>{entries.map((e) => (
              <tr key={e.id}><td>{formatDate(e.created_at)}</td><td>{ENTRY_LABELS[e.entry_type] || e.entry_type}{e.note ? <span className="muted tiny"><br />{e.note}</span> : null}</td><td className="num">{formatEur(e.amount_eur)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        {entriesMore && <button className="btn" onClick={() => loadEntries(false, entries.length)}>Mehr laden</button>}
        <p className="muted tiny">Reservierungen und Freigaben stehen hier ebenfalls. Eine Reservierung ist ein vorläufiger Abzug, der nach der Antwort durch die endgültige Abbuchung ersetzt wird.</p>
      </section>

      <section className="card">
        <h2>Daten herunterladen</h2>
        <div className="row">
          <button className="btn" onClick={() => exportAll('usage')}>Nutzung (CSV)</button>
          <button className="btn" onClick={() => exportAll('ledger')}>Buchungen (CSV)</button>
        </div>
      </section>

      <section className="card danger">
        <h2>Konto löschen</h2>
        <p>
          Beim Löschen werden dein Konto, dein Profil, deine Chats und deine Dateien entfernt. Verbliebenes
          Guthaben verfällt. Abrechnungs- und Zahlungsdaten müssen unter Umständen länger aufbewahrt
          werden; sie werden dann von deiner Person getrennt (anonymisiert) gespeichert.
          Das lässt sich nicht rückgängig machen.
        </p>
        <label>
          Zur Bestätigung <strong>KONTO LÖSCHEN</strong> eingeben
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </label>
        {balance > 0 && (
          <label className="check">
            <input type="checkbox" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)} />
            Mein restliches Guthaben ({formatEur(balance)}) verfällt.
          </label>
        )}
        {deleteError && <p className="msg error" role="alert">{deleteError}</p>}
        <button className="btn danger-btn" disabled={deleting || confirmText.trim() !== 'KONTO LÖSCHEN'} onClick={deleteAccount}>
          {deleting ? 'Wird gelöscht …' : 'Konto endgültig löschen'}
        </button>
      </section>
      {previewFile && <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />}
    </div>
  );
}
