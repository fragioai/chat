const eur = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
export const formatEur = (v) => eur.format(Number(v ?? 0));
export const formatDate = (iso) =>
  new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

export const ENTRY_LABELS = {
  deposit: 'Einzahlung',
  reservation: 'Reservierung',
  charge: 'Abbuchung',
  release: 'Freigabe einer Reservierung',
  refund: 'Erstattung',
  correction: 'Korrektur',
  admin_adjustment: 'Administrative Buchung',
};
