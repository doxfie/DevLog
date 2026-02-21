const API = '/api';

export async function fetchNow() {
  const r = await fetch(`${API}/now`);
  if (!r.ok) throw new Error('Не удалось получить время');
  return r.json();
}

export async function loadSessions(year, month) {
  const r = await fetch(`${API}/sessions?year=${year}&month=${month}`);
  if (!r.ok) throw new Error('Не удалось загрузить сессии');
  return r.json();
}

export async function loadSessionsByRange(from, to) {
  const r = await fetch(`${API}/sessions?from=${from}&to=${to}`);
  if (!r.ok) throw new Error('Не удалось загрузить сессии');
  return r.json();
}

export async function createSession(data) {
  const r = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'Ошибка сохранения');
  }
  return r.json();
}

export async function updateSession(id, data) {
  const r = await fetch(`${API}/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'Ошибка сохранения');
  }
  return r.json();
}

export async function removeSession(id) {
  const r = await fetch(`${API}/sessions/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error('Не удалось удалить сессию');
}

export async function loadMonthNote(monthKey) {
  const r = await fetch(`${API}/month-notes/${monthKey}`);
  if (!r.ok) return '';
  const data = await r.json();
  return data.summary ?? '';
}

export async function saveMonthNote(monthKey, summary) {
  await fetch(`${API}/month-notes/${monthKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary })
  });
}

export async function loadWeekNote(weekKey) {
  const r = await fetch(`${API}/week-notes/${weekKey}`);
  if (!r.ok) return { summary: '', goals: [] };
  const data = await r.json();
  return { summary: data.summary ?? '', goals: Array.isArray(data.goals) ? data.goals : [] };
}

export async function saveWeekNote(weekKey, summary, goals) {
  await fetch(`${API}/week-notes/${weekKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary, goals })
  });
}

export async function loadStats() {
  const r = await fetch(`${API}/stats`);
  return r.ok ? r.json() : { totalStudiedMinutes: 0 };
}
