import { el } from './utils.js';

const DRAFT_KEY = 'devlog_draft';
const PAUSE_KEY = 'devlog_pauseStartedAt';
const APP_FAVICON = '/favicon.svg';
const BREAK_FAVICON = '/favicon-break.svg';
const BREAK_TITLE_PREFIX = 'Перерыв';

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
let baseDocumentTitle = '';
let shortAppTitle = '';

export function getPauseStartedAt() { return pauseStartedAt; }

function ensureBaseDocumentTitle() {
  if (!baseDocumentTitle) baseDocumentTitle = document.title;
  if (!shortAppTitle) {
    const trimmed = baseDocumentTitle.trim();
    shortAppTitle = (trimmed.split(/[—-]/)[0] || trimmed).trim() || 'DevLog';
  }
}

function ensureFaviconLink() {
  let iconLink = document.querySelector('link#appFavicon') || document.querySelector('link[rel~="icon"]');
  if (!iconLink) {
    iconLink = document.createElement('link');
    iconLink.id = 'appFavicon';
    iconLink.rel = 'icon';
    iconLink.type = 'image/svg+xml';
    document.head.appendChild(iconLink);
  }
  return iconLink;
}

function syncTabPauseState() {
  ensureBaseDocumentTitle();
  const iconLink = ensureFaviconLink();
  if (pauseStartedAt) {
    const min = getPauseElapsedMinutes();
    document.title = `${BREAK_TITLE_PREFIX}: ${min} мин · ${shortAppTitle}`;
    iconLink.setAttribute('href', BREAK_FAVICON);
    return;
  }
  document.title = baseDocumentTitle;
  iconLink.setAttribute('href', APP_FAVICON);
}

function getPauseElapsedMinutes() {
  if (!pauseStartedAt) return 0;
  return Math.floor((Date.now() - pauseStartedAt) / 60000);
}

function updatePauseElapsedDisplay() {
  const min = getPauseElapsedMinutes();
  el('pauseLabel').textContent = `${min} мин · Стоп`;
  syncTabPauseState();
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
  el('pauseLabel').textContent = 'Перерыв';
  el('btnPause').classList.remove('paused');
  syncTabPauseState();
}

export function startPause() {
  pauseStartedAt = Date.now();
  try { localStorage.setItem(PAUSE_KEY, String(pauseStartedAt)); } catch (_) {}
  el('pauseLabel').textContent = '0 мин · Стоп';
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
    el('pauseLabel').textContent = '0 мин · Стоп';
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
