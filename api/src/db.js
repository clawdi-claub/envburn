import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'envburn.db');

// Ensure data directory exists
import { mkdirSync } from 'fs';
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS secrets (
    id TEXT PRIMARY KEY,
    encrypted_data TEXT NOT NULL,
    nonce TEXT NOT NULL,
    burn_after_read INTEGER NOT NULL DEFAULT 1,
    expires_at INTEGER NOT NULL,
    views_remaining INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    burned_at INTEGER,
    ip_hash TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_secrets_expires ON secrets(expires_at);
`);

// Cleanup expired secrets every 60s
setInterval(() => {
  db.prepare('DELETE FROM secrets WHERE expires_at < unixepoch() OR (burned_at IS NOT NULL)').run();
}, 60_000);

export default db;
