// CHARACTERIZATION SOURCE: extracted from app.js (main) without changing behavior.
// Safe for Node record; never performs network calls or writes financial data.
export function convertDisplayToInputDate(dStr) {
  if (!dStr) return '';
  const parts = dStr.split('/');
  return parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}` : dStr;
}

export function formatDate(str) {
  if (!str) return '';
  const clean = str.toString().replace("'", "").trim();
  const p = clean.includes('/') ? clean.split('/') : clean.split('-');
  if (p.length !== 3) return clean;
  if (clean.includes('-')) return `${p[2].padStart(2,'0')}/${p[1].padStart(2,'0')}/${p[0]}`;
  return `${p[0].padStart(2,'0')}/${p[1].padStart(2,'0')}/${p[2]}`;
}
