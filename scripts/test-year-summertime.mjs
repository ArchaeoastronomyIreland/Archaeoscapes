/** Year parsing (BCE minus sign) and summertime UTC offset. */
function parseYearInput(raw, fallback = null) {
  const s = String(raw ?? '').trim();
  if (s === '' || s === '-' || s === '+') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function displaySecondsToUtc(displaySeconds, useSummertime) {
  const offset = useSummertime ? 3600 : 0;
  const wrapped = ((Math.trunc(displaySeconds) % 86400) + 86400) % 86400;
  return ((wrapped - offset) % 86400 + 86400) % 86400;
}

function utcSecondsToDisplay(totalSeconds, useSummertime) {
  const offset = useSummertime ? 3600 : 0;
  const wrapped = ((Math.trunc(totalSeconds) % 86400) + 86400) % 86400;
  return ((wrapped + offset) % 86400 + 86400) % 86400;
}

if (parseYearInput('-') !== null) throw new Error(' lone minus must not commit');
if (parseYearInput('-3000') !== -3000) throw new Error(' BCE year parse failed');
if (parseYearInput('0') !== 0) throw new Error(' year 0 parse failed');
if (parseYearInput('') !== null) throw new Error(' empty must not commit');

const utcNoon = 12 * 3600;
if (utcSecondsToDisplay(utcNoon, false) !== utcNoon) throw new Error(' no summertime offset');
if (utcSecondsToDisplay(utcNoon, true) !== 13 * 3600) throw new Error(' summertime +1h display');
if (displaySecondsToUtc(13 * 3600, true) !== utcNoon) throw new Error(' summertime input back to UTC');

console.log('OK year input and summertime offset');
