import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as db from './db.js';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Текущие дата и время в Омске (для автоподстановки на фронте)
app.get('/api/now', (req, res) => {
  const now = new Date();
  const date = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Omsk' }); // YYYY-MM-DD
  const time = now.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Omsk',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }); // HH:mm
  res.json({ date, time });
});

// Список сессий (все или за месяц)
app.get('/api/sessions', (req, res) => {
  try {
    const { year, month } = req.query;
    const list = year && month
      ? db.getSessionsByMonth(year, month)
      : db.getAllSessions();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Добавить сессию (id в body — для undo после удаления)
app.post('/api/sessions', (req, res) => {
  try {
    const { id: bodyId, started_at, ended_at, breaks_minutes = 0, notes = '' } = req.body;
    if (!started_at || !ended_at) {
      return res.status(400).json({ error: 'Нужны started_at и ended_at' });
    }
    const id = bodyId && typeof bodyId === 'string' ? bodyId : randomUUID();
    db.createSession({ id, started_at, ended_at, breaks_minutes, notes });
    res.status(201).json({ id, started_at, ended_at, breaks_minutes, notes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Обновить сессию
app.patch('/api/sessions/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { started_at, ended_at, breaks_minutes, notes } = req.body;
    db.updateSession(id, { started_at, ended_at, breaks_minutes, notes });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Удалить сессию
app.delete('/api/sessions/:id', (req, res) => {
  try {
    db.deleteSession(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Итоги месяца
app.get('/api/month-notes/:monthKey', (req, res) => {
  try {
    const summary = db.getMonthNote(req.params.monthKey);
    res.json({ summary: summary ?? '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/month-notes/:monthKey', (req, res) => {
  try {
    const { summary } = req.body;
    db.setMonthNote(req.params.monthKey, summary);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Сводка: всего часов за всё время
app.get('/api/stats', (req, res) => {
  try {
    const totalStudiedMinutes = db.getTotalStudiedMinutes();
    res.json({ totalStudiedMinutes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Итоги и цели по неделям
app.get('/api/week-notes/:weekKey', (req, res) => {
  try {
    const note = db.getWeekNote(req.params.weekKey);
    res.json(note);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/week-notes/:weekKey', (req, res) => {
  try {
    const { summary, goals } = req.body;
    db.setWeekNote(req.params.weekKey, summary, goals);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(port, () => {
  console.log(`DevLog: http://localhost:${port}`);
});
