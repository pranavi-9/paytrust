// Search helpers. User input only ever reaches SQL as a bound parameter.

/** Text for a LIKE parameter: trimmed, capped, with %, _ and \ escaped so they match literally. */
export function likeParam(text) {
  const t = String(text ?? '').trim().slice(0, 100);
  return t ? `%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%` : null;
}

/** Builds a URL for a list page, dropping empty and default values. */
export function listUrl(base, values, defaults = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined && v !== null && v !== '' && v !== defaults[k]) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}
