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
    const [acc, led, prof] = await Promise.all([
      supabase.from('credit_accounts').select('balance_eur, reserved_eur').maybeSingle(),
      supabase
        .from('ledger_entries')
        .select('id, entry_type, amount_eur, note, created_at')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('profiles').select('display_name').maybeSingle(),
    ]);
    if (acc.error || led.error || prof.error) {
      setError('Kontodaten konnten nicht geladen werden. Bitte lade die Seite neu.');
    } else {
      setAccount(acc.data);
      setEntries(led.data || []);
      setProfile(prof.data);
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

  const available = account ? Number(account.balance_eur) - Number(account.reserved_eur) : 0;

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
          Stand: {formatEur(account?.balance_eur)}, davon reserviert: {formatEur(account?.reserved_eur)}.
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
