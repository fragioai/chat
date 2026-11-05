export default function DataTable({ cols, rows, onRow, empty = 'Keine Einträge.' }) {
  if (!rows || rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? r.request_id ?? i} className={onRow ? 'clickable' : ''} onClick={onRow ? () => onRow(r) : undefined}>
              {cols.map((c) => (
                <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : String(r[c.key] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
