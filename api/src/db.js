import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

var __dirname = dirname(fileURLToPath(import.meta.url));
var DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'envburn.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

var db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec([
  'CREATE TABLE IF NOT EXISTS secrets (',
  '  id TEXT PRIMARY KEY,',
  '  encrypted_data TEXT NOT NULL,',
  '  nonce TEXT NOT NULL,',
  '  burn_after_read INTEGER NOT NULL DEFAULT 1,',
  '  expires_at INTEGER NOT NULL,',
  '  views_remaining INTEGER NOT NULL DEFAULT 1,',
  '  created_at INTEGER NOT NULL DEFAULT (unixepoch()),',
  '  burned_at INTEGER,',
  '  ip_hash TEXT,',
  '  owner_email TEXT',
  ');',
  '',
  'CREATE INDEX IF NOT EXISTS idx_secrets_expires ON secrets(expires_at);',
  '',
  'CREATE TABLE IF NOT EXISTS subscribers (',
  '  email TEXT PRIMARY KEY,',
  '  stripe_customer_id TEXT,',
  '  stripe_subscription_id TEXT,',
  '  tier TEXT NOT NULL DEFAULT \'free\',',
  '  created_at INTEGER NOT NULL DEFAULT (unixepoch()),',
  '  updated_at INTEGER NOT NULL DEFAULT (unixepoch())',
  ');',
].join('\n'));

// Add owner_email column if missing (migration)
try { db.exec('ALTER TABLE secrets ADD COLUMN owner_email TEXT'); } catch (e) { /* already exists */ }
// Add pro_code column if missing (migration)
try { db.exec('ALTER TABLE subscribers ADD COLUMN pro_code TEXT'); } catch (e) { /* already exists */ }

// Idempotency table for Stripe events
db.exec([
  'CREATE TABLE IF NOT EXISTS processed_events (',
  '  event_id TEXT PRIMARY KEY,',
  '  processed_at INTEGER NOT NULL DEFAULT (unixepoch())',
  ');',
].join('\n'));

// Cleanup old processed events every 60s (keep 24h)
setInterval(function() {
  db.prepare('DELETE FROM processed_events WHERE processed_at < unixepoch() - 86400').run();
}, 60000);

// Cleanup expired/burned secrets every 60s
setInterval(function() {
  db.prepare('DELETE FROM secrets WHERE expires_at < unixepoch() OR burned_at IS NOT NULL').run();
}, 60000);

// Subscriber helpers
export function getSubscriber(email) {
  return db.prepare('SELECT * FROM subscribers WHERE email = ?').get(email);
}

export function upsertSubscriber(email, customerId, subscriptionId, tier) {
  db.prepare([
    'INSERT INTO subscribers (email, stripe_customer_id, stripe_subscription_id, tier, updated_at)',
    'VALUES (?, ?, ?, ?, unixepoch())',
    'ON CONFLICT(email) DO UPDATE SET',
    '  stripe_customer_id = excluded.stripe_customer_id,',
    '  stripe_subscription_id = excluded.stripe_subscription_id,',
    '  tier = excluded.tier,',
    '  updated_at = unixepoch()',
  ].join(' ')).run(email, customerId, subscriptionId, tier);
}

export function downgradeByCustomerId(customerId) {
  db.prepare("UPDATE subscribers SET tier = 'free', updated_at = unixepoch() WHERE stripe_customer_id = ?").run(customerId);
}

export function isPro(email) {
  if (!email) return false;
  var row = db.prepare("SELECT tier FROM subscribers WHERE email = ?").get(email);
  return !!(row && row.tier === 'pro');
}

export function generateProCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function setProCode(email, code) {
  db.prepare('UPDATE subscribers SET pro_code = ? WHERE email = ?').run(code, email);
}

export function getProCode(email) {
  var row = db.prepare('SELECT pro_code FROM subscribers WHERE email = ?').get(email);
  return row ? row.pro_code : null;
}

export function verifyProCode(email, code) {
  if (!email || !code) return false;
  var row = db.prepare("SELECT pro_code, tier FROM subscribers WHERE email = ?").get(email);
  return !!(row && row.tier === 'pro' && row.pro_code === String(code));
}

export function isEventProcessed(eventId) {
  return !!db.prepare('SELECT 1 FROM processed_events WHERE event_id = ?').get(eventId);
}

export function markEventProcessed(eventId) {
  db.prepare('INSERT OR IGNORE INTO processed_events (event_id) VALUES (?)').run(eventId);
}

export default db;
