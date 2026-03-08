import {
  el, escapeHtml, monthNames, autoResizeTextarea, resizeAllTextareas,
  durationMinutes, formatDuration, studiedMinutes, formatDate, formatTimeRange,
  getWeekMonday, formatWeekLabel, getMonthKey,
  getCurrentWeekKey, getNextWeekKey, getPreviousWeekKey, getWeekKeysInMonth
} from './utils.js';

import {
  fetchNow, loadSessions as apiLoadSessions, createSession, updateSession, removeSession,
  loadMonthNote, saveMonthNote, loadWeekNote, saveWeekNote, loadStats
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
let toastCountdownId = null;
let sessionDurationIntervalId = null;

// ——— Навигация: месяц и неделя ———

function renderMonthLabel() {
  const trigger = document.getElementById('headerMonthTrigger');
  if (trigger) trigger.textContent = `${monthNames[currentMonth - 1]} ${currentYear}`;
}

function renderWeekLabel() {
  if (!selectedWeekKey) return;
  const trigger = document.getElementById('headerWeekTrigger');
  if (trigger) trigger.textContent = `${formatWeekLabel(selectedWeekKey)}.${new Date(selectedWeekKey + 'T12:00:00').getFullYear()}`;
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
  const wrap = document.getElementById('headerPeriodPicker');
  if (!wrap) return;
  wrap.classList.add('week-picker-shake', 'week-picker-warning');
  setTimeout(() => wrap.classList.remove('week-picker-shake', 'week-picker-warning'), 500);
}

// ——— Period picker (calendar, week selection) ———

function dateToKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderPeriodCalendar(viewYear, viewMonth, pendingWeekKey) {
  el('pickerMonthYear').textContent = `${monthNames[viewMonth - 1]} ${viewYear}`;

  const first = new Date(viewYear, viewMonth - 1, 1);
  const dayOfWeek = first.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const start = new Date(first);
  start.setDate(first.getDate() + mondayOffset);

  const grid = el('pickerCalendarGrid');
  grid.innerHTML = '';
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const d = new Date(start);
      d.setDate(start.getDate() + row * 7 + col);
      const key = dateToKey(d);
      const weekKey = getWeekMonday(key);
      const isCurrentMonth = d.getMonth() === viewMonth - 1;
      const isSelected = weekKey === pendingWeekKey;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'period-calendar-day';
      if (!isCurrentMonth) cell.classList.add('other-month');
      if (isSelected) cell.classList.add('week-selected');
      cell.dataset.date = key;
      cell.textContent = d.getDate();
      cell.setAttribute('aria-label', key);
      grid.appendChild(cell);
    }
  }
}

function openPeriodPicker() {
  const modal = el('periodPickerModal');
  modal._pickerViewYear = currentYear;
  modal._pickerViewMonth = currentMonth;
  modal._pickerPendingWeekKey = selectedWeekKey || getCurrentWeekKey();

  function render() {
    renderPeriodCalendar(modal._pickerViewYear, modal._pickerViewMonth, modal._pickerPendingWeekKey);
    el('pickerCalendarGrid').querySelectorAll('.period-calendar-day').forEach((btn) => {
      btn.addEventListener('click', () => {
        modal._pickerPendingWeekKey = getWeekMonday(btn.dataset.date);
        render();
      });
    });
  }

  function onPrevMonth() {
    modal._pickerViewMonth--;
    if (modal._pickerViewMonth < 1) { modal._pickerViewMonth = 12; modal._pickerViewYear--; }
    render();
  }
  function onNextMonth() {
    modal._pickerViewMonth++;
    if (modal._pickerViewMonth > 12) { modal._pickerViewMonth = 1; modal._pickerViewYear++; }
    render();
  }

  el('pickerPrevMonth').addEventListener('click', onPrevMonth);
  el('pickerNextMonth').addEventListener('click', onNextMonth);

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  el('headerMonthTrigger').setAttribute('aria-expanded', 'true');
  el('headerWeekTrigger').setAttribute('aria-expanded', 'true');

  modal._pickerCleanup = () => {
    el('pickerPrevMonth').removeEventListener('click', onPrevMonth);
    el('pickerNextMonth').removeEventListener('click', onNextMonth);
  };
  modal._pickerPending = () => ({
    viewYear: modal._pickerViewYear,
    viewMonth: modal._pickerViewMonth,
    pendingWeekKey: modal._pickerPendingWeekKey
  });
  modal._pickerRender = render;
  render();
}

function applyPeriodPickerState() {
  const modal = el('periodPickerModal');
  const getPending = modal._pickerPending;
  if (!getPending) return;
  const { viewYear: y, viewMonth: m, pendingWeekKey: weekKey } = getPending();
  currentYear = y;
  currentMonth = m;
  selectedWeekKey = weekKey;
  renderMonthLabel();
  renderWeekLabel();
  updatePeriodLabel();
  refreshSessions();
  renderCurrentMonthSummaryInCard();
  renderCurrentWeekGoals();
  renderCurrentWeekSummary();
}

function closePeriodPicker() {
  const modal = el('periodPickerModal');
  applyPeriodPickerState();
  if (modal._pickerCleanup) {
    modal._pickerCleanup();
    modal._pickerCleanup = null;
  }
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  el('headerMonthTrigger').setAttribute('aria-expanded', 'false');
  el('headerWeekTrigger').setAttribute('aria-expanded', 'false');
}

function pickerJumpToNow() {
  const now = new Date();
  const modal = el('periodPickerModal');
  modal._pickerViewYear = now.getFullYear();
  modal._pickerViewMonth = now.getMonth() + 1;
  modal._pickerPendingWeekKey = getCurrentWeekKey();
  if (modal._pickerRender) modal._pickerRender();
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
  renderCurrentWeekSummary();
  renderCurrentMonthSummaryInCard();
}

// ——— Итоги месяца ———

function renderCurrentMonthSummaryInCard() {
  const monthKey = getMonthKey(currentYear, currentMonth);
  const textEl = el('currentMonthSummaryText');
  const btnRow = el('btnToggleMonthSummary');
  const btnSection = el('btnToggleMonthSummaryInSection');
  const wrapEl = el('monthSummaryInputWrap');
  const monthSection = el('goalsSummaryMonthSection');
  const monthInline = el('goalsSummaryMonthInline');
  loadMonthNote(monthKey).then((summary) => {
    const hasSummary = summary && summary.trim().length > 0;
    if (hasSummary) {
      textEl.innerHTML = renderSummaryAsList(summary);
      textEl.classList.remove('hidden');
      btnSection.textContent = ICON_PENCIL;
      btnSection.setAttribute('aria-label', 'Изменить итоги месяца');
      btnSection.title = 'Изменить итоги месяца';
      monthSection.classList.remove('hidden');
      monthInline.classList.add('hidden');
      monthInline.classList.remove('visible-on-card-hover');
    } else {
      textEl.classList.add('hidden');
      textEl.innerHTML = '';
      btnRow.innerHTML = SVG_PLUS;
      btnRow.setAttribute('aria-label', 'Итоги месяца');
      btnRow.title = 'Итоги месяца';
      monthSection.classList.add('hidden');
      monthInline.classList.remove('hidden');
      monthInline.classList.add('visible-on-card-hover');
    }
    wrapEl.classList.add('hidden');
  });
}

// ——— Цели на эту неделю ———

const SVG_NOT_DONE = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
const SVG_DELETE = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

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
        <button type="button" class="btn-goal-not-done" title="Не выполнена" aria-label="Не выполнена">${SVG_NOT_DONE}</button>
        <button type="button" class="btn-goal-delete" title="Удалить цель" aria-label="Удалить цель">${SVG_DELETE}</button>
      `;
      const checkbox = item.querySelector('input[type="checkbox"]');
      const textSpan = item.querySelector('.goal-text');
      const btnNotDone = item.querySelector('.btn-goal-not-done');
      const btnDelete = item.querySelector('.btn-goal-delete');
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
      });
      btnDelete.addEventListener('click', () => {
        const goalsCopy = goals.slice();
        goalsCopy.splice(index, 1);
        saveWeekNote(previousKey, undefined, goalsCopy).then(() => renderCurrentWeekGoals());
      });
      listEl.appendChild(item);
    });
  });
}

function showAddGoalInput() {
  const wrap = el('goalNewInputWrap');
  const input = el('goalNewInput');
  wrap.classList.remove('hidden');
  input.value = '';
  input.focus();
}

function hideAddGoalInput() {
  el('goalNewInputWrap').classList.add('hidden');
  el('goalNewInput').value = '';
}

function submitNewGoal() {
  const input = el('goalNewInput');
  const text = input.value.trim();
  if (!text) {
    hideAddGoalInput();
    return;
  }
  const weekKey = selectedWeekKey || getCurrentWeekKey();
  const previousKey = getPreviousWeekKey(weekKey);
  loadWeekNote(previousKey).then(({ goals }) => {
    const list = Array.isArray(goals) ? goals.slice() : [];
    list.push({ text, status: 'pending' });
    return saveWeekNote(previousKey, undefined, list);
  }).then(() => {
    hideAddGoalInput();
    renderCurrentWeekGoals();
  });
}

const ICON_PENCIL = '\u270E'; // ✎
const SVG_PLUS = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

/** При отображении убираем ведущие дефисы с начала строк (для старых данных из экселя). */
function stripSummaryDashes(text) {
  if (!text || typeof text !== 'string') return '';
  return text.split('\n').map((line) => line.replace(/^\s*[-–—]\s*/, '')).join('\n').trim();
}

/** Собирает HTML списка для итогов (каждая строка — пункт списка). */
function renderSummaryAsList(text) {
  const t = stripSummaryDashes(text);
  if (!t || !t.trim()) return '';
  const lines = t.split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  return '<ul class="goals-summary-ul">' + lines.map((l) => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>';
}

function renderCurrentWeekSummary() {
  const weekKey = selectedWeekKey || getCurrentWeekKey();
  const textEl = el('currentWeekSummaryText');
  const btnEl = el('btnToggleWeekSummary');
  const wrapEl = el('goalSummaryInputWrap');
  loadWeekNote(weekKey).then(({ summary }) => {
    const hasSummary = summary && summary.trim().length > 0;
    if (hasSummary) {
      textEl.innerHTML = renderSummaryAsList(summary);
      textEl.classList.remove('hidden');
      btnEl.textContent = ICON_PENCIL;
      btnEl.setAttribute('aria-label', 'Изменить итоги недели');
      btnEl.title = 'Изменить итоги недели';
    } else {
      textEl.classList.add('hidden');
      textEl.innerHTML = '';
      btnEl.innerHTML = SVG_PLUS;
      btnEl.setAttribute('aria-label', 'Итоги недели');
      btnEl.title = 'Итоги недели';
    }
    wrapEl.classList.add('hidden');
  });
}

function showSummaryInput() {
  const weekKey = selectedWeekKey || getCurrentWeekKey();
  const weekBlock = el('goalsSummaryWeekBlock');
  const wrapEl = el('goalSummaryInputWrap');
  const inputEl = el('goalSummaryInput');
  loadWeekNote(weekKey).then(({ summary }) => {
    inputEl.value = summary || '';
    weekBlock.classList.add('hidden');
    wrapEl.classList.remove('hidden');
    inputEl.focus();
    autoResizeTextarea(inputEl);
  });
}

function hideSummaryInput() {
  el('goalsSummaryWeekBlock').classList.remove('hidden');
  el('goalSummaryInputWrap').classList.add('hidden');
}

function showMonthSummaryInput() {
  const monthKey = getMonthKey(currentYear, currentMonth);
  const monthSection = el('goalsSummaryMonthSection');
  const wrapEl = el('monthSummaryInputWrap');
  const inputEl = el('monthSummaryInput');
  loadMonthNote(monthKey).then((summary) => {
    inputEl.value = summary ?? '';
    monthSection.classList.add('hidden');
    wrapEl.classList.remove('hidden');
    inputEl.focus();
    autoResizeTextarea(inputEl);
  });
}

function hideMonthSummaryInput() {
  el('goalsSummaryMonthSection').classList.remove('hidden');
  el('monthSummaryInputWrap').classList.add('hidden');
}

function submitWeekSummary() {
  const inputEl = el('goalSummaryInput');
  const weekKey = selectedWeekKey || getCurrentWeekKey();
  const summary = inputEl.value.trim();
  saveWeekNote(weekKey, summary, undefined).then(() => {
    hideSummaryInput();
    renderCurrentWeekSummary();
  });
}

function submitMonthSummary() {
  const inputEl = el('monthSummaryInput');
  const monthKey = getMonthKey(currentYear, currentMonth);
  const summary = inputEl.value.trim();
  saveMonthNote(monthKey, summary).then(() => {
    hideMonthSummaryInput();
    renderCurrentMonthSummaryInCard();
  });
}

// ——— Форма: автозаполнение, валидация, отправка ———

function setupAutoFillFields() {
  el('fieldDate').addEventListener('focus', async () => {
    if (!el('fieldDate').value) {
      const { date } = await fetchNow();
      el('fieldDate').value = date;
      updateValidationFromForm();
    }
  });
  el('fieldStartTime').addEventListener('focus', async () => {
    if (!el('fieldStartTime').value) {
      const { time } = await fetchNow();
      el('fieldStartTime').value = time;
      updateValidationFromForm();
    }
  });
  el('fieldEndTime').addEventListener('focus', async () => {
    if (!el('fieldEndTime').value) {
      const { time } = await fetchNow();
      el('fieldEndTime').value = time;
      updateValidationFromForm();
    }
  });
}

function setFormEditMode(sessionId) {
  editingSessionId = sessionId;
  el('formTitle').textContent = 'Сессия';
  el('btnSubmit').textContent = 'Сохранить изменения';
  el('btnCancelEdit').classList.remove('hidden');
}

function cancelEdit() {
  editingSessionId = null;
  el('formTitle').textContent = 'Сессия';
  el('btnSubmit').textContent = 'Добавить сессию';
  el('btnCancelEdit').classList.add('hidden');
  loadDraft();
  hideFormValidation();
  renderSessionDurationHint();
}

function startEditSession(session) {
  cancelInlineEdit();
  const row = document.querySelector(`tr[data-session-id="${session.id}"]`);
  if (!row) return;
  row.classList.add('inline-editing');
  row.dataset.originalSession = row.dataset.session;

  const date = session.started_at.slice(0, 10);
  const startTime = session.started_at.slice(11, 16);
  const endTime = session.ended_at.slice(11, 16);
  const breaks = session.breaks_minutes ?? 0;
  const notes = session.notes ?? '';

  row.innerHTML = `
    <td><input type="date" class="inline-input" value="${date}" data-field="date"></td>
    <td>
      <div class="inline-time-cell">
        <input type="time" class="inline-input inline-time" value="${startTime}" data-field="start">
        <span class="inline-time-sep">–</span>
        <input type="time" class="inline-input inline-time" value="${endTime}" data-field="end">
      </div>
    </td>
    <td><input type="number" class="inline-input inline-breaks" value="${breaks}" min="0" data-field="breaks"></td>
    <td class="studied">${formatDuration(studiedMinutes(session))}</td>
    <td><textarea class="inline-input inline-notes" data-field="notes" rows="2">${escapeHtml(notes)}</textarea></td>
    <td class="row-actions-cell">
      <button type="button" class="btn-inline-save" aria-label="Сохранить" title="Сохранить">✓</button>
      <button type="button" class="btn-inline-cancel" aria-label="Отмена" title="Отмена">✕</button>
    </td>
  `;
  row.querySelector('[data-field="notes"]')?.focus();
}

function cancelInlineEdit() {
  const editing = document.querySelector('tr.inline-editing');
  if (!editing) return;
  if (editing.dataset.originalSession) {
    editing.dataset.session = editing.dataset.originalSession;
  }
  renderSessions(sessionsListCache);
}

async function saveInlineEdit(row) {
  const session = JSON.parse(row.dataset.originalSession || row.dataset.session);
  const date = row.querySelector('[data-field="date"]').value;
  const start = row.querySelector('[data-field="start"]').value;
  const end = row.querySelector('[data-field="end"]').value;
  const breaks = parseInt(row.querySelector('[data-field="breaks"]').value, 10) || 0;
  const notes = row.querySelector('[data-field="notes"]').value.trim();

  if (!date || !start || !end) return;

  const started_at = `${date}T${start}:00`;
  let endDate = date;
  if (end < start) {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    endDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const ended_at = `${endDate}T${end}:00`;

  try {
    await updateSession(session.id, { started_at, ended_at, breaks_minutes: breaks, notes });
  } catch (err) {
    showToast(err.message || 'Ошибка сохранения');
    return;
  }
  refreshSessions();
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

function getFormSessionDurationData(form) {
  const date = form.date.value;
  const startTime = form.startTime.value;
  if (!date || !startTime) return null;

  const startDate = new Date(`${date}T${startTime}:00`);
  if (Number.isNaN(startDate.getTime())) return null;

  let endDate = null;
  let isLive = false;
  if (form.endTime.value) {
    const endTime = form.endTime.value;
    endDate = new Date(`${date}T${endTime}:00`);
    if (Number.isNaN(endDate.getTime())) return null;
    if (endTime < startTime) {
      endDate.setDate(endDate.getDate() + 1);
    }
  } else {
    endDate = new Date();
    isLive = true;
  }

  const totalMinutes = Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 60000));
  const breaksMinutes = Math.max(0, parseInt(form.breaks.value, 10) || 0);
  const pauseStartedAt = getPauseStartedAt();
  const activePauseMinutes = pauseStartedAt ? Math.floor((Date.now() - pauseStartedAt) / 60000) : 0;
  const studiedMinutesValue = Math.max(0, totalMinutes - (breaksMinutes + activePauseMinutes));

  return { totalMinutes, studiedMinutes: studiedMinutesValue, isLive };
}

function renderSessionDurationHint() {
  const form = el('sessionForm');
  const hint = el('sessionDurationHint');
  if (!form || !hint) return;

  const data = getFormSessionDurationData(form);
  if (!data) {
    hint.classList.add('hidden');
    hint.classList.remove('is-live');
    hint.textContent = '';
    return;
  }

  const studiedText = formatDuration(data.studiedMinutes);
  hint.textContent = `Длительность: ${studiedText}`;
  hint.classList.toggle('is-live', data.isLive);
  hint.classList.remove('hidden');
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
  flashFormSuccess();
  refreshSessions();
  renderSessionDurationHint();
}

function flashFormSuccess() {
  const section = document.querySelector('.form-section');
  section.classList.remove('form-success');
  void section.offsetWidth;
  section.classList.add('form-success');
  section.addEventListener('animationend', () => section.classList.remove('form-success'), { once: true });
}

function updateValidationFromForm() {
  const form = el('sessionForm');
  renderSessionDurationHint();
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
  const timer = el('toastTimer');
  const ring = el('toastTimerRing');
  const countEl = el('toastTimerCount');
  const CIRCUMFERENCE = 2 * Math.PI * 16; // r=16

  el('toastMessage').textContent = message;
  container.classList.remove('hidden');
  undoBtn.classList.toggle('hidden', !options.onUndo);

  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  if (toastCountdownId) clearInterval(toastCountdownId);
  toastTimeoutId = null;
  toastCountdownId = null;

  const hideToast = () => {
    if (toastTimeoutId) clearTimeout(toastTimeoutId);
    if (toastCountdownId) clearInterval(toastCountdownId);
    toastTimeoutId = null;
    toastCountdownId = null;
    container.classList.add('hidden');
    timer.classList.add('hidden');
    undoBtn.classList.add('hidden');
  };

  if (options.onUndo) {
    const duration = 5;
    let remaining = duration;

    timer.classList.remove('hidden');
    ring.style.transition = 'none';
    ring.style.strokeDasharray = `${CIRCUMFERENCE}`;
    ring.style.strokeDashoffset = '0';
    countEl.textContent = remaining;

    requestAnimationFrame(() => {
      ring.style.transition = `stroke-dashoffset ${duration}s linear`;
      ring.style.strokeDashoffset = `${CIRCUMFERENCE}`;
    });

    toastCountdownId = setInterval(() => {
      remaining--;
      countEl.textContent = Math.max(remaining, 0);
      if (remaining <= 0) clearInterval(toastCountdownId);
    }, 1000);

    undoBtn.onclick = () => {
      hideToast();
      options.onUndo();
    };

    toastTimeoutId = setTimeout(hideToast, duration * 1000);
  } else {
    timer.classList.add('hidden');
    toastTimeoutId = setTimeout(hideToast, 3000);
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
    el('headerTotalAll').classList.add('hidden');
    renderCurrentMonthSummaryInCard();
  } else if (viewId === 'dashboard') {
    dashboard.classList.remove('view--hidden');
    dashboard.setAttribute('aria-hidden', 'false');
    el('headerDiaryInfo').style.display = 'none';
    el('headerTotalAll').classList.remove('hidden');
    renderDashboard();
  } else {
    settings.classList.remove('view--hidden');
    settings.setAttribute('aria-hidden', 'false');
    el('headerDiaryInfo').style.display = 'none';
    el('headerTotalAll').classList.add('hidden');
    loadSettingsFromStorage();
    loadAboutInfo();
  }
}

async function loadAboutInfo() {
  try {
    const stats = await loadStats();
    el('aboutSessionsCount').textContent = stats.count ?? '—';
    const totalH = stats.totalStudiedMinutes
      ? (stats.totalStudiedMinutes / 60).toFixed(1)
      : '—';
    el('aboutTotalHours').textContent = totalH === '—' ? '—' : `${totalH} ч`;
    el('aboutFirstDate').textContent = stats.firstDate
      ? new Date(stats.firstDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
      : '—';
    el('aboutLastDate').textContent = stats.lastDate
      ? new Date(stats.lastDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
      : '—';
  } catch { /* silent */ }
}

// ——— Инициализация ———

function init() {
  selectedWeekKey = getCurrentWeekKey();
  clampSelectedWeekToMonth();
  loadDraft();
  restorePauseState();
  renderMonthLabel();
  refreshSessions();
  renderCurrentMonthSummaryInCard();
  setupAutoFillFields();
  renderSessionDurationHint();
  sessionDurationIntervalId = setInterval(renderSessionDurationHint, 1000);

  document.body.addEventListener('input', (e) => {
    if (e.target.matches('textarea')) autoResizeTextarea(e.target);
  });
  setTimeout(resizeAllTextareas, 100);
  window.addEventListener('beforeunload', () => {
    saveDraft();
    if (sessionDurationIntervalId) clearInterval(sessionDurationIntervalId);
  });

  el('sessionForm').addEventListener('submit', submitSession);
  el('sessionForm').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      el('sessionForm').requestSubmit();
    }
  });
  el('btnPause').addEventListener('click', () => {
    togglePause();
    renderSessionDurationHint();
  });

  el('btnAddGoal').addEventListener('click', showAddGoalInput);
  el('goalNewInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitNewGoal(); }
  });
  el('goalNewInput').addEventListener('blur', submitNewGoal);

  el('btnToggleWeekSummary').addEventListener('click', showSummaryInput);
  el('goalSummaryInput').addEventListener('blur', submitWeekSummary);
  el('btnToggleMonthSummary').addEventListener('click', showMonthSummaryInput);
  el('btnToggleMonthSummaryInSection').addEventListener('click', showMonthSummaryInput);
  el('monthSummaryInput').addEventListener('blur', submitMonthSummary);

  el('headerMonthTrigger').addEventListener('click', openPeriodPicker);
  el('headerWeekTrigger').addEventListener('click', openPeriodPicker);

  el('periodPickerModal').querySelector('.period-picker-backdrop').addEventListener('click', closePeriodPicker);
  el('pickerBtnNow').addEventListener('click', pickerJumpToNow);
  el('pickerBtnOk').addEventListener('click', closePeriodPicker);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('periodPickerModal').classList.contains('hidden')) {
      closePeriodPicker();
    }
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
    if (!row) return;
    if (e.target.closest('.btn-inline-save')) {
      saveInlineEdit(row);
      return;
    }
    if (e.target.closest('.btn-inline-cancel')) {
      cancelInlineEdit();
      return;
    }
    if (row.classList.contains('inline-editing')) return;
    if (!row.dataset.session) return;
    const session = JSON.parse(row.dataset.session);
    if (e.target.closest('.btn-delete')) {
      deleteSession(session.id, session);
      return;
    }
    if (e.target.closest('.btn-edit')) {
      startEditSession(session);
    }
  });
  el('sessionsBody').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancelInlineEdit();
    if (e.key === 'Enter' && !e.target.matches('textarea')) {
      const row = e.target.closest('tr.inline-editing');
      if (row) { e.preventDefault(); saveInlineEdit(row); }
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
    renderSessionDurationHint();
  });

  el('fieldDate').addEventListener('input', () => { saveDraft(); updateValidationFromForm(); });
  el('fieldStartTime').addEventListener('input', () => { saveDraft(); updateValidationFromForm(); });
  el('fieldEndTime').addEventListener('input', () => { saveDraft(); updateValidationFromForm(); });
  el('fieldBreaks').addEventListener('input', () => { saveDraft(); updateValidationFromForm(); });
  el('fieldNotes').addEventListener('input', saveDraft);

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });
}

init();
