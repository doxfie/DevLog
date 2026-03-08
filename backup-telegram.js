import { promises as fs } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Omsk';
const DEFAULT_HOUR = 4;
const DEFAULT_MINUTE = 10;
const DEFAULT_KEEP_FILES = 14;
const LOCK_FILE_NAME = '.telegram-backup.lock';

function getEnvBoolean(name, fallback = true) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseIntWithFallback(value, fallback, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const precision = value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[index]}`;
}

function getNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const dateKey = `${map.year}-${map.month}-${map.day}`;
  const timestamp = `${map.year}${map.month}${map.day}-${map.hour}${map.minute}${map.second}`;

  return {
    dateKey,
    timestamp,
    hour: Number.parseInt(map.hour, 10),
    minute: Number.parseInt(map.minute, 10)
  };
}

function formatOmskDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function getConfigFromEnv() {
  const dbPath = process.env.DB_PATH || join(__dirname, 'devlog.db');
  const backupDir = process.env.BACKUP_TELEGRAM_DIR || join(dirname(dbPath), 'backups');

  return {
    enabled: getEnvBoolean('BACKUP_TELEGRAM_ENABLED', true),
    autoRun: getEnvBoolean('BACKUP_TELEGRAM_AUTORUN', true),
    hour: parseIntWithFallback(process.env.BACKUP_TELEGRAM_HOUR, DEFAULT_HOUR, 0, 23),
    minute: parseIntWithFallback(process.env.BACKUP_TELEGRAM_MINUTE, DEFAULT_MINUTE, 0, 59),
    keepFiles: parseIntWithFallback(process.env.BACKUP_TELEGRAM_KEEP_FILES, DEFAULT_KEEP_FILES, 0, 3650),
    checkEveryMs: parseIntWithFallback(process.env.BACKUP_TELEGRAM_CHECK_EVERY_MS, 30_000, 10_000, 300_000),
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_BACKUP_CHAT_ID || '',
    threadId: process.env.TELEGRAM_BACKUP_THREAD_ID || '',
    dbPath,
    backupDir
  };
}

async function ensureDirectory(pathToDir) {
  await fs.mkdir(pathToDir, { recursive: true });
}

async function fileExists(pathToFile) {
  try {
    await fs.access(pathToFile);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock(lockPath) {
  await ensureDirectory(dirname(lockPath));
  try {
    const handle = await fs.open(lockPath, 'wx');
    await handle.writeFile(String(process.pid));
    return handle;
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new Error('Backup already in progress.');
    }
    throw error;
  }
}

async function releaseLock(lockPath, handle) {
  if (handle) {
    try {
      await handle.close();
    } catch {
      // no-op
    }
  }
  try {
    await fs.unlink(lockPath);
  } catch {
    // no-op
  }
}

async function createDatabaseBackup(dbPath, backupFilePath) {
  const source = new Database(dbPath, { fileMustExist: true });
  try {
    await source.backup(backupFilePath);
  } finally {
    source.close();
  }
}

async function pruneBackups(backupDir, keepFiles, logger = console) {
  if (keepFiles <= 0) return;

  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^devlog-backup-\d{8}-\d{6}\.db$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  const toDelete = files.slice(keepFiles);
  if (!toDelete.length) return;

  await Promise.all(
    toDelete.map(async (name) => {
      const pathToDelete = join(backupDir, name);
      await fs.unlink(pathToDelete);
      logger.info(`[backup] Removed old backup: ${name}`);
    })
  );
}

function buildCaption({ filename, sizeBytes, reason }) {
  const reasonLabel = reason === 'scheduled'
    ? '\u043f\u043e \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u044e'
    : '\u0432\u0440\u0443\u0447\u043d\u0443\u044e';

  return [
    '\u{1F5C4} #backup_success',
    '\u2705 \u0411\u044d\u043a\u0430\u043f \u0443\u0441\u043f\u0435\u0448\u043d\u043e \u0441\u043e\u0437\u0434\u0430\u043d',
    'DevLog backup',
    '\u{1F433} \u0411\u0414: Docker',
    '\u{1F4C1} \u0411\u0414 + \u0434\u0438\u0440\u0435\u043a\u0442\u043e\u0440\u0438\u044f',
    `\u{1F4CF} \u0420\u0430\u0437\u043c\u0435\u0440: ${formatBytes(sizeBytes)}`,
    `\u{1F4C5} \u0414\u0430\u0442\u0430 (${APP_TIMEZONE}): ${formatOmskDateTime(new Date())}`,
    `\u{1F680} \u0417\u0430\u043f\u0443\u0441\u043a: ${reasonLabel}`,
    `\u{1F4CE} ${filename}`
  ].join('\n');
}

async function sendBackupToTelegram({ token, chatId, threadId, backupPath, caption }) {
  const endpoint = `https://api.telegram.org/bot${token}/sendDocument`;
  const buffer = await fs.readFile(backupPath);

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  if (threadId) form.append('message_thread_id', threadId);
  form.append('document', new Blob([buffer], { type: 'application/octet-stream' }), basename(backupPath));

  const response = await fetch(endpoint, {
    method: 'POST',
    body: form
  });

  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`Telegram API ${response.status}: ${payloadText}`);
  }
}

export async function runTelegramBackup({ logger = console, reason = 'manual' } = {}) {
  const config = getConfigFromEnv();

  if (!config.enabled) {
    const message = 'Telegram backup is disabled by BACKUP_TELEGRAM_ENABLED=false.';
    logger.info(`[backup] ${message}`);
    return { skipped: true, reason: message };
  }

  if (!config.token || !config.chatId) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_BACKUP_CHAT_ID.');
  }

  const dbExists = await fileExists(config.dbPath);
  if (!dbExists) {
    throw new Error(`Database file does not exist: ${config.dbPath}`);
  }

  await ensureDirectory(config.backupDir);
  const lockPath = join(config.backupDir, LOCK_FILE_NAME);
  const lockHandle = await acquireLock(lockPath);

  try {
    const { timestamp } = getNowParts();
    const fileName = `devlog-backup-${timestamp}.db`;
    const backupPath = join(config.backupDir, fileName);

    logger.info(`[backup] Starting backup (${reason})...`);
    await createDatabaseBackup(config.dbPath, backupPath);

    const stat = await fs.stat(backupPath);
    const caption = buildCaption({
      filename: fileName,
      sizeBytes: stat.size,
      reason
    });

    await sendBackupToTelegram({
      token: config.token,
      chatId: config.chatId,
      threadId: config.threadId,
      backupPath,
      caption
    });

    await pruneBackups(config.backupDir, config.keepFiles, logger);

    logger.info(`[backup] Sent to Telegram: ${fileName} (${formatBytes(stat.size)}).`);
    return {
      ok: true,
      backupPath,
      fileName,
      sizeBytes: stat.size
    };
  } finally {
    await releaseLock(lockPath, lockHandle);
  }
}

export function startTelegramBackupScheduler({ logger = console } = {}) {
  const config = getConfigFromEnv();

  if (!config.enabled) {
    logger.info('[backup] Scheduler disabled (BACKUP_TELEGRAM_ENABLED=false).');
    return () => {};
  }

  if (!config.autoRun) {
    logger.info('[backup] Scheduler disabled (BACKUP_TELEGRAM_AUTORUN=false).');
    return () => {};
  }

  if (!config.token || !config.chatId) {
    logger.warn('[backup] Scheduler is not started: missing TELEGRAM_BOT_TOKEN or TELEGRAM_BACKUP_CHAT_ID.');
    return () => {};
  }

  let running = false;
  let lastRunDateKey = null;

  const tick = async () => {
    if (running) return;

    const now = getNowParts();
    if (now.hour !== config.hour || now.minute !== config.minute) return;
    if (lastRunDateKey === now.dateKey) return;

    running = true;
    try {
      await runTelegramBackup({ logger, reason: 'scheduled' });
      lastRunDateKey = now.dateKey;
    } catch (error) {
      logger.error(`[backup] Scheduled backup failed: ${error.message}`);
    } finally {
      running = false;
    }
  };

  tick().catch((error) => logger.error(`[backup] Initial scheduler tick failed: ${error.message}`));

  const timerId = setInterval(() => {
    tick().catch((error) => logger.error(`[backup] Scheduler tick failed: ${error.message}`));
  }, config.checkEveryMs);

  if (typeof timerId.unref === 'function') {
    timerId.unref();
  }

  logger.info(
    `[backup] Scheduler started: daily at ${String(config.hour).padStart(2, '0')}:${String(config.minute).padStart(2, '0')} (${APP_TIMEZONE}).`
  );

  return () => clearInterval(timerId);
}
