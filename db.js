import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'devlog.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    breaks_minutes INTEGER NOT NULL DEFAULT 0,
    notes TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS month_notes (
    month_key TEXT PRIMARY KEY,
    summary TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS week_notes (
    week_key TEXT PRIMARY KEY,
    summary TEXT,
    goals TEXT
  )
`);

export function getAllSessions() {
  return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all();
}

export function getSessionsByMonth(year, month) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = `${year}-${String(month).padStart(2, '0')}-31`;
  return db
    .prepare(
      `SELECT * FROM sessions 
       WHERE date(started_at) >= date(?) AND date(started_at) <= date(?) 
       ORDER BY started_at ASC`
    )
    .all(start, end);
}

export function getSessionsByDateRange(from, to) {
  return db
    .prepare(
      `SELECT * FROM sessions 
       WHERE date(started_at) >= date(?) AND date(started_at) <= date(?) 
       ORDER BY started_at ASC`
    )
    .all(from, to);
}

export function createSession({ id, started_at, ended_at, breaks_minutes = 0, notes = '' }) {
  db.prepare(
    `INSERT INTO sessions (id, started_at, ended_at, breaks_minutes, notes) 
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, started_at, ended_at, breaks_minutes, notes ?? '');
  return { id, started_at, ended_at, breaks_minutes, notes };
}

export function updateSession(id, { started_at, ended_at, breaks_minutes, notes }) {
  const stmt = db.prepare(
    `UPDATE sessions SET started_at = ?, ended_at = ?, breaks_minutes = ?, notes = ? 
     WHERE id = ?`
  );
  stmt.run(started_at, ended_at, breaks_minutes ?? 0, notes ?? '', id);
}

export function deleteSession(id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function getTotalStudiedMinutes() {
  const rows = db.prepare('SELECT started_at, ended_at, breaks_minutes FROM sessions').all();
  let total = 0;
  for (const r of rows) {
    const start = new Date(r.started_at).getTime();
    const end = new Date(r.ended_at).getTime();
    const duration = Math.round((end - start) / 60000);
    total += Math.max(0, duration - (Number(r.breaks_minutes) || 0));
  }
  return total;
}

export function getMonthNote(monthKey) {
  const row = db.prepare('SELECT summary FROM month_notes WHERE month_key = ?').get(monthKey);
  return row ? row.summary : null;
}

export function setMonthNote(monthKey, summary) {
  db.prepare(
    'INSERT INTO month_notes (month_key, summary) VALUES (?, ?) ON CONFLICT(month_key) DO UPDATE SET summary = ?'
  ).run(monthKey, summary ?? '', summary ?? '');
}

export function getWeekNote(weekKey) {
  const row = db.prepare('SELECT summary, goals FROM week_notes WHERE week_key = ?').get(weekKey);
  if (!row) return { summary: null, goals: [] };
  const goals = row.goals ? JSON.parse(row.goals) : [];
  return { summary: row.summary, goals };
}

export function setWeekNote(weekKey, summary, goals) {
  const current = db.prepare('SELECT summary, goals FROM week_notes WHERE week_key = ?').get(weekKey);
  const prevSummary = current ? current.summary : '';
  const prevGoals = current && current.goals ? current.goals : '[]';
  const newSummary = summary !== undefined && summary !== null ? summary : prevSummary;
  const newGoalsStr =
    goals !== undefined && goals !== null && Array.isArray(goals)
      ? JSON.stringify(goals)
      : prevGoals;
  db.prepare(
    `INSERT INTO week_notes (week_key, summary, goals) VALUES (?, ?, ?)
     ON CONFLICT(week_key) DO UPDATE SET summary = excluded.summary, goals = excluded.goals`
  ).run(weekKey, newSummary ?? '', newGoalsStr);
}

export default db;
