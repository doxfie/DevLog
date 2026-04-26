import { createHash, randomUUID } from 'crypto';
import { promises as fs, readFileSync, createReadStream, createWriteStream } from 'fs';
import net from 'net';
import { basename, dirname, join } from 'path';
import tls from 'tls';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Omsk';
const APP_VERSION = (() => {
  try {
    const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
    return String(packageJson.version || 'unknown');
  } catch {
    return 'unknown';
  }
})();
const DEFAULT_HOUR = 4;
const DEFAULT_MINUTE = 10;
const DEFAULT_KEEP_FILES = 14;
const DEFAULT_TELEGRAM_REQUEST_TIMEOUT_MS = 120_000;
const TELEGRAM_API_HOST = 'api.telegram.org';
const TELEGRAM_API_PORT = 443;
const LOCK_FILE_NAME = '.telegram-backup.lock';
const LAST_SENT_HASH_FILE = '.last-telegram-backup.sha256';
const SOCKS_REPLY_MESSAGES = new Map([
  [0x01, 'general SOCKS server failure'],
  [0x02, 'connection not allowed by ruleset'],
  [0x03, 'network unreachable'],
  [0x04, 'host unreachable'],
  [0x05, 'connection refused'],
  [0x06, 'TTL expired'],
  [0x07, 'command not supported'],
  [0x08, 'address type not supported']
]);

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

function formatBackupDateTime(date = new Date()) {
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
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
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
    requestTimeoutMs: parseIntWithFallback(
      process.env.BACKUP_TELEGRAM_REQUEST_TIMEOUT_MS,
      DEFAULT_TELEGRAM_REQUEST_TIMEOUT_MS,
      5_000,
      600_000
    ),
    skipIfUnchanged: getEnvBoolean('BACKUP_TELEGRAM_SKIP_IF_UNCHANGED', true),
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_BACKUP_CHAT_ID || '',
    threadId: process.env.TELEGRAM_BACKUP_THREAD_ID || '',
    telegramProxyUrl: process.env.TELEGRAM_PROXY_URL || '',
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

function hashFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function readLastSentHash(backupDir) {
  const pathToFile = join(backupDir, LAST_SENT_HASH_FILE);
  try {
    const text = await fs.readFile(pathToFile, 'utf8');
    const line = text.trim();
    return line || null;
  } catch {
    return null;
  }
}

async function writeLastSentHash(backupDir, digestHex) {
  await fs.writeFile(join(backupDir, LAST_SENT_HASH_FILE), `${digestHex}\n`, 'utf8');
}

async function createDatabaseBackup(dbPath, backupFilePath) {
  const source = new Database(dbPath, { fileMustExist: true });
  try {
    await source.backup(backupFilePath);
  } finally {
    source.close();
  }
}

async function createGzipArchive(sourceFilePath, archiveFilePath) {
  await pipeline(
    createReadStream(sourceFilePath),
    createGzip({ level: 9 }),
    createWriteStream(archiveFilePath)
  );
}

async function pruneBackups(backupDir, keepFiles, logger = console) {
  if (keepFiles <= 0) return;

  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^devlog-backup-\d{8}-\d{6}\.db\.gz$/.test(entry.name))
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

function buildCaption({ sizeBytes }) {
  return [
    '\u{1F4BE} #backup_success',
    '\u2796\u2796\u2796\u2796\u2796\u2796\u2796\u2796\u2796',
    '\u2705 \u0411\u044d\u043a\u0430\u043f \u0443\u0441\u043f\u0435\u0448\u043d\u043e \u0441\u043e\u0437\u0434\u0430\u043d',
    `\u{1F30A} DevLog: ${APP_VERSION}`,
    '\u{1F4C1} \u0422\u043e\u043b\u044c\u043a\u043e \u0411\u0414',
    `\u{1F4CF} \u0420\u0430\u0437\u043c\u0435\u0440: ${formatBytes(sizeBytes)}`,
    `\u{1F4C5} \u0414\u0430\u0442\u0430: ${formatBackupDateTime(new Date())}`
  ].join('\n');
}

function createAbortSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function escapeMultipartHeaderValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ');
}

function buildMultipartBody({ chatId, caption, threadId, backupPath, buffer }) {
  const boundary = `----devlog-telegram-${randomUUID()}`;
  const chunks = [];

  const appendField = (name, value) => {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      'utf8'
    ));
  };

  appendField('chat_id', chatId);
  appendField('caption', caption);
  if (threadId) appendField('message_thread_id', threadId);

  chunks.push(Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="document"; filename="${escapeMultipartHeaderValue(basename(backupPath))}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n',
    'utf8'
  ));
  chunks.push(buffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

function parseSocksProxyUrl(proxyUrl) {
  let url;
  try {
    url = new URL(proxyUrl);
  } catch {
    throw new Error('Invalid TELEGRAM_PROXY_URL. Expected socks5h://host:port or socks5://host:port.');
  }

  if (!['socks5:', 'socks5h:'].includes(url.protocol)) {
    throw new Error('Unsupported TELEGRAM_PROXY_URL protocol. Use socks5h://host:port or socks5://host:port.');
  }

  const port = url.port ? Number.parseInt(url.port, 10) : 1080;
  if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid TELEGRAM_PROXY_URL host or port.');
  }

  const username = decodeURIComponent(url.username || '');
  const password = decodeURIComponent(url.password || '');
  if (Buffer.byteLength(username) > 255 || Buffer.byteLength(password) > 255) {
    throw new Error('TELEGRAM_PROXY_URL username/password must be 255 bytes or shorter.');
  }

  return {
    host: url.hostname,
    port,
    username,
    password
  };
}

function withTimeout(promise, timeoutMs, message, onTimeout) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      if (typeof onTimeout === 'function') onTimeout();
      reject(new Error(`${message} after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function waitForSocketConnect(socket, timeoutMs) {
  return withTimeout(
    new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    }),
    timeoutMs,
    'SOCKS proxy TCP connect timed out',
    () => socket.destroy()
  );
}

class SocketReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.onData = (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    };
    this.onError = (error) => this.rejectAll(error);
    this.onClose = () => this.rejectAll(new Error('SOCKS proxy closed the connection during handshake.'));

    socket.on('data', this.onData);
    socket.once('error', this.onError);
    socket.once('end', this.onClose);
    socket.once('close', this.onClose);
  }

  readBytes(length, timeoutMs, message) {
    if (this.buffer.length >= length) {
      const chunk = this.buffer.subarray(0, length);
      this.buffer = this.buffer.subarray(length);
      return Promise.resolve(chunk);
    }

    return withTimeout(
      new Promise((resolve, reject) => {
        this.pending.push({ length, resolve, reject });
        this.drain();
      }),
      timeoutMs,
      message,
      () => this.socket.destroy()
    );
  }

  drain() {
    while (this.pending.length && this.buffer.length >= this.pending[0].length) {
      const pending = this.pending.shift();
      const chunk = this.buffer.subarray(0, pending.length);
      this.buffer = this.buffer.subarray(pending.length);
      pending.resolve(chunk);
    }
  }

  rejectAll(error) {
    while (this.pending.length) {
      this.pending.shift().reject(error);
    }
  }

  dispose() {
    this.socket.removeListener('data', this.onData);
    this.socket.removeListener('error', this.onError);
    this.socket.removeListener('end', this.onClose);
    this.socket.removeListener('close', this.onClose);
  }
}

function buildSocksDomainAddress(host) {
  const encodedHost = Buffer.from(host, 'utf8');
  if (encodedHost.length > 255) {
    throw new Error('SOCKS target hostname is too long.');
  }

  return Buffer.concat([Buffer.from([0x03, encodedHost.length]), encodedHost]);
}

async function authenticateSocksProxy(socket, reader, { username, password }, timeoutMs) {
  const hasCredentials = username || password;
  const methods = hasCredentials ? Buffer.from([0x00, 0x02]) : Buffer.from([0x00]);
  socket.write(Buffer.concat([Buffer.from([0x05, methods.length]), methods]));

  const response = await reader.readBytes(2, timeoutMs, 'SOCKS proxy greeting timed out');
  if (response[0] !== 0x05) {
    throw new Error('SOCKS proxy returned an invalid greeting.');
  }

  if (response[1] === 0xff) {
    throw new Error('SOCKS proxy rejected all authentication methods.');
  }

  if (response[1] === 0x00) return;

  if (response[1] !== 0x02 || !hasCredentials) {
    throw new Error('SOCKS proxy requested an unsupported authentication method.');
  }

  const usernameBuffer = Buffer.from(username, 'utf8');
  const passwordBuffer = Buffer.from(password, 'utf8');
  socket.write(Buffer.concat([
    Buffer.from([0x01, usernameBuffer.length]),
    usernameBuffer,
    Buffer.from([passwordBuffer.length]),
    passwordBuffer
  ]));

  const authResponse = await reader.readBytes(2, timeoutMs, 'SOCKS proxy authentication timed out');
  if (authResponse[0] !== 0x01 || authResponse[1] !== 0x00) {
    throw new Error('SOCKS proxy authentication failed.');
  }
}

async function connectViaSocksProxy(proxyUrl, targetHost, targetPort, timeoutMs) {
  const proxy = parseSocksProxyUrl(proxyUrl);
  const socket = net.connect({ host: proxy.host, port: proxy.port });
  socket.setNoDelay(true);

  await waitForSocketConnect(socket, timeoutMs);
  const reader = new SocketReader(socket);

  try {
    await authenticateSocksProxy(socket, reader, proxy, timeoutMs);

    const portBuffer = Buffer.alloc(2);
    portBuffer.writeUInt16BE(targetPort);
    socket.write(Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00]),
      buildSocksDomainAddress(targetHost),
      portBuffer
    ]));

    const responseHead = await reader.readBytes(4, timeoutMs, 'SOCKS proxy connect response timed out');
    if (responseHead[0] !== 0x05) {
      throw new Error('SOCKS proxy returned an invalid connect response.');
    }

    if (responseHead[1] !== 0x00) {
      const message = SOCKS_REPLY_MESSAGES.get(responseHead[1]) || `error code ${responseHead[1]}`;
      throw new Error(`SOCKS proxy connect failed: ${message}.`);
    }

    const addressType = responseHead[3];
    if (addressType === 0x01) {
      await reader.readBytes(6, timeoutMs, 'SOCKS proxy IPv4 bind response timed out');
    } else if (addressType === 0x03) {
      const length = await reader.readBytes(1, timeoutMs, 'SOCKS proxy domain bind response timed out');
      await reader.readBytes(length[0] + 2, timeoutMs, 'SOCKS proxy domain bind response timed out');
    } else if (addressType === 0x04) {
      await reader.readBytes(18, timeoutMs, 'SOCKS proxy IPv6 bind response timed out');
    } else {
      throw new Error('SOCKS proxy returned an unsupported bind address type.');
    }
  } catch (error) {
    socket.destroy();
    throw error;
  } finally {
    reader.dispose();
  }

  return socket;
}

function connectTls(socket, timeoutMs) {
  const tlsSocket = tls.connect({
    socket,
    servername: TELEGRAM_API_HOST,
    ALPNProtocols: ['http/1.1']
  });

  return withTimeout(
    new Promise((resolve, reject) => {
      tlsSocket.once('secureConnect', () => resolve(tlsSocket));
      tlsSocket.once('error', reject);
    }),
    timeoutMs,
    'Telegram TLS handshake timed out',
    () => tlsSocket.destroy()
  );
}

function findCrlf(buffer, start = 0) {
  for (let index = start; index < buffer.length - 1; index += 1) {
    if (buffer[index] === 13 && buffer[index + 1] === 10) return index;
  }
  return -1;
}

function decodeChunkedBody(buffer) {
  const chunks = [];
  let offset = 0;

  while (offset < buffer.length) {
    const lineEnd = findCrlf(buffer, offset);
    if (lineEnd === -1) throw new Error('Telegram API returned an invalid chunked response.');

    const sizeText = buffer.subarray(offset, lineEnd).toString('latin1').split(';')[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) throw new Error('Telegram API returned an invalid chunk size.');

    offset = lineEnd + 2;
    if (size === 0) return Buffer.concat(chunks);

    if (offset + size > buffer.length) throw new Error('Telegram API returned a truncated chunked response.');
    chunks.push(buffer.subarray(offset, offset + size));
    offset += size + 2;
  }

  throw new Error('Telegram API returned an incomplete chunked response.');
}

function parseHttpResponse(buffer) {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) throw new Error('Telegram API returned an invalid HTTP response.');

  const headerText = buffer.subarray(0, headerEnd).toString('latin1');
  const bodyBuffer = buffer.subarray(headerEnd + 4);
  const [statusLine, ...headerLines] = headerText.split('\r\n');
  const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine);
  if (!statusMatch) throw new Error('Telegram API returned an invalid HTTP status line.');

  const headers = new Map();
  for (const line of headerLines) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }

  const body = headers.get('transfer-encoding')?.toLowerCase().includes('chunked')
    ? decodeChunkedBody(bodyBuffer)
    : bodyBuffer;

  return {
    status: Number.parseInt(statusMatch[1], 10),
    bodyText: body.toString('utf8')
  };
}

async function readHttpResponse(socket, timeoutMs) {
  const chunks = [];

  return withTimeout(
    new Promise((resolve, reject) => {
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.once('end', () => resolve(Buffer.concat(chunks)));
      socket.once('error', reject);
    }),
    timeoutMs,
    'Telegram API request timed out',
    () => socket.destroy()
  );
}

async function postTelegramMultipartViaSocksProxy({ proxyUrl, path, body, contentType, timeoutMs }) {
  const tcpSocket = await connectViaSocksProxy(proxyUrl, TELEGRAM_API_HOST, TELEGRAM_API_PORT, timeoutMs);
  const tlsSocket = await connectTls(tcpSocket, timeoutMs);
  const requestHeaders = [
    `POST ${path} HTTP/1.1`,
    `Host: ${TELEGRAM_API_HOST}`,
    'Connection: close',
    'Accept: application/json',
    `Content-Type: ${contentType}`,
    `Content-Length: ${body.length}`,
    '',
    ''
  ].join('\r\n');

  tlsSocket.write(requestHeaders);
  tlsSocket.end(body);

  return parseHttpResponse(await readHttpResponse(tlsSocket, timeoutMs));
}

async function sendBackupToTelegram({ token, chatId, threadId, backupPath, caption, proxyUrl, timeoutMs }) {
  const endpoint = new URL(`/bot${token}/sendDocument`, `https://${TELEGRAM_API_HOST}`);
  const buffer = await fs.readFile(backupPath);

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  if (threadId) form.append('message_thread_id', threadId);
  form.append('document', new Blob([buffer], { type: 'application/octet-stream' }), basename(backupPath));

  if (proxyUrl) {
    const { body, contentType } = buildMultipartBody({ chatId, caption, threadId, backupPath, buffer });
    const response = await postTelegramMultipartViaSocksProxy({
      proxyUrl,
      path: endpoint.pathname,
      body,
      contentType,
      timeoutMs
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Telegram API ${response.status}: ${response.bodyText}`);
    }
    return;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    body: form,
    signal: createAbortSignal(timeoutMs)
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
    const rawFileName = `devlog-backup-${timestamp}.db`;
    const rawBackupPath = join(config.backupDir, rawFileName);
    const fileName = `${rawFileName}.gz`;
    const backupPath = join(config.backupDir, fileName);

    logger.info(`[backup] Starting backup (${reason})...`);
    await createDatabaseBackup(config.dbPath, rawBackupPath);

    const digest = await hashFileSha256(rawBackupPath);

    if (config.skipIfUnchanged) {
      const lastDigest = await readLastSentHash(config.backupDir);
      if (lastDigest && lastDigest === digest) {
        await fs.unlink(rawBackupPath).catch(() => {});
        const message = 'Database unchanged since last successful Telegram backup; skip upload.';
        logger.info(`[backup] ${message}`);
        return { skipped: true, reason: message };
      }
    }

    await createGzipArchive(rawBackupPath, backupPath);
    await fs.unlink(rawBackupPath).catch(() => {});

    const stat = await fs.stat(backupPath);
    const caption = buildCaption({
      sizeBytes: stat.size
    });

    await sendBackupToTelegram({
      token: config.token,
      chatId: config.chatId,
      threadId: config.threadId,
      backupPath,
      caption,
      proxyUrl: config.telegramProxyUrl,
      timeoutMs: config.requestTimeoutMs
    });

    await writeLastSentHash(config.backupDir, digest);
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
