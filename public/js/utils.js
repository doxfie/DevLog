export const monthNames = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

export const el = (id) => document.getElementById(id);

export function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

export function autoResizeTextarea(ta) {
  if (!ta || ta.nodeName !== 'TEXTAREA') return;
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight, 48) + 'px';
}

export function resizeAllTextareas() {
  document.querySelectorAll('.app textarea').forEach(autoResizeTextarea);
}

/** Длительность в минутах между двумя ISO datetime. */
export function durationMinutes(startedAt, endedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  return Math.round((end - start) / 60000);
}

/** Формат "X ч Y мин" по минутам. */
export function formatDuration(minutes) {
  if (minutes < 0) return '0 ч 0 мин';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h} ч ${m} мин`;
}

/** Чистое время занятия: длительность минус перерывы. */
export function studiedMinutes(session) {
  const duration = durationMinutes(session.started_at, session.ended_at);
  const breaks = Number(session.breaks_minutes) || 0;
  return Math.max(0, duration - breaks);
}

export function formatDate(iso) {
  const d = iso.slice(0, 10).split('-');
  return `${d[2]}.${d[1]}.${d[0]}`;
}

export function formatTimeRange(started, ended) {
  const s = started.slice(11, 16);
  const e = ended.slice(11, 16);
  return `${s}–${e}`;
}

export function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getWeekMonday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return toDateKey(monday);
}

export function formatWeekLabel(mondayStr) {
  const m = new Date(mondayStr + 'T12:00:00');
  const end = new Date(m);
  end.setDate(m.getDate() + 6);
  const fmt = (x) => `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}`;
  return `${fmt(m)}–${fmt(end)}`;
}

export function getMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function getCurrentWeekKey() {
  const today = new Date();
  return getWeekMonday(toDateKey(today));
}

export function getNextWeekKey(weekKey) {
  const [y, m, d] = weekKey.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + 7));
}

export function getPreviousWeekKey(weekKey) {
  const [y, m, d] = weekKey.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d - 7));
}

/** Недели (понедельники), попадающие в выбранный месяц. */
export function getWeekKeysInMonth(year, month) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const monday = new Date(firstDay);
  const day = monday.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);
  const weekKeys = [];
  while (monday <= lastDay) {
    weekKeys.push(toDateKey(monday));
    monday.setDate(monday.getDate() + 7);
  }
  return weekKeys;
}
