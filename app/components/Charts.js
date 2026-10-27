// Small, dependency-free charts for the admin analytics page.
// Single series, one hue (--bar), value printed at each bar's tip, and a
// hover tooltip (title) per bar. Every value is also visible as text, so
// nothing depends on reading color.

/** Horizontal bars. rows: [{ label, value: number, text: string, hint?: string }] */
export function BarList({ rows, label }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="muted" style={{ margin: 0 }}>No data for this period.</p>;
  return (
    <ul className="barlist" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.text}${r.hint ? ` (${r.hint})` : ''}`}>
          <span className="barlist-label">{r.label}</span>
          <span className="barlist-track">
            <span className="barlist-bar" style={{ width: max > 0 ? `${Math.max(1.5, (r.value / max) * 100)}%` : '0%' }} />
            <span className="barlist-value">{r.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical columns over time. rows: [{ key, label, value: number, text: string }] */
export function Columns({ rows, label }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  const every = Math.ceil(rows.length / 8); // label at most ~8 dates on the axis
  return (
    <div className="columns" role="img" aria-label={label}>
      <div className="columns-plot">
        {rows.map((r) => (
          <div key={r.key} className="columns-slot" title={`${r.label}: ${r.text}`}>
            {r.value > 0 && r.value === max && <span className="columns-value">{r.text}</span>}
            <span className="columns-bar" style={{ height: max > 0 && r.value > 0 ? `${Math.max(2, (r.value / max) * 100)}%` : '0' }} />
          </div>
        ))}
      </div>
      <div className="columns-axis">
        {rows.map((r, i) => (
          // Count back from the newest day, so the last column is always labelled
          // and labels stay evenly spaced (no two dates side by side).
          <span key={r.key}>{(rows.length - 1 - i) % every === 0 ? r.label : ''}</span>
        ))}
      </div>
    </div>
  );
}
