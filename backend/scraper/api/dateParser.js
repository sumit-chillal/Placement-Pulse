/**
 * Best-effort parser that converts the portal's messy human date strings
 * ("15/07/2026", "04th July 2026", "27th June", "-") into JS Date objects.
 * Returns null when nothing parseable is found — never throws.
 */
const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function finalize(year, month, day) {
  if (year == null) {
    const now = new Date();
    year = now.getUTCFullYear();
    const candidate = new Date(Date.UTC(year, month, day));
    // If the (year-less) date already passed by >30 days, assume next year.
    if (candidate.getTime() < now.getTime() - 30 * 864e5) year += 1;
  }
  const d = new Date(Date.UTC(year, month, day));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseDate(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s || s === '-') return null;

  // Strip ordinal suffixes: 1st, 2nd, 3rd, 4th -> 1 2 3 4
  s = s.replace(/(\d+)(st|nd|rd|th)/gi, '$1');

  // Numeric DD/MM/YYYY or DD-MM-YYYY (portal uses day-first).
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yy] = m;
    let year = parseInt(yy, 10);
    if (year < 100) year += 2000;
    return finalize(year, parseInt(mm, 10) - 1, parseInt(dd, 10));
  }

  // Word months: "4 July 2026", "July 4 2026", "27 June".
  const tokens = s.toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  let day = null;
  let month = null;
  let year = null;
  for (const tok of tokens) {
    if (month == null && MONTHS[tok] !== undefined) month = MONTHS[tok];
    else if (/^\d{4}$/.test(tok)) year = parseInt(tok, 10);
    else if (day == null && /^\d{1,2}$/.test(tok)) day = parseInt(tok, 10);
  }
  if (month != null && day != null) return finalize(year, month, day);

  // Last resort: native parser.
  const native = new Date(s);
  return Number.isNaN(native.getTime()) ? null : native;
}
