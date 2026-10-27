// List rules shared by the phone page and (later) the fridge display.
// Pure functions with no Firebase dependency, so they can be unit tested.

export const LISTS = [
  { id: 'fridge', title: 'In the fridge', short: 'Fridge', placeholder: 'Add to the fridge…', tracksAge: true },
  { id: 'meals', title: 'Meal ideas', short: 'Meals', placeholder: 'Add a meal idea…', tracksAge: false },
];

export const GRACE_HOURS = 24;      // FR-22/FR-25: crossed-off items stay this long
export const AGE_FLAG_DAYS = 7;     // FR-8: age marker after this many days
export const EXPIRING_DAYS = 2;     // FR-4: flag use-by dates this close

const HOUR = 36e5;
const DAY = 864e5;

export function toMillis(t) {
  if (t == null) return null;
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  if (typeof t.toMillis === 'function') return t.toMillis();
  return null;
}

export const listInfo = (id) => LISTS.find((l) => l.id === id) || { id, title: id, tracksAge: true };

export function isDone(item) { return toMillis(item.done_at) != null; }

// FR-22: visible while active, or for GRACE_HOURS after being crossed off.
export function isVisible(item, now = Date.now()) {
  if (toMillis(item.archived_at) != null) return false;
  const done = toMillis(item.done_at);
  return done == null || now - done < GRACE_HOURS * HOUR;
}

// FR-24: crossed off more than GRACE_HOURS ago, not yet archived.
export function needsArchive(item, now = Date.now()) {
  const done = toMillis(item.done_at);
  return toMillis(item.archived_at) == null && done != null && now - done >= GRACE_HOURS * HOUR;
}

export function ageDays(item, now = Date.now()) {
  const added = toMillis(item.added_at);
  return added == null ? 0 : Math.floor((now - added) / DAY);
}

// FR-8: age marker on inventory items older than 7 days.
export function showAge(item, now = Date.now()) {
  return listInfo(item.list).tracksAge && !isDone(item) && ageDays(item, now) > AGE_FLAG_DAYS;
}

// Calendar days from today (local time) to a 'YYYY-MM-DD' date.
export function daysUntil(isoDate, now = Date.now()) {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / DAY);
}

// FR-4: use-by date within 2 days (or already past).
export function isExpiring(item, now = Date.now()) {
  if (!listInfo(item.list).tracksAge || isDone(item) || !item.use_by) return false;
  return daysUntil(item.use_by, now) <= EXPIRING_DAYS;
}

// FR-5 / FR-26: active items oldest first, then crossed-off items in the
// order they were crossed off. Meals have no required order, so they use the
// order they were added, which is the same rule.
export function sortItems(items) {
  return [...items].sort((a, b) => {
    const da = isDone(a), db = isDone(b);
    if (da !== db) return da ? 1 : -1;
    if (da) return toMillis(a.done_at) - toMillis(b.done_at);
    return (toMillis(a.added_at) ?? 0) - (toMillis(b.added_at) ?? 0)
      || String(a.name).localeCompare(String(b.name));
  });
}

export function visibleList(items, listId, now = Date.now()) {
  return sortItems(items.filter((i) => i.list === listId && isVisible(i, now)));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(isoOrMillis) {
  const d = typeof isoOrMillis === 'string'
    ? new Date(...isoOrMillis.split('-').map((n, i) => (i === 1 ? n - 1 : +n)))
    : new Date(isoOrMillis);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function useByLabel(isoDate, now = Date.now()) {
  const n = daysUntil(isoDate, now);
  if (n == null) return '';
  if (n < 0) return `Past use-by (${shortDate(isoDate)})`;
  if (n === 0) return 'Use by today';
  if (n === 1) return 'Use by tomorrow';
  return `Use by ${shortDate(isoDate)}`;
}

export function agoLabel(millis, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - millis) / 6e4));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return shortDate(millis);
}

// 'YYYY-MM-DD' for an <input type="date">, in local time.
export function isoDay(millis) {
  const d = new Date(millis);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
