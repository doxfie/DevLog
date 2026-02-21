const API = '/api';
const DRAFT_KEY = 'devlog_draft';
const PAUSE_KEY = 'devlog_pauseStartedAt';

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let selectedWeekKey = null;
let viewSessionsBy = 'week';
let sessionsListCache = [];
let pauseStartedAt = null;
let pauseIntervalId = null;
let editingSessionId = null;

const monthNames = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

const el = (id) => document.getElementById(id);

function autoResizeTextarea(ta) {
  if (!ta || ta.nodeName !== 'TEXTAREA') return;
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight, 48) + 'px';
}

function resizeAllTextareas() {
  document.querySelectorAll('.app textarea').forEach(autoResizeTextarea);
}

// ——— Утилиты времени (одно место для расчётов и форматирования) ———
/** Длительность в минутах между двумя ISO datetime (без перерывов). */
function durationMinutes(startedAt, endedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  return Math.round((end - start) / 60000);
}

/** Формат "X ч Y мин" по минутам. */
function formatDuration(minutes) {
  if (minutes < 0) return '0 ч 0 мин';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h} ч ${m} мин`;
}

/** Чистое время занятия по сессии: длительность минус перерывы. */
function studiedMinutes(session) {
  const duration = durationMinutes(session.started_at, session.ended_at);
  const breaks = Number(session.breaks_minutes) || 0;
  return Math.max(0, duration - breaks);
}

function formatDate(iso) {
  const d = iso.slice(0, 10).split('-');
  return `${d[2]}.${d[1]}.${d[0]}`;
}

function formatTimeRange(started, ended) {
  const s = started.slice(11, 16);
  const e = ended.slice(11, 16);
  return `${s}–${e}`;
}

async function fetchNow() {
  const r = await fetch(`${API}/now`);
  if (!r.ok) throw new Error('Не удалось получить время');
  return r.json();
}

async function loadSessions() {
  const r = await fetch(`${API}/sessions?year=${currentYear}&month=${currentMonth}`);
  if (!r.ok) throw new Error('Не удалось загрузить сессии');
  return r.json();
}

async function loadSessionsByRange(from, to) {
  const r = await fetch(`${API}/sessions?from=${from}&to=${to}`);
  if (!r.ok) throw new Error('Не удалось загрузить сессии');
  return r.json();
}

function renderMonthLabel() {
  el('currentMonthLabel').textContent = `${monthNames[currentMonth - 1]} ${currentYear}`;
}

function renderWeekLabel() {
  if (!selectedWeekKey) return;
  const m = new Date(selectedWeekKey + 'T12:00:00');
  const end = new Date(m);
  end.setDate(m.getDate() + 6);
  const fmt = (x) => `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}`;
  el('currentWeekLabel').textContent = `${fmt(m)}–${fmt(end)}.${m.getFullYear()}`;
}

function updatePeriodLabel() {
  el('headerTotalLabel').textContent = viewSessionsBy === 'week' ? 'Неделя:' : 'Итоги месяца:';
}

function sessionBelongsToWeek(session, weekKey) {
  const day = session.started_at.slice(0, 10);
  return getWeekMonday(day) === weekKey;
}

function renderSessions(list) {
  const listToShow = viewSessionsBy === 'week' && selectedWeekKey
    ? list.filter((s) => sessionBelongsToWeek(s, selectedWeekKey))
    : list;
  const tbody = el('sessionsBody');
  const empty = el('emptyState');
  tbody.innerHTML = '';

  if (!listToShow.length) {
    empty.classList.remove('hidden');
    el('monthTotal').textContent = formatDuration(0);
    return;
  }
  empty.classList.add('hidden');

  let totalMinutes = 0;
  for (const s of listToShow) {
    const min = studiedMinutes(s);
    totalMinutes += min;
    const tr = document.createElement('tr');
    tr.dataset.sessionId = s.id;
    tr.dataset.session = JSON.stringify(s);
    tr.innerHTML = `
      <td>${formatDate(s.started_at)}</td>
      <td>${formatTimeRange(s.started_at, s.ended_at)}</td>
      <td>${s.breaks_minutes}</td>
      <td class="studied">${formatDuration(min)}</td>
      <td class="notes">${escapeHtml(s.notes || '')}</td>
      <td class="row-actions-cell">
        <button type="button" class="btn-edit" data-id="${s.id}" aria-label="Редактировать">✎</button>
        <button type="button" class="btn-delete" data-id="${s.id}" aria-label="Удалить">×</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  el('monthTotal').textContent = formatDuration(totalMinutes);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function refreshSessions() {
  const list = await loadSessions();
  sessionsListCache = list;
  renderWeekLabel();
  updatePeriodLabel();
  renderSessions(list);
  renderCurrentWeekGoals();
  renderWeekNotesSection(list);
}

// ——— Итоги месяца и цели по неделям ———
function getMonthKey() {
  return `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
}

function getCurrentWeekKey() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const d = today.getDate();
  const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return getWeekMonday(dateStr);
}

function getNextWeekKey(weekKey) {
  const [y, m, d] = weekKey.split('-').map(Number);
  const date = new Date(y, m - 1, d + 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getPreviousWeekKey(weekKey) {
  const [y, m, d] = weekKey.split('-').map(Number);
  const date = new Date(y, m - 1, d - 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Недели (понедельники), попадающие в выбранный месяц */
function getWeekKeysInMonth() {
  const firstDay = new Date(currentYear, currentMonth - 1, 1);
  const lastDay = new Date(currentYear, currentMonth, 0);
  let monday = new Date(firstDay);
  const day = monday.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);
  const weekKeys = [];
  while (monday <= lastDay) {
    const y = monday.getFullYear();
    const m = monday.getMonth() + 1;
    const d = monday.getDate();
    weekKeys.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    monday.setDate(monday.getDate() + 7);
  }
  return weekKeys;
}

function clampSelectedWeekToMonth() {
  const inMonth = getWeekKeysInMonth();
  if (!inMonth.length) return;
  if (!inMonth.includes(selectedWeekKey)) {
    selectedWeekKey = inMonth[0];
  }
}

function triggerWeekPickerWarning() {
  const wrap = document.querySelector('.week-picker');
  if (!wrap) return;
  wrap.classList.add('week-picker-shake', 'week-picker-warning');
  setTimeout(() => {
    wrap.classList.remove('week-picker-shake', 'week-picker-warning');
  }, 500);
}

async function loadMonthNote() {
  const r = await fetch(`${API}/month-notes/${getMonthKey()}`);
  if (!r.ok) return '';
  const data = await r.json();
  return data.summary ?? '';
}

async function saveMonthNote(summary) {
  await fetch(`${API}/month-notes/${getMonthKey()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary })
  });
}

async function loadWeekNote(weekKey) {
  const r = await fetch(`${API}/week-notes/${weekKey}`);
  if (!r.ok) return { summary: '', goals: [] };
  const data = await r.json();
  return { summary: data.summary ?? '', goals: Array.isArray(data.goals) ? data.goals : [] };
}

async function saveWeekNote(weekKey, summary, goals) {
  await fetch(`${API}/week-notes/${weekKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary, goals })
  });
}

function renderDiaryMonthSummary() {
  el('diaryMonthSummaryLabel').textContent = `(${monthNames[currentMonth - 1]} ${currentYear})`;
  loadMonthNote().then((summary) => {
    el('diaryMonthSummaryText').value = summary ?? '';
  });
}

function renderDashboardMonthSummary() {
  const section = el('dashboardMonthSummarySection');
  el('dashboardMonthSummaryLabel').textContent = `(${monthNames[currentMonth - 1]} ${currentYear})`;
  loadMonthNote().then((summary) => {
    if (!summary || !summary.trim()) {
      section.style.display = 'none';
    } else {
      section.style.display = '';
      el('dashboardMonthSummaryDisplay').textContent = summary;
    }
  });
}

function renderCurrentWeekGoals() {
  const weekKey = selectedWeekKey || getCurrentWeekKey();
  const previousKey = getPreviousWeekKey(weekKey);
  loadWeekNote(previousKey).then(({ goals }) => {
    const listEl = el('currentWeekGoalsList');
    const emptyEl = el('currentWeekGoalsEmpty');
    listEl.innerHTML = '';
    if (!goals || !goals.length) {
      emptyEl.classList.remove('hidden');
      return;
    }
    emptyEl.classList.add('hidden');
    goals.forEach((g, index) => {
      const item = document.createElement('div');
      item.className = 'goal-item';
      const text = (g && g.text) ? String(g.text).trim() : '';
      const status = (g && g.status) ? g.status : 'pending';
      const id = `goal-${previousKey}-${index}`;
      item.innerHTML = `
        <input type="checkbox" id="${id}" ${status === 'done' ? 'checked' : ''} data-week-key="${previousKey}" data-index="${index}" aria-label="Выполнена">
        <span class="goal-text ${status}">${escapeHtml(text) || '—'}</span>
        <button type="button" class="btn-not-done" data-week-key="${previousKey}" data-index="${index}" aria-label="Не выполнена">Не выполнена</button>
      `;
      const checkbox = item.querySelector('input[type="checkbox"]');
      const textSpan = item.querySelector('.goal-text');
      const btnNotDone = item.querySelector('.btn-not-done');
      const updateGoalStatus = (newStatus) => {
        const goalsCopy = goals.slice();
        goalsCopy[index] = { ...goalsCopy[index], text: goalsCopy[index]?.text ?? '', status: newStatus };
        saveWeekNote(previousKey, undefined, goalsCopy).then(() => {
          textSpan.className = 'goal-text ' + newStatus;
          checkbox.checked = newStatus === 'done';
        });
      };
      checkbox.addEventListener('change', () => {
        const newStatus = checkbox.checked ? 'done' : 'pending';
        updateGoalStatus(newStatus);
      });
      btnNotDone.addEventListener('click', () => {
        const newStatus = textSpan.classList.contains('not_done') ? 'pending' : 'not_done';
        updateGoalStatus(newStatus);
        checkbox.checked = false;
      });
      listEl.appendChild(item);
    });
  });
}

function renderWeekNotesSection(sessionsList) {
  clampSelectedWeekToMonth();
  const weekKey = selectedWeekKey;
  const inMonth = getWeekKeysInMonth();
  if (!weekKey || !inMonth.includes(weekKey)) {
    el('weekNotesList').innerHTML = '';
    return;
  }
  const byWeek = aggregateByWeek(sessionsList || []);
  const nextKey = getNextWeekKey(weekKey);
  const totalMin = byWeek[weekKey] || 0;
  const label = formatWeekLabel(weekKey);
  const container = el('weekNotesList');
  container.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'week-note-card';
  card.dataset.weekKey = weekKey;
  card.dataset.nextWeekKey = nextKey;
  card.innerHTML = `
    <h3>Неделя ${label} (Всего: ${formatDuration(totalMin)})</h3>
    <label class="week-summary-label">Итоги недели</label>
    <textarea class="week-summary-input" data-week-key="${weekKey}" placeholder="Что сделал за неделю..."></textarea>
    <label class="week-goals-label">Цели на следующую неделю</label>
    <div class="week-goals-editor">
      <textarea class="week-goals-input" data-next-week-key="${nextKey}" placeholder="По одной цели на строку или через «- »"></textarea>
    </div>
  `;
  const summaryInput = card.querySelector('.week-summary-input');
  const goalsInput = card.querySelector('.week-goals-input');
  loadWeekNote(weekKey).then(({ summary }) => {
    summaryInput.value = summary || '';
    autoResizeTextarea(summaryInput);
  });
  loadWeekNote(nextKey).then(({ goals }) => {
    const text = Array.isArray(goals) ? goals.map((g) => (g && g.text) ? g.text : '').join('\n') : '';
    goalsInput.value = text;
    autoResizeTextarea(goalsInput);
  });
  const saveSummary = () => {
    saveWeekNote(weekKey, summaryInput.value.trim(), undefined);
  };
  const saveGoals = () => {
    const lines = goalsInput.value.split('\n').map((s) => s.replace(/^\s*[-–—]\s*/, '').trim()).filter(Boolean);
    const goals = lines.map((text) => ({ text, status: 'pending' }));
    saveWeekNote(nextKey, undefined, goals);
  };
  summaryInput.addEventListener('blur', saveSummary);
  goalsInput.addEventListener('blur', saveGoals);
  container.appendChild(card);
}

// ——— Черновик формы (localStorage) ———
function saveDraft() {
  const draft = {
    date: el('fieldDate').value,
    startTime: el('fieldStartTime').value,
    endTime: el('fieldEndTime').value,
    breaks: el('fieldBreaks').value,
    notes: el('fieldNotes').value
  };
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (_) {}
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (draft.date) el('fieldDate').value = draft.date;
    if (draft.startTime) el('fieldStartTime').value = draft.startTime;
    if (draft.endTime) el('fieldEndTime').value = draft.endTime;
    if (draft.breaks !== undefined && draft.breaks !== '') el('fieldBreaks').value = draft.breaks;
    if (draft.notes !== undefined) el('fieldNotes').value = draft.notes;
  } catch (_) {}
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (_) {}
}

// ——— Пауза (таймер перерыва) ———
function getPauseElapsedMinutes() {
  if (!pauseStartedAt) return 0;
  return Math.floor((Date.now() - pauseStartedAt) / 60000);
}

function updatePauseElapsedDisplay() {
  const span = el('pauseElapsed');
  const min = getPauseElapsedMinutes();
  span.textContent = `+ ${min} мин`;
  span.classList.remove('hidden');
}

function stopPause() {
  if (pauseIntervalId) {
    clearInterval(pauseIntervalId);
    pauseIntervalId = null;
  }
  const elapsed = getPauseElapsedMinutes();
  const current = parseInt(el('fieldBreaks').value, 10) || 0;
  el('fieldBreaks').value = current + elapsed;
  saveDraft();
  try {
    localStorage.removeItem(PAUSE_KEY);
  } catch (_) {}
  pauseStartedAt = null;
  el('btnPause').textContent = 'Начать перерыв';
  el('btnPause').classList.remove('paused');
  el('pauseElapsed').classList.add('hidden');
}

function startPause() {
  pauseStartedAt = Date.now();
  try {
    localStorage.setItem(PAUSE_KEY, String(pauseStartedAt));
  } catch (_) {}
  el('btnPause').textContent = 'Закончить перерыв';
  el('btnPause').classList.add('paused');
  updatePauseElapsedDisplay();
  pauseIntervalId = setInterval(updatePauseElapsedDisplay, 1000);
}

function togglePause() {
  if (pauseStartedAt) {
    stopPause();
  } else {
    startPause();
  }
}

function restorePauseState() {
  try {
    const saved = localStorage.getItem(PAUSE_KEY);
    if (!saved) return;
    const ts = parseInt(saved, 10);
    if (isNaN(ts)) return;
    pauseStartedAt = ts;
    el('btnPause').textContent = 'Закончить перерыв';
    el('btnPause').classList.add('paused');
    updatePauseElapsedDisplay();
    pauseIntervalId = setInterval(updatePauseElapsedDisplay, 1000);
  } catch (_) {}
}

// При фокусе в поле — подставить текущие дату/время (Омск), если поле пустое
function setupAutoFillFields() {
  el('fieldDate').addEventListener('focus', async () => {
    if (!el('fieldDate').value) {
      const { date } = await fetchNow();
      el('fieldDate').value = date;
    }
  });
  el('fieldStartTime').addEventListener('focus', async () => {
    if (!el('fieldStartTime').value) {
      const { time } = await fetchNow();
      el('fieldStartTime').value = time;
    }
  });
  el('fieldEndTime').addEventListener('focus', async () => {
    if (!el('fieldEndTime').value) {
      const { time } = await fetchNow();
      el('fieldEndTime').value = time;
    }
  });
}

// ——— Режим редактирования сессии ———
function setFormEditMode(sessionId) {
  editingSessionId = sessionId;
  el('formTitle').textContent = 'Редактирование сессии';
  el('btnSubmit').textContent = 'Сохранить изменения';
  el('btnCancelEdit').classList.remove('hidden');
}

function cancelEdit() {
  editingSessionId = null;
  el('formTitle').textContent = 'Новая сессия';
  el('btnSubmit').textContent = 'Добавить сессию';
  el('btnCancelEdit').classList.add('hidden');
  loadDraft();
  hideFormValidation();
}

function loadSessionIntoForm(session) {
  const date = session.started_at.slice(0, 10);
  const startTime = session.started_at.slice(11, 16);
  const endTime = session.ended_at.slice(11, 16);
  el('fieldDate').value = date;
  el('fieldStartTime').value = startTime;
  el('fieldEndTime').value = endTime;
  el('fieldBreaks').value = String(session.breaks_minutes ?? 0);
  el('fieldNotes').value = session.notes ?? '';
  saveDraft();
}

function startEditSession(session) {
  loadSessionIntoForm(session);
  setFormEditMode(session.id);
}

/** Собирает из формы started_at, ended_at (ISO datetime), длительность и флаг "конец на след. день". */
function buildStartedEnded(form) {
  const date = form.date.value;
  const startTime = form.startTime.value;
  const endTime = form.endTime.value;
  const started_at = `${date}T${startTime}:00`;
  let endDate = date;
  const isNextDay = endTime < startTime;
  if (isNextDay) {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    endDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const ended_at = `${endDate}T${endTime}:00`;
  const durationMinutesVal = durationMinutes(started_at, ended_at);
  return { started_at, ended_at, durationMinutes: durationMinutesVal, isNextDay };
}

/** Результаты валидации формы: можно ли сохранить, сообщения. */
function getFormValidation(form, payload) {
  const breaks = parseInt(form.breaks.value, 10) || 0;
  const { durationMinutes: duration, isNextDay } = payload;
  const breaksExceedDuration = duration > 0 && breaks > duration;
  const durationOver16h = duration > 16 * 60;
  const canSave = !breaksExceedDuration;
  return { isNextDay, breaksExceedDuration, durationOver16h, canSave };
}

function showFormValidation(validation) {
  const block = el('formValidation');
  const messages = [];
  if (validation.breaksExceedDuration) {
    messages.push('Перерывы не могут быть больше длительности сессии.');
  }
  if (validation.isNextDay) {
    messages.push('Конец на следующий день.');
  }
  if (validation.durationOver16h) {
    messages.push('Длительность больше 16 часов.');
  }
  block.classList.toggle('hidden', !messages.length);
  block.classList.toggle('error', validation.breaksExceedDuration);
  block.textContent = messages.join(' ');
}

function hideFormValidation() {
  el('formValidation').classList.add('hidden');
}

async function submitSession(e) {
  e.preventDefault();
  const form = e.target;
  const payload = buildStartedEnded(form);
  const { started_at, ended_at } = payload;
  const breaks_minutes = parseInt(form.breaks.value, 10) || 0;
  const notes = form.notes.value.trim();

  const validation = getFormValidation(form, payload);
  showFormValidation(validation);
  if (!validation.canSave) return;

  const isEdit = editingSessionId !== null;
  if (isEdit) {
    const r = await fetch(`${API}/sessions/${editingSessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ started_at, ended_at, breaks_minutes, notes })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.error || 'Ошибка сохранения');
      return;
    }
    cancelEdit();
  } else {
    const r = await fetch(`${API}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ started_at, ended_at, breaks_minutes, notes })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.error || 'Ошибка сохранения');
      return;
    }
    form.notes.value = '';
    form.breaks.value = '0';
    clearDraft();
    if (pauseStartedAt) stopPause();
    saveDraft();
  }
  hideFormValidation();
  refreshSessions();
}

function updateValidationFromForm() {
  const form = el('sessionForm');
  if (!form.date.value || !form.startTime.value || !form.endTime.value) {
    hideFormValidation();
    return;
  }
  const payload = buildStartedEnded(form);
  const validation = getFormValidation(form, payload);
  showFormValidation(validation);
}

let toastTimeoutId = null;

function showToast(message, options = {}) {
  const container = el('toast');
  const undoBtn = el('toastUndo');
  el('toastMessage').textContent = message;
  container.classList.remove('hidden');
  undoBtn.classList.toggle('hidden', !options.onUndo);
  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = null;
  if (options.onUndo) {
    const handleUndo = () => {
      if (toastTimeoutId) clearTimeout(toastTimeoutId);
      toastTimeoutId = null;
      container.classList.add('hidden');
      undoBtn.classList.add('hidden');
      options.onUndo();
    };
    undoBtn.onclick = handleUndo;
    toastTimeoutId = setTimeout(() => {
      container.classList.add('hidden');
      undoBtn.classList.add('hidden');
      toastTimeoutId = null;
    }, 5000);
  }
}

async function deleteSession(id, sessionForUndo) {
  const r = await fetch(`${API}/sessions/${id}`, { method: 'DELETE' });
  if (!r.ok) return;
  refreshSessions();
  showToast('Удалено', {
    onUndo: () => {
      if (!sessionForUndo) return;
      fetch(`${API}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: sessionForUndo.id,
          started_at: sessionForUndo.started_at,
          ended_at: sessionForUndo.ended_at,
          breaks_minutes: sessionForUndo.breaks_minutes ?? 0,
          notes: sessionForUndo.notes ?? ''
        })
      }).then(() => refreshSessions());
    }
  });
}

function init() {
  selectedWeekKey = getCurrentWeekKey();
  clampSelectedWeekToMonth();
  loadDraft();
  restorePauseState();
  renderMonthLabel();
  refreshSessions();
  renderDiaryMonthSummary();
  setupAutoFillFields();
  document.body.addEventListener('input', (e) => {
    if (e.target.matches('textarea')) autoResizeTextarea(e.target);
  });
  setTimeout(resizeAllTextareas, 100);
  window.addEventListener('beforeunload', saveDraft);
  el('sessionForm').addEventListener('submit', submitSession);

  el('btnPause').addEventListener('click', togglePause);

  el('prevMonth').addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 1) { currentMonth = 12; currentYear--; }
    renderMonthLabel();
    clampSelectedWeekToMonth();
    refreshSessions();
    renderDiaryMonthSummary();
  });
  el('nextMonth').addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    renderMonthLabel();
    clampSelectedWeekToMonth();
    refreshSessions();
    renderDiaryMonthSummary();
  });

  el('prevWeek').addEventListener('click', () => {
    const prevKey = getPreviousWeekKey(selectedWeekKey);
    const inMonth = getWeekKeysInMonth();
    if (!inMonth.includes(prevKey)) {
      triggerWeekPickerWarning();
      return;
    }
    selectedWeekKey = prevKey;
    renderWeekLabel();
    updatePeriodLabel();
    renderCurrentWeekGoals();
    renderSessions(sessionsListCache);
    renderWeekNotesSection(sessionsListCache);
  });
  el('nextWeek').addEventListener('click', () => {
    const nextKey = getNextWeekKey(selectedWeekKey);
    const inMonth = getWeekKeysInMonth();
    if (!inMonth.includes(nextKey)) {
      triggerWeekPickerWarning();
      return;
    }
    selectedWeekKey = nextKey;
    renderWeekLabel();
    updatePeriodLabel();
    renderCurrentWeekGoals();
    renderSessions(sessionsListCache);
    renderWeekNotesSection(sessionsListCache);
  });

  document.querySelectorAll('.sessions-view-toggle .toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewSessionsBy = btn.dataset.range;
      document.querySelectorAll('.sessions-view-toggle .toggle-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.range === viewSessionsBy);
        b.setAttribute('aria-selected', b.dataset.range === viewSessionsBy ? 'true' : 'false');
      });
      refreshSessions();
    });
  });

  el('sessionsBody').addEventListener('click', (e) => {
    const row = e.target.closest('tr');
    if (!row || !row.dataset.session) return;
    const session = JSON.parse(row.dataset.session);
    const btnDelete = e.target.closest('.btn-delete');
    const btnEdit = e.target.closest('.btn-edit');
    if (btnDelete) {
      deleteSession(session.id, session);
      return;
    }
    if (btnEdit || (!btnDelete && !btnEdit)) {
      startEditSession(session);
    }
  });

  el('btnCancelEdit').addEventListener('click', cancelEdit);
  el('btnClearForm').addEventListener('click', () => {
    const form = el('sessionForm');
    form.reset();
    form.breaks.value = '0';
    clearDraft();
    hideFormValidation();
    if (editingSessionId) cancelEdit();
    saveDraft();
  });

  el('fieldDate').addEventListener('input', () => { saveDraft(); updateValidationFromForm(); });
  el('fieldStartTime').addEventListener('input', () => { saveDraft(); updateValidationFromForm(); });
  el('fieldEndTime').addEventListener('input', () => { saveDraft(); updateValidationFromForm(); });
  el('fieldBreaks').addEventListener('input', () => { saveDraft(); updateValidationFromForm(); });
  el('fieldNotes').addEventListener('input', saveDraft);

  el('diaryMonthSummaryText').addEventListener('blur', () => {
    saveMonthNote(el('diaryMonthSummaryText').value);
  });

  // Вкладки Дневник / Дашборд
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      showView(view);
    });
  });
}

// ——— Переключение видов ———
function showView(viewId) {
  const diary = el('viewDiary');
  const dashboard = el('viewDashboard');
  const settings = el('viewSettings');
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === viewId);
    t.setAttribute('aria-selected', t.dataset.view === viewId ? 'true' : 'false');
  });
  [diary, dashboard, settings].forEach((v) => {
    v.classList.add('view--hidden');
    v.setAttribute('aria-hidden', 'true');
  });
  if (viewId === 'diary') {
    diary.classList.remove('view--hidden');
    diary.setAttribute('aria-hidden', 'false');
    el('headerDiaryInfo').style.display = '';
    el('headerTotalAll').style.display = 'none';
    renderDiaryMonthSummary();
  } else if (viewId === 'dashboard') {
    dashboard.classList.remove('view--hidden');
    dashboard.setAttribute('aria-hidden', 'false');
    el('headerDiaryInfo').style.display = 'none';
    el('headerTotalAll').style.display = '';
    renderDashboardMonthSummary();
    renderDashboard();
  } else {
    settings.classList.remove('view--hidden');
    settings.setAttribute('aria-hidden', 'false');
    el('headerDiaryInfo').style.display = 'none';
    el('headerTotalAll').style.display = 'none';
    loadSettingsFromStorage();
  }
}

function loadSettingsFromStorage() {
  try {
    const w = localStorage.getItem('devlog_weekThreshold');
    if (w != null) el('weekThreshold').value = w;
    const m = localStorage.getItem('devlog_monthThreshold');
    if (m != null) el('monthThreshold').value = m;
  } catch (_) {}
}

// ——— Дашборд: агрегация и графики ———
let chartWeeks = null;
let chartMonths = null;

function getWeekMonday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}

function formatWeekLabel(mondayStr) {
  const m = new Date(mondayStr + 'T12:00:00');
  const end = new Date(m);
  end.setDate(m.getDate() + 6);
  const fmt = (x) => `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}`;
  return `${fmt(m)}–${fmt(end)}`;
}

function aggregateByWeek(sessions) {
  const byWeek = {};
  for (const s of sessions) {
    const key = getWeekMonday(s.started_at.slice(0, 10));
    if (!byWeek[key]) byWeek[key] = 0;
    byWeek[key] += studiedMinutes(s);
  }
  return byWeek;
}

function aggregateByMonth(sessions) {
  const byMonth = {};
  for (const s of sessions) {
    const key = s.started_at.slice(0, 7);
    if (!byMonth[key]) byMonth[key] = 0;
    byMonth[key] += studiedMinutes(s);
  }
  return byMonth;
}

/** Детали по неделям: минуты, число сессий, сумма перерывов. */
function aggregateByWeekDetailed(sessions) {
  const byWeek = {};
  for (const s of sessions) {
    const key = getWeekMonday(s.started_at.slice(0, 10));
    if (!byWeek[key]) byWeek[key] = { minutes: 0, sessionsCount: 0, breaksSum: 0 };
    byWeek[key].minutes += studiedMinutes(s);
    byWeek[key].sessionsCount += 1;
    byWeek[key].breaksSum += Number(s.breaks_minutes) || 0;
  }
  return byWeek;
}

/** Детали по месяцам: минуты, число сессий, сумма перерывов. */
function aggregateByMonthDetailed(sessions) {
  const byMonth = {};
  for (const s of sessions) {
    const key = s.started_at.slice(0, 7);
    if (!byMonth[key]) byMonth[key] = { minutes: 0, sessionsCount: 0, breaksSum: 0 };
    byMonth[key].minutes += studiedMinutes(s);
    byMonth[key].sessionsCount += 1;
    byMonth[key].breaksSum += Number(s.breaks_minutes) || 0;
  }
  return byMonth;
}

const CHART_THEME = {
  grid: 'rgba(255, 255, 255, 0.08)',
  tick: '#c9d1d9',
  line: '#5b9bd5',
  fill: 'rgba(91, 155, 213, 0.15)',
  goalLine: 'rgba(210, 153, 34, 0.95)'
};

function getChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false }
    },
    scales: {
      x: {
        grid: { color: CHART_THEME.grid },
        ticks: { color: CHART_THEME.tick, maxRotation: 45, font: { size: 11 } }
      },
      y: {
        grid: { color: CHART_THEME.grid },
        ticks: { color: CHART_THEME.tick, font: { size: 11 } },
        beginAtZero: true
      }
    }
  };
}

let _tooltipActiveIndex = -1;

function showCustomTooltip(chart, tooltipMeta, event) {
  const tooltipEl = document.getElementById('chartTooltip');
  if (!tooltipEl || !tooltipMeta) return;
  const elements = chart.getElementsAtEventForMode(event, 'index', { intersect: false });
  if (!elements.length) {
    tooltipEl.classList.add('hidden');
    tooltipEl.setAttribute('aria-hidden', 'true');
    _tooltipActiveIndex = -1;
    return;
  }
  const dataIndex = elements[0].index;
  const m = tooltipMeta[dataIndex];
  if (!m) {
    tooltipEl.classList.add('hidden');
    tooltipEl.setAttribute('aria-hidden', 'true');
    _tooltipActiveIndex = -1;
    return;
  }

  const rect = chart.canvas.getBoundingClientRect();
  const point = chart.getDatasetMeta(0).data[dataIndex];
  const x = point ? point.x : rect.width / 2;
  const y = point ? point.y : 0;
  tooltipEl.style.left = `${rect.left + x + 10}px`;
  tooltipEl.style.top = `${rect.top + y + 10}px`;

  if (dataIndex !== _tooltipActiveIndex) {
    _tooltipActiveIndex = dataIndex;
    const dev = m.deviation >= 0 ? `+${m.deviation}` : `${m.deviation}`;
    const devClass = m.deviation >= 0 ? 'chart-tooltip-dev--pos' : 'chart-tooltip-dev--neg';
    const badgeClass = m.belowGoal ? 'chart-tooltip-badge chart-tooltip-badge--below' : 'chart-tooltip-badge chart-tooltip-badge--ok';
    const badgeText = m.belowGoal ? 'Ниже цели' : 'В норме';
    tooltipEl.innerHTML = `
      <div class="chart-tooltip-title">${escapeHtml(m.label)}</div>
      <div class="chart-tooltip-body">
        Часы: ${m.hours} ч<br>
        Цель: ${m.goal} ч<br>
        Отклонение: <span class="${devClass}">${dev} ч</span>
      </div>
      <span class="${badgeClass}">${badgeText}</span>
    `;
  }

  tooltipEl.classList.remove('hidden');
  tooltipEl.setAttribute('aria-hidden', 'false');
}

function bindCustomTooltip(chart, tooltipMeta) {
  const tooltipEl = document.getElementById('chartTooltip');
  if (!tooltipEl) return;
  const canvas = chart.canvas;
  if (canvas._tooltipMove) {
    canvas.removeEventListener('mousemove', canvas._tooltipMove);
    canvas.removeEventListener('mouseleave', canvas._tooltipLeave);
  }
  const onMove = (e) => showCustomTooltip(chart, tooltipMeta, e);
  const onLeave = () => {
    tooltipEl.classList.add('hidden');
    tooltipEl.setAttribute('aria-hidden', 'true');
  };
  canvas._tooltipMove = onMove;
  canvas._tooltipLeave = onLeave;
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
}

function createLineDataset(values) {
  return {
    label: 'Часы',
    data: values,
    borderColor: CHART_THEME.line,
    backgroundColor: CHART_THEME.fill,
    borderWidth: 2,
    fill: 'origin',
    tension: 0.3,
    pointRadius: 4,
    pointBackgroundColor: CHART_THEME.line,
    pointBorderColor: 'rgba(13, 17, 23, 0.8)',
    pointBorderWidth: 1,
    pointHoverRadius: 6
  };
}

/** Линия цели (горизонтальная пунктирная). */
function createThresholdDataset(thresholdHours, labelCount) {
  const t = Number(thresholdHours) || 0;
  return {
    label: 'Цель',
    data: Array(labelCount).fill(t),
    borderColor: CHART_THEME.goalLine,
    borderWidth: 1.5,
    borderDash: [6, 4],
    fill: false,
    pointRadius: 0,
    tension: 0
  };
}


function destroyChart(chart) {
  if (chart) chart.destroy();
}

async function renderDashboard() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const currentWeekMonday = getWeekMonday(now.toISOString().slice(0, 10));
  const sortedWeeksList = [];
  const d = new Date(currentWeekMonday + 'T12:00:00');
  for (let i = 0; i < 8; i++) {
    sortedWeeksList.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 7);
  }
  sortedWeeksList.reverse();
  const fromW = sortedWeeksList[0];
  const toW = sortedWeeksList[sortedWeeksList.length - 1];

  const fromMonths = new Date(year - 1, month, 1);
  const toMonths = new Date(year, month, 0);
  const fromM = fromMonths.toISOString().slice(0, 10);
  const toM = toMonths.toISOString().slice(0, 10);

  const [sessionsWeeks, sessionsMonths, stats] = await Promise.all([
    loadSessionsByRange(fromW, toW),
    loadSessionsByRange(fromM, toM),
    fetch(`${API}/stats`).then((r) => (r.ok ? r.json() : { totalStudiedMinutes: 0 }))
  ]);

  el('dashboardTotalStudied').textContent = formatDuration(stats.totalStudiedMinutes || 0);

  const byWeek = aggregateByWeek(sessionsWeeks);
  const byMonth = aggregateByMonth(sessionsMonths);
  const byWeekDet = aggregateByWeekDetailed(sessionsWeeks);
  const byMonthDet = aggregateByMonthDetailed(sessionsMonths);

  const sortedWeeks = sortedWeeksList;
  const sortedMonths = Object.keys(byMonth).sort();
  const weekLabels = sortedWeeks.map(formatWeekLabel);

  el('dashboardWeeksLabel').textContent = '(последние 8 недель)';
  el('dashboardMonthsLabel').textContent = '(последние 12 месяцев)';

  const hours = (min) => Math.round((min / 60) * 10) / 10;

  const weeksValues = sortedWeeks.map((w) => hours(byWeek[w] || 0));
  const monthsValues = sortedMonths.map((m) => hours(byMonth[m]));
  const monthsLabels = sortedMonths.map((m) => {
    const [y, mo] = m.split('-');
    return `${monthNames[parseInt(mo, 10) - 1]} ${y}`;
  });

  try {
    const savedW = localStorage.getItem('devlog_weekThreshold');
    if (savedW != null) el('weekThreshold').value = savedW;
    const savedM = localStorage.getItem('devlog_monthThreshold');
    if (savedM != null) el('monthThreshold').value = savedM;
  } catch (_) {}
  const thresholdHours = parseInt(el('weekThreshold').value, 10) || 10;
  const thresholdMonthHours = parseInt(el('monthThreshold').value, 10) || 40;

  const weekMeta = sortedWeeks.map((w) => {
    const det = byWeekDet[w] || { minutes: 0, sessionsCount: 0, breaksSum: 0 };
    const h = hours(det.minutes);
    return {
      label: formatWeekLabel(w),
      hours: h,
      goal: thresholdHours,
      deviation: Math.round((h - thresholdHours) * 10) / 10,
      sessionsCount: det.sessionsCount,
      breaksSum: det.breaksSum,
      belowGoal: h < thresholdHours
    };
  });
  const monthMeta = sortedMonths.map((m) => {
    const det = byMonthDet[m] || { minutes: 0, sessionsCount: 0, breaksSum: 0 };
    const h = hours(det.minutes);
    return {
      label: (() => { const [y, mo] = m.split('-'); return `${monthNames[parseInt(mo, 10) - 1]} ${y}`; })(),
      hours: h,
      goal: thresholdMonthHours,
      deviation: Math.round((h - thresholdMonthHours) * 10) / 10,
      sessionsCount: det.sessionsCount,
      breaksSum: det.breaksSum,
      belowGoal: h < thresholdMonthHours
    };
  });

  const canvasWeeks = el('chartWeeks');
  const canvasMonths = el('chartMonths');

  destroyChart(chartWeeks);
  chartWeeks = new Chart(canvasWeeks, {
    type: 'line',
    data: {
      labels: weekLabels,
      datasets: [
        createLineDataset(weeksValues),
        createThresholdDataset(thresholdHours, weekLabels.length)
      ]
    },
    options: getChartOptions()
  });
  bindCustomTooltip(chartWeeks, weekMeta);

  const thWeekInput = el('weekThreshold');
  if (thWeekInput && !thWeekInput.dataset.bound) {
    thWeekInput.dataset.bound = '1';
    thWeekInput.addEventListener('input', () => {
      try { localStorage.setItem('devlog_weekThreshold', thWeekInput.value); } catch (_) {}
      renderDashboard();
    });
  }
  const thMonthInput = el('monthThreshold');
  if (thMonthInput && !thMonthInput.dataset.bound) {
    thMonthInput.dataset.bound = '1';
    thMonthInput.addEventListener('input', () => {
      try { localStorage.setItem('devlog_monthThreshold', thMonthInput.value); } catch (_) {}
      renderDashboard();
    });
  }

  destroyChart(chartMonths);
  chartMonths = new Chart(canvasMonths, {
    type: 'line',
    data: {
      labels: monthsLabels,
      datasets: [
        createLineDataset(monthsValues),
        createThresholdDataset(thresholdMonthHours, monthsLabels.length)
      ]
    },
    options: getChartOptions()
  });
  bindCustomTooltip(chartMonths, monthMeta);
}

init();
