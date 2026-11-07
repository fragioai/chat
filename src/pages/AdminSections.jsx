import { useCallback, useEffect, useState } from 'react';
import { adminCall, num } from '../lib/admin.js';
import { formatDate, formatEur } from '../lib/format.js';
import DataTable from '../components/DataTable.jsx';
import SensitiveForm from '../components/SensitiveForm.jsx';

// Kleiner Lade-Helfer: lädt Daten per Admin-Aktion und liefert { data, error, reload }.
function useAdmin(action, params, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setData(await adminCall(action, params)); } catch (e) { setError(e.message); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

const Status = ({ error, loading }) => (
  <>
    {loading && <p aria-busy="true" className="muted">Wird geladen …</p>}
    {error && <p className="msg error" role="alert">{error}</p>}
  </>
);
const Stat = ({ label, value, warn, sub }) => (
  <div className={`stat ${warn ? 'warn' : ''}`}><span className="muted">{label}</span><strong>{value}</strong>{sub && <span className="muted tiny">{sub}</span>}</div>
);
// iPhone-Zahlenblock liefert Komma statt Punkt und kein Minuszeichen: hier vereinheitlichen.
const dec = (v) => String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
const tag = (s) => <span className={`tag ${s}`}>{s}</span>;

// ------------------------------------------------------------------ Übersicht
export function Overview() {
  const [days, setDays] = useState(30);
  const { data: d, error, loading } = useAdmin('overview', { days }, [days]);
  return (
    <div className="stack">
      <label className="field"><span>Zeitraum</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 Tage</option><option value={30}>30 Tage</option><option value={90}>90 Tage</option><option value={365}>365 Tage</option>
        </select>
      </label>
      <Status error={error} loading={loading} />
      {d && (
        <>
          <section className="card">
            <h2>Nutzer und Guthaben</h2>
            <div className="stats">
              <Stat label="Nutzer gesamt" value={num(d.users.total)} sub={`${num(d.users.new_7d)} neu in 7 Tagen`} />
              <Stat label="Aktiv / gesperrt" value={`${num(d.users.active)} / ${num(d.users.blocked)}`} warn={d.users.blocked > 0} />
              <Stat label="Guthaben der Nutzer" value={formatEur(d.credit.sum_balance)} sub="verfügbar, Verbindlichkeit" />
              <Stat label="Reserviert" value={formatEur(d.credit.sum_reserved)} />
            </div>
          </section>
          <section className="card">
            <h2>Kosten und Aufschläge ({d.days} Tage)</h2>
            <div className="stats">
              <Stat label="Anfragen" value={num(d.totals.requests)} sub={`${num(d.totals.estimated)} geschätzt abgerechnet`} />
              <Stat label="API-Grundkosten (EUR)" value={formatEur(d.totals.provider_cost_eur)} />
              <Stat label="Aufschläge" value={formatEur(Number(d.totals.fx_surcharge_eur) + Number(d.totals.markup_eur))} sub={`Aufschlag ${formatEur(d.totals.markup_eur)}, Kurs ${formatEur(d.totals.fx_surcharge_eur)}`} />
              <Stat label="Abgebucht gesamt" value={formatEur(d.totals.charged_eur)} />
              <Stat label="Nicht belastet (zu deinen Lasten)" value={formatEur(d.totals.shortfall_eur)} warn={Number(d.totals.shortfall_eur) > 0} />
            </div>
            <p className="muted tiny">Aufschläge sind Brutto-Beträge vor Zahlungsgebühren und Steuern. Zahlungsgebühren kommen mit Phase 7 dazu.</p>
          </section>
          <section className="card">
            <h2>Nutzung nach Modell</h2>
            <DataTable
              cols={[
                { key: 'model_id', label: 'Modell' }, { key: 'requests', label: 'Anfragen', num: true, render: (r) => num(r.requests) },
                { key: 'input_tokens', label: 'Eingabe', num: true, render: (r) => num(r.input_tokens) },
                { key: 'output_tokens', label: 'Ausgabe', num: true, render: (r) => num(r.output_tokens) },
                { key: 'searches', label: 'Suchen', num: true, render: (r) => num(r.searches) },
                { key: 'provider_cost_eur', label: 'Grundkosten', num: true, render: (r) => formatEur(r.provider_cost_eur) },
                { key: 'surcharges_eur', label: 'Aufschläge', num: true, render: (r) => formatEur(r.surcharges_eur) },
                { key: 'charged_eur', label: 'Abgebucht', num: true, render: (r) => formatEur(r.charged_eur) },
              ]}
              rows={d.by_model} empty="Noch keine Nutzung im Zeitraum."
            />
          </section>
          <section className="card">
            <h2>Zustand</h2>
            <div className="stats">
              <Stat label="Offene Reservierungen" value={num(d.operations.open_reservations)} />
              <Stat label="Verfallen (24 h)" value={num(d.operations.expired_24h)} warn={d.operations.expired_24h > 0} />
              <Stat label="API-Fehler (24 h)" value={num(d.operations.api_errors_24h)} warn={d.operations.api_errors_24h > 0} />
              <Stat label="Sicherheitsereignisse (24 h)" value={num(d.operations.security_events_24h)} warn={d.operations.security_events_24h > 0} />
              <Stat label="Buchungs-Abweichungen" value={num(d.operations.ledger_inconsistencies)} warn={d.operations.ledger_inconsistencies > 0} sub="muss 0 sein" />
            </div>
            <p>Wechselkurs: {d.fx ? `1 USD = ${Number(d.fx.eur_per_usd).toFixed(4)} EUR (${d.fx.source}, ${formatDate(d.fx.fetched_at)})` : <strong>kein Kurs vorhanden</strong>}</p>
            <p>Letzte Preisprüfung: {d.last_price_update ? <>{formatDate(d.last_price_update.run_at)} {tag(d.last_price_update.status)}</> : 'noch keine'}</p>
          </section>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Nutzer
function UserDetail({ id, onClose, onChanged }) {
  const { data: u, error, loading, reload } = useAdmin('user_detail', { user_id: id }, [id]);
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState('plus');
  const act = async (action, params) => { await adminCall(action, { user_id: id, ...params }); await reload(); onChanged(); };
  return (
    <section className="card">
      <div className="row between"><h2>Nutzerdetails</h2><button className="btn small" onClick={onClose}>Schließen</button></div>
      <Status error={error} loading={loading} />
      {u && (
        <div className="stack">
          <dl className="kv">
            <dt>E-Mail</dt><dd>{u.email} {u.email_confirmed_at ? '' : '(nicht bestätigt)'}</dd>
            <dt>Name</dt><dd>{u.display_name}</dd>
            <dt>Status</dt><dd>{tag(u.status)}</dd>
            <dt>Registriert</dt><dd>{formatDate(u.created_at)}</dd>
            <dt>Letzte Anmeldung</dt><dd>{u.last_sign_in_at ? formatDate(u.last_sign_in_at) : '–'}</dd>
            <dt>Guthaben</dt><dd>{formatEur(u.balance_eur)} (reserviert {formatEur(u.reserved_eur)})</dd>
            <dt>Chats / Nachrichten</dt><dd>{num(u.chats)} / {num(u.messages)}</dd>
          </dl>
          <SensitiveForm title={u.status === 'blocked' ? 'Nutzer entsperren' : 'Nutzer sperren'} danger={u.status !== 'blocked'}
            submitLabel={u.status === 'blocked' ? 'Entsperren' : 'Sperren'}
            onSubmit={(f) => act('set_user_status', { status: u.status === 'blocked' ? 'active' : 'blocked', ...f })} />
          <SensitiveForm title="Guthaben korrigieren" submitLabel="Buchung ausführen"
            onSubmit={(f) => {
              const a = dec(amount);
              if (!/^\d+(\.\d{1,8})?$/.test(a) || Number(a) === 0) throw new Error('Bitte einen Betrag größer 0 eingeben, zum Beispiel 5 oder 2,50.');
              return act('adjust_credit', { amount: direction === 'minus' ? `-${a}` : a, ...f }).then(() => setAmount(''));
            }}>
            <label>Art der Buchung
              <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="plus">Gutschreiben (+)</option>
                <option value="minus">Abziehen (−)</option>
              </select>
            </label>
            <label>Betrag in Euro (ohne Vorzeichen)
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="z. B. 5 oder 2,50" />
            </label>
          </SensitiveForm>
          <h3>Letzte Buchungen</h3>
          <DataTable cols={[
            { key: 'created_at', label: 'Zeit', render: (r) => formatDate(r.created_at) }, { key: 'entry_type', label: 'Art' },
            { key: 'amount_eur', label: 'Betrag', num: true, render: (r) => formatEur(r.amount_eur) }, { key: 'note', label: 'Notiz' },
          ]} rows={u.ledger} />
          <h3>Letzte Nutzung</h3>
          <DataTable cols={[
            { key: 'created_at', label: 'Zeit', render: (r) => formatDate(r.created_at) }, { key: 'model_id', label: 'Modell' },
            { key: 'input_tokens', label: 'Ein', num: true, render: (r) => num(r.input_tokens) }, { key: 'output_tokens', label: 'Aus', num: true, render: (r) => num(r.output_tokens) },
            { key: 'charged_eur', label: 'Abgebucht', num: true, render: (r) => formatEur(r.charged_eur) }, { key: 'usage_source', label: 'Quelle' },
          ]} rows={u.usage} />
          <h3>Fehler und Sicherheitsereignisse</h3>
          <DataTable cols={[{ key: 'created_at', label: 'Zeit', render: (r) => formatDate(r.created_at) }, { key: 'code', label: 'Fehler' }]} rows={u.errors} empty="Keine API-Fehler." />
          <DataTable cols={[{ key: 'created_at', label: 'Zeit', render: (r) => formatDate(r.created_at) }, { key: 'event_type', label: 'Ereignis' }]} rows={u.security} empty="Keine Sicherheitsereignisse." />
        </div>
      )}
    </section>
  );
}

export function Users() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const { data, error, loading, reload } = useAdmin('users_list', { q: query, offset }, [query, offset]);
  return (
    <div className="stack">
      <form className="row" onSubmit={(e) => { e.preventDefault(); setOffset(0); setQuery(q); }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="E-Mail oder Name suchen" aria-label="Nutzer suchen" />
        <button className="btn">Suchen</button>
      </form>
      <Status error={error} loading={loading} />
      {selected && <UserDetail id={selected} onClose={() => setSelected(null)} onChanged={reload} />}
      {data && (
        <>
          <DataTable onRow={(r) => setSelected(r.id)} cols={[
            { key: 'email', label: 'E-Mail' }, { key: 'display_name', label: 'Name' }, { key: 'status', label: 'Status', render: (r) => tag(r.status) },
            { key: 'balance_eur', label: 'Guthaben', num: true, render: (r) => formatEur(r.balance_eur) },
            { key: 'spent_30d', label: 'Verbrauch 30 T.', num: true, render: (r) => formatEur(r.spent_30d) },
            { key: 'created_at', label: 'Registriert', render: (r) => formatDate(r.created_at) },
            { key: 'last_sign_in_at', label: 'Zuletzt', render: (r) => (r.last_sign_in_at ? formatDate(r.last_sign_in_at) : '–') },
          ]} rows={data.rows} empty="Keine Nutzer gefunden." />
          <div className="row">
            <button className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Zurück</button>
            <button className="btn small" disabled={data.rows.length < 25} onClick={() => setOffset(offset + 25)}>Weiter</button>
          </div>
        </>
      )}
      <p className="muted tiny">Nutzer per E-Mail benachrichtigen kommt mit Phase 7 (E-Mail-Versand).</p>
    </div>
  );
}

// ------------------------------------------------------------------ Modelle und Preise
export function ModelsPrices() {
  const models = useAdmin('models_list', {}, []);
  const prices = useAdmin('prices_list', {}, []);
  const [pick, setPick] = useState('');
  const [f, setF] = useState({ model_id: '', input: '', output: '', cache_read: '', cache_write: '', search: '' });
  const reloadAll = () => { models.reload(); prices.reload(); };
  const run = async (action, params) => { await adminCall(action, params); reloadAll(); };
  const m = (models.data?.rows || []).find((x) => x.id === pick);
  const usd = (v) => (v == null ? '–' : `$${Number(v)}`);
  return (
    <div className="stack">
      <section className="card">
        <h2>Modelle</h2>
        <Status error={models.error} loading={models.loading} />
        <DataTable onRow={(r) => setPick(r.id)} cols={[
          { key: 'display_name', label: 'Modell' }, { key: 'provider', label: 'Anbieter' }, { key: 'status', label: 'Status', render: (r) => tag(r.status) },
          { key: 'price_error', label: 'Preis', render: (r) => (r.price_error ? <span className="tag blocked">{r.price_error}</span> : <span className="tag active">gültig</span>) },
          { key: 'in', label: 'Ein/Aus $/Mio', render: (r) => (r.current_price ? `${usd(r.current_price.input_usd_per_mtok)} / ${usd(r.current_price.output_usd_per_mtok)}` : '–') },
          { key: 'verified', label: 'Bestätigt', render: (r) => (r.current_price ? formatDate(r.current_price.verified_at) : '–') },
        ]} rows={models.data?.rows} />
        {m && (
          <SensitiveForm title={`${m.display_name}: ${m.status === 'enabled' ? 'ausschalten' : 'einschalten'}`}
            submitLabel={m.status === 'enabled' ? 'Ausschalten' : 'Einschalten'}
            onSubmit={(x) => run('set_model_status', { model_id: m.id, status: m.status === 'enabled' ? 'disabled' : 'enabled', ...x })} />
        )}
        <p className="muted tiny">Antippen einer Zeile wählt das Modell. Ohne gültigen Preis startet keine Anfrage.</p>
      </section>

      <section className="card">
        <h2>Preisversionen</h2>
        <Status error={prices.error} loading={prices.loading} />
        <DataTable cols={[
          { key: 'model_id', label: 'Modell' }, { key: 'status', label: 'Status', render: (r) => tag(r.status) },
          { key: 'input_usd_per_mtok', label: 'Ein $', num: true }, { key: 'output_usd_per_mtok', label: 'Aus $', num: true },
          { key: 'valid_from', label: 'Gültig ab', render: (r) => formatDate(r.valid_from) },
          { key: 'valid_until', label: 'bis', render: (r) => (r.valid_until ? formatDate(r.valid_until) : 'offen') },
          { key: 'note', label: 'Notiz' },
          { key: 'act', label: '', render: (r) => (r.status === 'pending' ? (
            <button className="btn small" onClick={(e) => { e.stopPropagation(); setPick(`approve:${r.id}`); }}>Freigeben</button>) : null) },
        ]} rows={prices.data?.prices} />
        {pick.startsWith('approve:') && (
          <SensitiveForm title={`Preis ${pick.slice(8)} freigeben`} submitLabel="Preis aktivieren"
            onSubmit={(x) => run('approve_price', { price_id: Number(pick.slice(8)), ...x })} />
        )}
        <SensitiveForm title="Alle aktiven Preise als geprüft bestätigen" submitLabel="Bestätigen"
          onSubmit={(x) => run('confirm_prices', x)} />
        <SensitiveForm title="Neue Preisversion eintragen (ab sofort gültig)" submitLabel="Preis speichern"
          onSubmit={(x) => run('add_price', { model_id: f.model_id, input: dec(f.input), output: dec(f.output), cache_read: dec(f.cache_read), cache_write: dec(f.cache_write), search: dec(f.search), ...x })}>
          <label>Modell-ID
            <select value={f.model_id} onChange={(e) => setF({ ...f, model_id: e.target.value })}>
              <option value="">bitte wählen</option>
              {(models.data?.rows || []).map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
            </select>
          </label>
          {[['input', 'Eingabe $ je Mio. Tokens'], ['output', 'Ausgabe $ je Mio. Tokens'], ['cache_read', 'Cache lesen $ (optional)'], ['cache_write', 'Cache schreiben $ (optional)'], ['search', 'Suche $ je Anfrage (optional)']].map(([k, l]) => (
            <label key={k}>{l}<input value={f[k]} inputMode="decimal" onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
          ))}
        </SensitiveForm>
        <h3>Protokoll der automatischen Preisprüfung</h3>
        <DataTable cols={[
          { key: 'run_at', label: 'Zeit', render: (r) => formatDate(r.run_at) }, { key: 'status', label: 'Ergebnis', render: (r) => tag(r.status) },
          { key: 'details', label: 'Details', render: (r) => JSON.stringify(r.details).slice(0, 200) },
        ]} rows={prices.data?.log} empty="Noch keine Prüfung gelaufen." />
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Betrieb
export function Operations() {
  const [status, setStatus] = useState('');
  const res = useAdmin('reservations_list', { status }, [status]);
  const errs = useAdmin('errors_list', {}, []);
  const sec = useAdmin('security_list', {}, []);
  const led = useAdmin('ledger_check', {}, []);
  const [rel, setRel] = useState('');
  return (
    <div className="stack">
      <section className="card">
        <h2>Reservierungen</h2>
        <label className="field"><span>Filter</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">alle</option><option value="reserved">offen</option><option value="expired">verfallen</option>
            <option value="released">freigegeben</option><option value="settled">abgerechnet</option>
          </select>
        </label>
        <Status error={res.error} loading={res.loading} />
        <DataTable cols={[
          { key: 'created_at', label: 'Zeit', render: (r) => formatDate(r.created_at) }, { key: 'model_id', label: 'Modell' },
          { key: 'status', label: 'Status', render: (r) => tag(r.status) },
          { key: 'reserved_eur', label: 'Reserviert', num: true, render: (r) => formatEur(r.reserved_eur) },
          { key: 'final_eur', label: 'Abgebucht', num: true, render: (r) => (r.final_eur == null ? '–' : formatEur(r.final_eur)) },
          { key: 'act', label: '', render: (r) => (r.status === 'reserved' ? <button className="btn small" onClick={() => setRel(r.request_id)}>Freigeben</button> : null) },
        ]} rows={res.data?.rows} />
        {rel && <SensitiveForm title="Reservierung freigeben (ohne Kosten)" submitLabel="Freigeben"
          onSubmit={async (x) => { await adminCall('release_reservation', { request_id: rel, ...x }); setRel(''); res.reload(); }} />}
      </section>
      <section className="card">
        <h2>Fehlgeschlagene API-Anfragen</h2>
        <Status error={errs.error} loading={errs.loading} />
        <DataTable cols={[
          { key: 'created_at', label: 'Zeit', render: (r) => formatDate(r.created_at) }, { key: 'model_id', label: 'Modell' },
          { key: 'code', label: 'Fehler' }, { key: 'http_status', label: 'HTTP' }, { key: 'detail', label: 'Detail', render: (r) => String(r.detail || '').slice(0, 120) },
        ]} rows={errs.data?.rows} empty="Keine Fehler." />
      </section>
      <section className="card">
        <h2>Sicherheitsereignisse und Missbrauch</h2>
        <Status error={sec.error} loading={sec.loading} />
        <h3>Meiste Anfragen (letzte Stunde)</h3>
        <DataTable cols={[{ key: 'email', label: 'Nutzer' }, { key: 'hits_1h', label: 'Anfragen', num: true }]} rows={sec.data?.rate_top} empty="Keine Aktivität." />
        <h3>Ereignisse</h3>
        <DataTable cols={[
          { key: 'created_at', label: 'Zeit', render: (r) => formatDate(r.created_at) }, { key: 'event_type', label: 'Ereignis' },
          { key: 'user_id', label: 'Nutzer-ID', render: (r) => String(r.user_id || '–').slice(0, 8) },
        ]} rows={sec.data?.rows} empty="Keine Ereignisse." />
      </section>
      <section className="card">
        <h2>Buchungsprüfung</h2>
        <p className="muted">Der Kontostand jedes Nutzers muss der Summe seiner Buchungen entsprechen. Diese Liste muss leer sein.</p>
        <Status error={led.error} loading={led.loading} />
        <DataTable cols={[{ key: 'user_id', label: 'Nutzer-ID' }, { key: 'balance_eur', label: 'Kontostand' }, { key: 'ledger_sum', label: 'Summe Buchungen' }, { key: 'difference', label: 'Differenz' }]}
          rows={led.data?.rows} empty="Alles in Ordnung: keine Abweichungen." />
        <button className="btn small" onClick={led.reload}>Erneut prüfen</button>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Einstellungen, Protokoll, Export
const SETTING_LABELS = {
  markup_percent: 'Aufschlag auf Anbieterkosten (%)', fx_markup_percent: 'Wechselkurs-Aufschlag (%)',
  price_max_age_days: 'Preise gelten höchstens so viele Tage ohne Bestätigung', fx_max_age_hours: 'Wechselkurs höchstens so viele Stunden alt',
  max_concurrent_requests: 'Gleichzeitige Anfragen pro Nutzer', rate_limit_per_minute: 'Anfragen pro Minute und Nutzer',
  reservation_ttl_minutes: 'Offene Reservierungen verfallen nach (Minuten)',
  max_file_bytes: 'Größte erlaubte Datei (Bytes, höchstens 6291456)', max_user_bytes: 'Speicher pro Nutzer (Bytes)',
  max_total_bytes: 'Gesamtspeicher aller Nutzer (Bytes)', max_files_per_message: 'Dateien pro Nachricht',
  provider_file_ttl_days: 'Kopien beim KI-Anbieter löschen nach (Tagen)',
};
export function Settings() {
  const { data, error, loading, reload } = useAdmin('settings_list', {}, []);
  const [key, setKey] = useState('markup_percent');
  const [value, setValue] = useState('');
  return (
    <div className="stack">
      <section className="card">
        <h2>Einstellungen</h2>
        <Status error={error} loading={loading} />
        <DataTable cols={[{ key: 'key', label: 'Einstellung', render: (r) => SETTING_LABELS[r.key] || r.key }, { key: 'value', label: 'Wert' }, { key: 'updated_at', label: 'Geändert', render: (r) => formatDate(r.updated_at) }]}
          rows={data?.rows} onRow={(r) => { if (SETTING_LABELS[r.key]) { setKey(r.key); setValue(r.value); } }} />
        <p className="muted tiny">Der vereinbarte Aufschlag von 10 % darf nur nach Absprache geändert werden. Jede Änderung wird protokolliert.</p>
      </section>
      <SensitiveForm title="Einstellung ändern" submitLabel="Speichern" onSubmit={async (x) => { await adminCall('update_setting', { key, value: dec(value), ...x }); reload(); }}>
        <label>Einstellung
          <select value={key} onChange={(e) => setKey(e.target.value)}>
            {Object.entries(SETTING_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>Neuer Wert<input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" /></label>
      </SensitiveForm>
    </div>
  );
}

export function Audit() {
  const { data, error, loading } = useAdmin('audit_list', {}, []);
  return (
    <section className="card">
      <h2>Admin-Protokoll</h2>
      <Status error={error} loading={loading} />
      <DataTable cols={[
        { key: 'created_at', label: 'Zeit', render: (r) => formatDate(r.created_at) }, { key: 'action', label: 'Aktion' },
        { key: 'target_user', label: 'Ziel', render: (r) => String(r.target_user || '–').slice(0, 8) },
        { key: 'details', label: 'Details', render: (r) => JSON.stringify(r.details).slice(0, 220) },
      ]} rows={data?.rows} empty="Noch keine Einträge." />
    </section>
  );
}

export function ExportTab() {
  const [kind, setKind] = useState('usage');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  async function run() {
    setMsg(''); setErr('');
    try {
      const d = await adminCall('export', { kind, from: from || undefined, to: to || undefined });
      if (!d.csv) { setMsg('Keine Daten im Zeitraum.'); return; }
      const blob = new Blob(['\ufeff' + d.csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fragio-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setMsg(`${d.rows} Zeilen exportiert.`);
    } catch (e) { setErr(e.message); }
  }
  return (
    <section className="card form">
      <h2>Export als CSV</h2>
      <label>Daten
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="usage">Nutzung und Abrechnung</option><option value="ledger">Buchungen (Ledger)</option>
          <option value="users">Nutzerliste</option><option value="audit">Admin-Protokoll</option>
        </select>
      </label>
      <label>Von (optional)<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>Bis (optional)<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      {err && <p className="msg error" role="alert">{err}</p>}
      {msg && <p className="msg ok" role="status">{msg}</p>}
      <button className="btn primary" onClick={run}>CSV herunterladen</button>
      <p className="muted tiny">Enthält personenbezogene Daten (E-Mail). Gehe sorgfältig damit um. Jeder Export wird protokolliert. Standard: letzte 30 Tage.</p>
    </section>
  );
}

export function PaymentsInfo() {
  return (
    <section className="card">
      <h2>Zahlungen und Integrationen</h2>
      <p>Diese Bereiche brauchen die Zahlungs-, E-Mail- und Google-Sheets-Anbindung aus <strong>Phase 7</strong>. Die Datenbanktabellen dafür existieren noch nicht. Sie erscheinen hier, sobald Phase 7 eingerichtet ist:</p>
      <ul>
        <li>Bestätigte Zahlungen, offene und fehlgeschlagene Verarbeitungen</li>
        <li>Rückerstattungen und Chargebacks</li>
        <li>Webhook-Status</li>
        <li>Automatische Aufladungen</li>
        <li>E-Mail-Benachrichtigungen (und Nutzer per E-Mail anschreiben)</li>
        <li>Google-Sheets-Synchronisierung</li>
      </ul>
    </section>
  );
}
