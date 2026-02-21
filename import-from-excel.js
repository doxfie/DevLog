/**
 * Импорт из Excel «Web Development Study Log» в БД DevLog.
 *
 * Структура твоей таблицы:
 * - Сессии: дата K, время L (HH:MM–HH:MM), перерывы M, что делал O (объединено до V).
 * - Строки «Неделя», «Итоги недели», «Цели на следующую неделю» в L — пропускаются.
 * - Итоги месяца: ячейка B7 на каждом листе (в Марте и Феврале может не быть).
 *
 * Запуск:
 *   node import-from-excel.js "d:\Skillbox\Web Development Study Log.xlsm" --inspect [Лист]
 *   node import-from-excel.js "d:\Skillbox\Web Development Study Log.xlsm"
 *
 * Перед импортом: node clear-db.js
 */
import XLSX from 'xlsx';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, 'devlog.db');

// Столбцы Excel (0 = A, 10 = K, 11 = L, 12 = M, 13 = N, 14 = O)
const COL_K = 10; // Дата
const COL_L = 11; // Время сессии (HH:MM–HH:MM) или заголовок недели
const COL_M = 12; // Перерывы (мин)
const COL_O = 14; // Что делал (O:V объединены — в xlsx обычно в первой ячейке)

const MONTH_SHEETS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTH_NAME_TO_NUM = { Январь: 1, Февраль: 2, Март: 3, Апрель: 4, Май: 5, Июнь: 6, Июль: 7, Август: 8, Сентябрь: 9, Октябрь: 10, Ноябрь: 11, Декабрь: 12 };

const SHEET_INDEX_OR_NAME = 'Январь';

function getCell(sheet, address) {
  const cell = sheet[address];
  if (!cell || cell.v == null) return '';
  return typeof cell.v === 'string' ? cell.v.trim() : String(cell.v).trim();
}

/** Значение ячейки (row, col) с учётом объединений: если ячейка в merge, берём из верхней левой. */
function getCellWithMerges(sheet, rowIndex, colIndex) {
  const addr = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
  let cell = sheet[addr];
  const merges = sheet['!merges'];
  if ((!cell || cell.v == null || cell.v === '') && merges && merges.length) {
    for (const range of merges) {
      const { s, e } = range;
      if (rowIndex >= s.r && rowIndex <= e.r && colIndex >= s.c && colIndex <= e.c) {
        const originAddr = XLSX.utils.encode_cell({ r: s.r, c: s.c });
        cell = sheet[originAddr];
        break;
      }
    }
  }
  if (!cell || cell.v == null) return null;
  return cell.v;
}

function inspect(path, sheetOverride) {
  const workbook = XLSX.readFile(path);
  console.log('Листы:', workbook.SheetNames);
  const sheetName = sheetOverride ?? (
    typeof SHEET_INDEX_OR_NAME === 'number'
      ? workbook.SheetNames[SHEET_INDEX_OR_NAME]
      : SHEET_INDEX_OR_NAME
  );
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    console.error('Лист не найден:', sheetName);
    process.exit(1);
  }
  console.log('\nЛист:', sheetName);
  console.log('Ячейка B7 (итоги месяца):', getCell(sheet, 'B7') || '(пусто)');
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  console.log('\nПример строк (K → дата, L, M, O):');
  data.slice(0, 30).forEach((row, i) => {
    const k = row[COL_K], l = row[COL_L], m = row[COL_M], o = row[COL_O];
    if ((k != null && k !== '') || (l != null && l !== '')) {
      const parsed = parseDate(k);
      const dateStr = parsed ? `${String(parsed.getDate()).padStart(2,'0')}.${String(parsed.getMonth()+1).padStart(2,'0')}.${parsed.getFullYear()}` : '—';
      console.log(`  ${i}  K:${dateStr}  L:${l}  M:${m}  O:${(o || '').toString().slice(0, 40)}...`);
    }
  });
}

/** Конвертирует серийный номер Excel или строку DD.MM.YYYY в Date (только дата, без времени). */
function parseDate(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number') {
    const serial = Math.round(val); // Excel хранит дробь; 46053.9999 → 46054
    const utcMs = (serial - 25569) * 86400 * 1000;
    const d = new Date(utcMs);
    return isNaN(d.getTime()) ? null : new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return new Date(val.getFullYear(), val.getMonth(), val.getDate());
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Парсит "15:10-18:29" или "18:52-0:11". Возвращает { startH, startM, endH, endM, endNextDay } */
function parseTimeRange(str) {
  if (str == null || str === '') return null;
  const s = String(str).trim().replace(/\u2013/g, '-');
  const parts = s.split(/-/);
  if (parts.length < 2) return null;
  const startPart = parts[0].trim();
  const endPart = parts[1].trim();
  const startM = startPart.match(/^(\d{1,2})[.:](\d{2})$/);
  const endM = endPart.match(/^(\d{1,2})[.:](\d{2})$/);
  if (!startM || !endM) return null;
  return {
    startH: parseInt(startM[1], 10),
    startM: parseInt(startM[2], 10),
    endH: parseInt(endM[1], 10),
    endM: parseInt(endM[2], 10),
    endNextDay: parseInt(endM[1], 10) < parseInt(startM[1], 10) || (parseInt(endM[1], 10) === 0 && parseInt(startM[1], 10) > 0)
  };
}

function toISODateTime(date, h, m) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${y}-${mo}-${d}T${hh}:${mm}:00`;
}

/** Пропускать только заголовки недель/блоков и строку заголовка таблицы. Пустой K (объединённая дата) не пропускаем — дату возьмём из merge или lastDateOnly. */
function isSkipRow(row) {
  const l = row[COL_L];
  const lStr = l != null ? String(l).trim() : '';
  if (lStr.startsWith('Неделя') || lStr.startsWith('Итоги недели') || lStr.startsWith('Цели на следующую')) return true;
  const k = row[COL_K];
  const kStr = (k != null && k !== '') ? String(k).trim().toLowerCase() : '';
  if (kStr === 'дата') return true; // строка заголовка "Дата | Время сессии | ..."
  return false;
}

/** Из даты в K Excel может приходить 23:59:30 — используем только календарную дату. */
function dateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Парсит "Неделя 12–18.01.2026" или "Неделя 28-04.05.2025" → понедельник YYYY-MM-DD. */
function parseWeekKeyFromHeader(lStr) {
  const m = String(lStr).trim().match(/Неделя\s+(\d{1,2})[–\-](\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const startDay = parseInt(m[1], 10);
  const endDay = parseInt(m[2], 10);
  const month = parseInt(m[3], 10);
  const year = parseInt(m[4], 10);
  let monMonth = month;
  let monYear = year;
  if (startDay > endDay) {
    monMonth = month === 1 ? 12 : month - 1;
    monYear = month === 1 ? year - 1 : year;
  }
  const d = new Date(monYear, monMonth - 1, startDay);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function runImport(path) {
  const workbook = XLSX.readFile(path);
  const sheetsToImport = workbook.SheetNames.filter((n) => MONTH_SHEETS.includes(n));
  if (sheetsToImport.length === 0) {
    console.error('Ни одного месячного листа не найдено.');
    process.exit(1);
  }

  const db = new Database(dbPath);
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, started_at, ended_at, breaks_minutes, notes) VALUES (?, ?, ?, ?, ?)`
  );
  const insertMonthNote = db.prepare(
    `INSERT INTO month_notes (month_key, summary) VALUES (?, ?) ON CONFLICT(month_key) DO UPDATE SET summary = excluded.summary`
  );
  const insertWeekNote = db.prepare(
    `INSERT INTO week_notes (week_key, summary, goals) VALUES (?, ?, ?)
     ON CONFLICT(week_key) DO UPDATE SET summary = excluded.summary, goals = excluded.goals`
  );

  let imported = 0;
  let skipped = 0;
  let weekNotesImported = 0;

  for (const sheetName of sheetsToImport) {
    const sheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    let sheetYear = null;
    let lastDateOnly = null; // дата предыдущей строки (для объединённых ячеек в K)

    for (let ri = 0; ri < raw.length; ri++) {
      const row = raw[ri];
      if (isSkipRow(row)) continue;

      const time = parseTimeRange(row[COL_L]);
      if (!time) continue;

      // Дату берём с учётом объединённых ячеек (значение может быть только в первой строке merge)
      const kVal = getCellWithMerges(sheet, ri, COL_K) ?? row[COL_K];
      const dateFromK = parseDate(kVal);
      const date = dateFromK ? dateOnly(dateFromK) : lastDateOnly;
      if (!date) continue;

      if (dateFromK) lastDateOnly = date;
      if (!sheetYear) sheetYear = date.getFullYear();

      const start = toISODateTime(date, time.startH, time.startM);
      let endDate = date;
      if (time.endNextDay) {
        endDate = new Date(date);
        endDate.setDate(endDate.getDate() + 1);
      }
      const end = toISODateTime(endDate, time.endH, time.endM);

      const breaksRaw = row[COL_M];
      const breaks = Math.max(0, parseInt(breaksRaw, 10) || 0);
      const notes = (row[COL_O] != null ? String(row[COL_O]).trim() : '') || '';

      insertSession.run(randomUUID(), start, end, breaks, notes);
      imported++;
      prevEndedNextDay = time.endNextDay;
    }

    if (monthNum && sheetYear != null) {
      const monthKey = `${sheetYear}-${String(monthNum).padStart(2, '0')}`;
      const summary = getCell(sheet, 'B7');
      if (summary) {
        insertMonthNote.run(monthKey, summary);
      }
    }

    // Итоги недели и цели: сканируем блоки в L
    let currentWeekKey = null;
    let summaryLines = [];
    let goalLines = [];
    let mode = null; // 'summary' | 'goals'
    for (let ri = 0; ri < raw.length; ri++) {
      const row = raw[ri];
      const lVal = getCellWithMerges(sheet, ri, COL_L) ?? row[COL_L];
      const lStr = (lVal != null ? String(lVal).trim() : '') || '';
      if (lStr.startsWith('Неделя')) {
        if (currentWeekKey && (summaryLines.length || goalLines.length)) {
          const summary = summaryLines.join('\n').trim();
          const goals = goalLines.map((t) => ({ text: t.replace(/^\s*[-–]\s*/, '').trim(), status: 'pending' })).filter((g) => g.text);
          insertWeekNote.run(currentWeekKey, summary, JSON.stringify(goals));
          weekNotesImported++;
        }
        currentWeekKey = parseWeekKeyFromHeader(lStr);
        summaryLines = [];
        goalLines = [];
        mode = null;
        continue;
      }
      if (lStr.startsWith('Итоги недели')) {
        mode = 'summary';
        continue;
      }
      if (lStr.startsWith('Цели на следующую')) {
        mode = 'goals';
        continue;
      }
      if (!currentWeekKey) continue;
      if (mode === 'summary' && lStr && !lStr.startsWith('Цели')) {
        summaryLines.push(lStr);
      }
      if (mode === 'goals' && lStr && (lStr.startsWith('-') || lStr.startsWith('–'))) {
        goalLines.push(lStr);
      }
    }
    if (currentWeekKey && (summaryLines.length || goalLines.length)) {
      const summary = summaryLines.join('\n').trim();
      const goals = goalLines.map((t) => ({ text: t.replace(/^\s*[-–]\s*/, '').trim(), status: 'pending' })).filter((g) => g.text);
      insertWeekNote.run(currentWeekKey, summary, JSON.stringify(goals));
      weekNotesImported++;
    }
  }

  const count = db.prepare('SELECT COUNT(*) as n FROM sessions').get();
  const range = db.prepare('SELECT MIN(started_at) as first, MAX(started_at) as last FROM sessions').get();
  db.close();

  console.log(`Импортировано сессий: ${imported}, пропущено строк: ${skipped}.`);
  console.log(`Импортировано итогов/целей недель: ${weekNotesImported}.`);
  console.log(`В БД всего сессий: ${count.n}. Период: ${range.first ?? '—'} … ${range.last ?? '—'}.`);
}

const excelPath = process.argv[2] || process.env.EXCEL_PATH;
const doInspect = process.argv.includes('--inspect');

if (!excelPath) {
  console.log('Использование:');
  console.log('  node import-from-excel.js "путь\\к\\файлу.xlsm" --inspect [Лист]');
  console.log('  node import-from-excel.js "путь\\к\\файлу.xlsm"');
  process.exit(1);
}

const inspectIdx = process.argv.indexOf('--inspect');
const sheetForInspect = inspectIdx >= 0 && process.argv[inspectIdx + 1] && !process.argv[inspectIdx + 1].startsWith('-')
  ? process.argv[inspectIdx + 1]
  : null;

if (doInspect) {
  inspect(excelPath, sheetForInspect);
} else {
  runImport(excelPath);
}
