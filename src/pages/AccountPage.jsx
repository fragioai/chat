import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { ENTRY_LABELS, formatDate, formatEur } from '../lib/format.js';

const DELETE_ERRORS = {
  balance_forfeit_required: 'Du hast noch Guthaben. Bestätige unten, dass es mit der Löschung verfällt.',
  open_reservations: 'Es laufen noch Anfragen mit reserviertem Guthaben. Bitte warte kurz und versuche es erneut.',
  negative_balance: 'Dein Konto hat einen negativen Stand. Bitte kontaktiere den Betreiber.',
  confirmation_required: 'Bitte gib zur Bestätigung KONTO LÖSCHEN ein.',
};

export default function AccountPage({ session }) {
  const [account, setAccount] = useState(null);
  const [entries, setEntries] = useState([]);
  const [usage, setUsage] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [forfeit, setForfeit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [acc, led, prof, use] = await Promise.all([
      supabase.from('credit_accounts').select('balance_eur, reserved_eur').maybeSingle(),
      supabase
        .from('ledger_entries')
        .select('id, entry_type, amount_eur, note, created_at')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('profiles').select('display_name').maybeSingle(),
      supabase
        .from('usage_events')
        .select('id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, search_requests, provider_cost_eur, fx_surcharge_eur, markup_eur, charged_eur, usage_source, outcome, created_at')
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    if (acc.error || led.error || prof.error || use.error) {
      setError('Kontodaten konnten nicht geladen werden. Bitte lade die Seite neu.');
    } else {
      setAccount(acc.data);
      setEntries(led.data || []);
      setProfile(prof.data);
      setUsage(use.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError('');
    const { data, error: err } = await supabase.functions.invoke('delete-account', {
      body: { confirm: confirmText.trim(), forfeit_balance: forfeit },
    });
    if (err) {
      let code = '';
      try {
        const body = await err.context.json();
        code = body.error;
      } catch {
        /* ignore */
      }
      setDeleteError(DELETE_ERRORS[code] || 'Das Konto konnte nicht gelöscht werden. Bitte versuche es später erneut.');
      setDeleting(false);
      return;
    }
    if (data && data.ok) await supabase.auth.signOut();
    setDeleting(false);
  }

  if (loading) return <p aria-busy="true">Wird geladen …</p>;

  const available = account ? Number(account.balance_eur) : 0;

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
        <h2>Guthaben</h2>
        <p className="big">{formatEur(available)}</p>
        <p className="muted">
          Verfügbar. Aktuell für laufende Anfragen reserviert: {formatEur(account?.reserved_eur)} (bereits abgezogen).
          Aufladen ist noch nicht möglich (kommt mit Phase 7).
        </p>
      </section>

      <section className="card">
        <h2>Buchungen</h2>
        {entries.length === 0 ? (
          <p className="muted">Noch keine Buchungen.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Zeitpunkt</th><th>Art</th><th className="num">Betrag</th></tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.created_at)}</td>
                    <td>{ENTRY_LABELS[e.entry_type] || e.entry_type}</td>
                    <td className="num">{formatEur(e.amount_eur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Nutzung</h2>
        {usage.length === 0 ? (
          <p className="muted">Noch keine Anfragen.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Zeitpunkt</th><th>Modell</th><th className="num">Eingabe</th><th className="num">Ausgabe</th>
                  <th className="num">Anbieter</th><th className="num">Aufschläge</th><th className="num">Berechnet</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.id}>
                    <td>{formatDate(u.created_at)}</td>
                    <td>{u.model_id}</td>
                    <td className="num">{u.input_tokens}</td>
                    <td className="num">{u.output_tokens}</td>
                    <td className="num">{formatEur(u.provider_cost_eur)}</td>
                    <td className="num">{formatEur(Number(u.fx_surcharge_eur) + Number(u.markup_eur))}</td>
                    <td className="num">
                      {formatEur(u.charged_eur)}
                      {u.usage_source === 'estimated' ? ' (geschätzt)' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          „Anbieter“ sind die Kosten des KI-Anbieters, umgerechnet in Euro. „Aufschläge“ sind der vereinbarte Aufschlag
          und der Wechselkurs-Aufschlag. Geschätzte Beträge entstehen bei Abbruch oder fehlenden Nutzungsdaten.
        </p>
      </section>

      <section className="card danger">
        <h2>Konto löschen</h2>
        <p>
          Beim Löschen werden dein Konto, dein Profil und deine Chat-Inhalte entfernt. Verbliebenes
          Guthaben verfällt. Abrechnungs- und Zahlungsdaten müssen unter Umständen länger aufbewahrt
          werden; sie werden dann von deiner Person getrennt (anonymisiert) gespeichert.
          Das lässt sich nicht rückgängig machen.
        </p>
        <label>
          Zur Bestätigung <strong>KONTO LÖSCHEN</strong> eingeben
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </label>
        {Number(account?.balance_eur) > 0 && (
          <label className="check">
            <input type="checkbox" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)} />
            Mein restliches Guthaben ({formatEur(account.balance_eur)}) verfällt.
          </label>
        )}
        {deleteError && <p className="msg error" role="alert">{deleteError}</p>}
        <button
          className="btn danger-btn"
          disabled={deleting || confirmText.trim() !== 'KONTO LÖSCHEN'}
          onClick={deleteAccount}
        >
          {deleting ? 'Wird gelöscht …' : 'Konto endgültig löschen'}
        </button>
      </section>
    </div>
  );
}
