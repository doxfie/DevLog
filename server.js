import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as db from './db.js';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;

const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASS_HASH = process.env.AUTH_PASS_HASH || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'devlog-dev-secret-change-me';

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// --- Auth routes (public) ---

app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  res.sendFile(join(__dirname, 'public', 'login.html'));
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!AUTH_PASS_HASH) {
    // No password configured — skip auth (dev mode)
    req.session.authenticated = true;
    return res.redirect('/');
  }

  if (username === AUTH_USER && await bcrypt.compare(password || '', AUTH_PASS_HASH)) {
    req.session.authenticated = true;
    return res.redirect('/');
  }

  res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Auth middleware ---

function requireAuth(req, res, next) {
  if (!AUTH_PASS_HASH) return next(); // dev mode: no password = no auth
  if (req.session && req.session.authenticated) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login');
}

app.use(requireAuth);

// --- Static files (protected) ---

app.use(express.static(join(__dirname, 'public')));

// --- API routes ---

app.get('/api/now', (req, res) => {
  const now = new Date();
  const date = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Omsk' });
  const time = now.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Omsk',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  res.json({ date, time });
});

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

app.delete('/api/sessions/:id', (req, res) => {
  try {
    db.deleteSession(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

app.get('/api/stats', (req, res) => {
  try {
    const totalStudiedMinutes = db.getTotalStudiedMinutes();
    const info = db.getSessionsInfo();
    res.json({ totalStudiedMinutes, ...info });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
