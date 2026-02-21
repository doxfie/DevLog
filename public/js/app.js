import {
  el, escapeHtml, monthNames, autoResizeTextarea, resizeAllTextareas,
  durationMinutes, formatDuration, studiedMinutes, formatDate, formatTimeRange,
  getWeekMonday, formatWeekLabel, getMonthKey,
  getCurrentWeekKey, getNextWeekKey, getPreviousWeekKey, getWeekKeysInMonth
} from './utils.js';

import {
  fetchNow, loadSessions as apiLoadSessions, createSession, updateSession, removeSession,
  loadMonthNote, saveMonthNote, loadWeekNote, saveWeekNote
} from './api.js';

import {
  saveDraft, loadDraft, clearDraft,
  togglePause, stopPause, restorePauseState, getPauseStartedAt,
  loadSettingsFromStorage
} from './storage.js';

import { aggregateByWeek, renderDashboard } from './chart.js';

// ——— Состояние приложения ———

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let selectedWeekKey = null;
let viewSessionsBy = 'week';
let sessionsListCache = [];
let editingSessionId = null;
let toastTimeoutId = null;

// ——— Навигация: месяц и неделя ———

function renderMonthLabel() {
  el('currentMonthLabel').textContent = `${monthNames[currentMonth - 1]} ${currentYear}`;
}

function renderWeekLabel() {
  if (!selectedWeekKey) return;
  el('currentWeekLabel').textContent = `${formatWeekLabel(selectedWeekKey)}.${new Date(selectedWeekKey + 'T12:00:00').getFullYear()}`;
}

function updatePeriodLabel() {
  el('headerTotalLabel').textContent = viewSessionsBy === 'week' ? 'Неделя:' : 'Итоги месяца:';
}

function clampSelectedWeekToMonth() {
  const inMonth = getWeekKeysInMonth(currentYear, currentMonth);
  if (!inMonth.length) return;
  if (!inMonth.includes(selectedWeekKey)) {
    selectedWeekKey = inMonth[0];
  }
}

function triggerWeekPickerWarning() {
  const wrap = document.querySelector('.week-picker');
  if (!wrap) return;
  wrap.classList.add('week-picker-shake', 'week-picker-warning');
  setTimeout(() => wrap.classList.remove('week-picker-shake', 'week-picker-warning'), 500);
}

// ——— Рендер сессий ———

function sessionBelongsToWeek(session, weekKey) {
  return getWeekMonday(session.started_at.slice(0, 10)) === weekKey;
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

async function refreshSessions() {
  const list = await apiLoadSessions(currentYear, currentMonth);
  sessionsListCache = list;
  renderWeekLabel();
  updatePeriodLabel();
  renderSessions(list);
  renderCurrentWeekGoals();
  renderWeekNotesSection(list);
}

// ——— Итоги месяца ———

function renderDiaryMonthSummary() {
  el('diaryMonthSummaryLabel').textContent = `(${monthNames[currentMonth - 1]} ${currentYear})`;
  loadMonthNote(getMonthKey(currentYear, currentMonth)).then((summary) => {
    el('diaryMonthSummaryText').value = summary ?? '';
  });
}

function renderDashboardMonthSummary() {
  const section = el('dashboardMonthSummarySection');
  el('dashboardMonthSummaryLabel').textContent = `(${monthNames[currentMonth - 1]} ${currentYear})`;
  loadMonthNote(getMonthKey(currentYear, currentMonth)).then((summary) => {
    if (!summary || !summary.trim()) {
      section.style.display = 'none';
    } else {
      section.style.display = '';
      el('dashboardMonthSummaryDisplay').textContent = summary;
    }
  });
}

// ——— Цели на эту неделю ———

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
        <button type="button" class="btn-goal-dismiss" title="Не выполнена" aria-label="Не выполнена">&#x2715;</button>
      `;
      const checkbox = item.querySelector('input[type="checkbox"]');
      const textSpan = item.querySelector('.goal-text');
      const btnNotDone = item.querySelector('.btn-goal-dismiss');
      const updateGoalStatus = (newStatus) => {
        const goalsCopy = goals.slice();
        goalsCopy[index] = { ...goalsCopy[index], text: goalsCopy[index]?.text ?? '', status: newStatus };
        saveWeekNote(previousKey, undefined, goalsCopy).then(() => {
          textSpan.className = 'goal-text ' + newStatus;
          checkbox.checked = newStatus === 'done';
        });
      };
      checkbox.addEventListener('change', () => updateGoalStatus(checkbox.checked ? 'done' : 'pending'));
      btnNotDone.addEventListener('click', () => {
        updateGoalStatus(textSpan.classList.contains('not_done') ? 'pending' : 'not_done');
        checkbox.checked = false;
      });
      listEl.appendChild(item);
    });
  });
}

// ——— Итоги и цели по неделям ———

function renderWeekNotesSection(sessionsList) {
  clampSelectedWeekToMonth();
  const weekKey = selectedWeekKey;
  const inMonth = getWeekKeysInMonth(currentYear, currentMonth);
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
  card.innerHTML = `
    <h3>Неделя ${label} (Всего: ${formatDuration(totalMin)})</h3>
    <label class="week-summary-label">Итоги недели</label>
    <textarea class="week-summary-input" placeholder="Что сделал за неделю..."></textarea>
    <label class="week-goals-label">Цели на следующую неделю</label>
    <div class="week-goals-editor">
      <textarea class="week-goals-input" placeholder="По одной цели на строку или через «- »"></textarea>
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
  summaryInput.addEventListener('blur', () => saveWeekNote(weekKey, summaryInput.value.trim(), undefined));
  goalsInput.addEventListener('blur', () => {
    const lines = goalsInput.value.split('\n').map((s) => s.replace(/^\s*[-–—]\s*/, '').trim()).filter(Boolean);
    saveWeekNote(nextKey, undefined, lines.map((text) => ({ text, status: 'pending' })));
  });
  container.appendChild(card);
}

// ——— Форма: автозаполнение, валидация, отправка ———

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

function startEditSession(session) {
  el('fieldDate').value = session.started_at.slice(0, 10);
  el('fieldStartTime').value = session.started_at.slice(11, 16);
  el('fieldEndTime').value = session.ended_at.slice(11, 16);
  el('fieldBreaks').value = String(session.breaks_minutes ?? 0);
  el('fieldNotes').value = session.notes ?? '';
  saveDraft();
  setFormEditMode(session.id);
}

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
  return { started_at, ended_at, durationMinutes: durationMinutes(started_at, ended_at), isNextDay };
}

const MAX_SESSION_HOURS = 16;

function getFormValidation(form, payload) {
  const breaks = parseInt(form.breaks.value, 10) || 0;
  const { durationMinutes: duration, isNextDay } = payload;
  const breaksExceedDuration = duration > 0 && breaks > duration;
  const durationOver16h = duration > MAX_SESSION_HOURS * 60;
  return { isNextDay, breaksExceedDuration, durationOver16h, canSave: !breaksExceedDuration };
}

function showFormValidation(validation) {
  const block = el('formValidation');
  const messages = [];
  if (validation.breaksExceedDuration) messages.push('Перерывы не могут быть больше длительности сессии.');
  if (validation.isNextDay) messages.push('Конец на следующий день.');
  if (validation.durationOver16h) messages.push('Длительность больше 16 часов.');
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

  try {
    if (editingSessionId) {
      await updateSession(editingSessionId, { started_at, ended_at, breaks_minutes, notes });
      cancelEdit();
    } else {
      await createSession({ started_at, ended_at, breaks_minutes, notes });
      form.notes.value = '';
      form.breaks.value = '0';
      clearDraft();
      if (getPauseStartedAt()) stopPause();
      saveDraft();
    }
  } catch (err) {
    showToast(err.message || 'Ошибка сохранения');
    return;
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
  showFormValidation(getFormValidation(form, buildStartedEnded(form)));
}

// ——— Toast ———

function showToast(message, options = {}) {
  const container = el('toast');
  const undoBtn = el('toastUndo');
  el('toastMessage').textContent = message;
  container.classList.remove('hidden');
  undoBtn.classList.toggle('hidden', !options.onUndo);
  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = null;
  if (options.onUndo) {
    undoBtn.onclick = () => {
      if (toastTimeoutId) clearTimeout(toastTimeoutId);
      toastTimeoutId = null;
      container.classList.add('hidden');
      undoBtn.classList.add('hidden');
      options.onUndo();
    };
    toastTimeoutId = setTimeout(() => {
      container.classList.add('hidden');
      undoBtn.classList.add('hidden');
      toastTimeoutId = null;
    }, 5000);
  }
}

async function deleteSession(id, sessionForUndo) {
  try {
    await removeSession(id);
  } catch {
    showToast('Не удалось удалить сессию');
    return;
  }
  refreshSessions();
  showToast('Удалено', {
    onUndo: () => {
      if (!sessionForUndo) return;
      createSession({
        id: sessionForUndo.id,
        started_at: sessionForUndo.started_at,
        ended_at: sessionForUndo.ended_at,
        breaks_minutes: sessionForUndo.breaks_minutes ?? 0,
        notes: sessionForUndo.notes ?? ''
      }).then(() => refreshSessions());
    }
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

// ——— Инициализация ———

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
    if (!getWeekKeysInMonth(currentYear, currentMonth).includes(prevKey)) {
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
    if (!getWeekKeysInMonth(currentYear, currentMonth).includes(nextKey)) {
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
    if (e.target.closest('.btn-delete')) {
      deleteSession(session.id, session);
      return;
    }
    if (e.target.closest('.btn-edit') || !e.target.closest('button')) {
      startEditSession(session);
    }
  });

  el('btnCancelEdit').addEventListener('click', cancelEdit);
  el('btnClearForm').addEventListener('click', () => {
    el('sessionForm').reset();
    el('sessionForm').breaks.value = '0';
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
    saveMonthNote(getMonthKey(currentYear, currentMonth), el('diaryMonthSummaryText').value);
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });
}

init();
