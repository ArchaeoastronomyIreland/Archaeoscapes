/** Verify UTC second steps produce sub-minute Julian day deltas. */
function parseTimeParts(timeStr) {
  const parts = String(timeStr || '00:00:00').trim().split(':');
  return {
    hour: Math.max(0, Math.min(23, Number(parts[0]) || 0)),
    minute: Math.max(0, Math.min(59, Number(parts[1]) || 0)),
    second: Math.max(0, Math.min(59, Number(parts[2]) || 0))
  };
}

function parseTimeTotalSeconds(timeStr) {
  const p = parseTimeParts(timeStr);
  return p.hour * 3600 + p.minute * 60 + p.second;
}

function formatTimeFromTotalSeconds(totalSeconds) {
  const wrapped = ((Math.trunc(totalSeconds) % 86400) + 86400) % 86400;
  const hh = Math.floor(wrapped / 3600);
  const mm = Math.floor((wrapped % 3600) / 60);
  const ss = wrapped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function selectedHour(timeStr) {
  const p = parseTimeParts(timeStr);
  return p.hour + p.minute / 60 + p.second / 3600;
}

function julianDayFromCalendar(year, month, day, hour = 0) {
  let y = Math.trunc(year);
  let m = Math.trunc(month);
  const d = Number(day) + Number(hour) / 24;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

let time = '12:00:00';
const jd0 = julianDayFromCalendar(2024, 6, 21, selectedHour(time));
const jd1 = julianDayFromCalendar(2024, 6, 21, selectedHour(formatTimeFromTotalSeconds(parseTimeTotalSeconds(time) + 1)));
const deltaDays = jd1 - jd0;
const deltaSec = deltaDays * 86400;

if (Math.abs(deltaSec - 1) > 0.001) {
  console.error('FAIL: 1 second should advance JD by 1/86400 days, got', deltaSec);
  process.exit(1);
}

// Simulate second-only edit with stale hour/minute DOM values.
function applySecondOnly(settingsTime, domSecond, staleDomHour) {
  const prev = parseTimeParts(settingsTime);
  const second = domSecond === '' ? prev.second : Math.max(0, Math.min(59, Math.trunc(Number(domSecond))));
  return formatTimeFromTotalSeconds(prev.hour * 3600 + prev.minute * 60 + second);
}

const merged = applySecondOnly('14:30:00', '1', '99');
if (merged !== '14:30:01') {
  console.error('FAIL: second-only merge expected 14:30:01, got', merged);
  process.exit(1);
}

console.log('OK: time seconds advance JD by 1s; second-only merge ignores stale hour field');
