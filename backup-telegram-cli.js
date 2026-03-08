import { runTelegramBackup } from './backup-telegram.js';

try {
  const result = await runTelegramBackup({ reason: 'manual' });
  if (result && result.ok) {
    console.log(`[backup] Done: ${result.fileName}`);
  } else if (result && result.skipped) {
    console.log(`[backup] Skipped: ${result.reason}`);
  }
} catch (error) {
  console.error(`[backup] Failed: ${error.message}`);
  process.exit(1);
}
