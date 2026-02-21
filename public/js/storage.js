import { el } from './utils.js';

const DRAFT_KEY = 'devlog_draft';
const PAUSE_KEY = 'devlog_pauseStartedAt';

// ——— Черновик формы ———

export function saveDraft() {
  const draft = {
    date: el('fieldDate').value,
    startTime: el('fieldStartTime').value,
    endTime: el('fieldEndTime').value,
    breaks: el('fieldBreaks').value,
    notes: el('fieldNotes').value
  };
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (_) {}
}

export function loadDraft() {
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

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
}

// ——— Таймер паузы ———

let pauseStartedAt = null;
let pauseIntervalId = null;

export function getPauseStartedAt() { return pauseStartedAt; }

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

export function stopPause() {
  if (pauseIntervalId) {
    clearInterval(pauseIntervalId);
    pauseIntervalId = null;
  }
  const elapsed = getPauseElapsedMinutes();
  const current = parseInt(el('fieldBreaks').value, 10) || 0;
  el('fieldBreaks').value = current + elapsed;
  saveDraft();
  try { localStorage.removeItem(PAUSE_KEY); } catch (_) {}
  pauseStartedAt = null;
  el('btnPause').textContent = 'Начать перерыв';
  el('btnPause').classList.remove('paused');
  el('pauseElapsed').classList.add('hidden');
}

export function startPause() {
  pauseStartedAt = Date.now();
  try { localStorage.setItem(PAUSE_KEY, String(pauseStartedAt)); } catch (_) {}
  el('btnPause').textContent = 'Закончить перерыв';
  el('btnPause').classList.add('paused');
  updatePauseElapsedDisplay();
  pauseIntervalId = setInterval(updatePauseElapsedDisplay, 1000);
}

export function togglePause() {
  if (pauseStartedAt) stopPause();
  else startPause();
}

export function restorePauseState() {
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

// ——— Настройки (пороги графиков) ———

export function loadSettingsFromStorage() {
  try {
    const w = localStorage.getItem('devlog_weekThreshold');
    if (w != null) el('weekThreshold').value = w;
    const m = localStorage.getItem('devlog_monthThreshold');
    if (m != null) el('monthThreshold').value = m;
  } catch (_) {}
}
