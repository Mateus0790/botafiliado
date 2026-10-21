import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createCache(databasePath = process.env.DATABASE_PATH || './data/botafiliado.sqlite') {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS posted_products (
    platform TEXT NOT NULL, product_id TEXT NOT NULL, posted_at TEXT NOT NULL,
    channel_id TEXT, affiliate_url TEXT NOT NULL,
    PRIMARY KEY (platform, product_id)
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL, title TEXT NOT NULL, code TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL, affiliate_url TEXT NOT NULL, expires_at TEXT, repeat_hours INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, post_count INTEGER NOT NULL DEFAULT 0, last_posted_at TEXT, created_at TEXT NOT NULL
  )`);
  // Bancos criados antes do painel não tinham o título do produto.
  if (!db.prepare('PRAGMA table_info(posted_products)').all().some((column) => column.name === 'title')) {
    db.exec('ALTER TABLE posted_products ADD COLUMN title TEXT');
  }
  const has = db.prepare('SELECT 1 FROM posted_products WHERE platform = ? AND product_id = ?');
  const hasSince = db.prepare('SELECT 1 FROM posted_products WHERE platform = ? AND product_id = ? AND posted_at >= ?');
  // Repostar o mesmo produto (depois do prazo configurado) atualiza o registro existente.
  const add = db.prepare(`INSERT INTO posted_products(platform, product_id, posted_at, channel_id, affiliate_url, title)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, product_id) DO UPDATE SET posted_at = excluded.posted_at, channel_id = excluded.channel_id,
      affiliate_url = excluded.affiliate_url, title = excluded.title`);
  const titlesSince = db.prepare('SELECT title FROM posted_products WHERE posted_at >= ? AND title IS NOT NULL');
  const recent = db.prepare(`SELECT platform, product_id AS id, posted_at AS postedAt, channel_id AS channelId, affiliate_url AS affiliateUrl, title
    FROM posted_products ORDER BY posted_at DESC LIMIT ?`);
  const count = db.prepare('SELECT COUNT(*) AS total FROM posted_products');
  const remove = db.prepare('DELETE FROM posted_products WHERE platform = ? AND product_id = ?');
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setSetting = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const deleteSetting = db.prepare('DELETE FROM settings WHERE key = ?');
  const listSettings = db.prepare("SELECT key, value FROM settings WHERE key LIKE ? ESCAPE '\\'");
  const couponColumns = `id, platform, title, code, description, url, affiliate_url AS affiliateUrl, expires_at AS expiresAt,
    repeat_hours AS repeatHours, active, post_count AS postCount, last_posted_at AS lastPostedAt, created_at AS createdAt`;
  const listCoupons = db.prepare(`SELECT ${couponColumns} FROM coupons ORDER BY active DESC, created_at DESC`);
  const getCoupon = db.prepare(`SELECT ${couponColumns} FROM coupons WHERE id = ?`);
  const insertCoupon = db.prepare(`INSERT INTO coupons(platform, title, code, description, url, affiliate_url, expires_at, repeat_hours, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updateCoupon = db.prepare(`UPDATE coupons SET platform = ?, title = ?, code = ?, description = ?, url = ?, affiliate_url = ?,
    expires_at = ?, repeat_hours = ?, active = ? WHERE id = ?`);
  const couponPosted = db.prepare('UPDATE coupons SET post_count = post_count + 1, last_posted_at = ? WHERE id = ?');
  const setCouponActive = db.prepare('UPDATE coupons SET active = ? WHERE id = ?');
  const deleteCoupon = db.prepare('DELETE FROM coupons WHERE id = ?');
  const toCoupon = (row) => (row ? { ...row, active: Boolean(row.active) } : null);
  return {
    listCoupons: () => listCoupons.all().map(toCoupon),
    getCoupon: (id) => toCoupon(getCoupon.get(id)),
    saveCoupon: (coupon) => {
      const values = [coupon.platform, coupon.title, coupon.code, coupon.description, coupon.url, coupon.affiliateUrl,
        coupon.expiresAt ?? null, coupon.repeatHours, coupon.active ? 1 : 0];
      if (coupon.id) { updateCoupon.run(...values, coupon.id); return coupon.id; }
      return Number(insertCoupon.run(...values, new Date().toISOString()).lastInsertRowid);
    },
    markCouponPosted: (id, at = new Date()) => couponPosted.run(at.toISOString(), id),
    setCouponActive: (id, active) => setCouponActive.run(active ? 1 : 0, id).changes > 0,
    deleteCoupon: (id) => deleteCoupon.run(id).changes > 0,
    /** Sem `since`, considera qualquer postagem; com `since` (Date), só as feitas a partir dela. */
    wasPosted: (platform, productId, since) => Boolean(since ? hasSince.get(platform, productId, since.toISOString()) : has.get(platform, productId)),
    recentTitles: (since) => titlesSince.all(since.toISOString()).map((row) => row.title),
    markPosted: (product, channelId) => add.run(product.platform, product.id, new Date().toISOString(), channelId, product.affiliateUrl, product.title ?? null),
    recentPosts: (limit = 50) => recent.all(limit),
    countPosts: () => count.get().total,
    unmarkPosted: (platform, productId) => remove.run(platform, productId).changes > 0,
    getSetting: (key) => getSetting.get(key)?.value,
    setSetting: (key, value) => setSetting.run(key, value),
    deleteSetting: (key) => deleteSetting.run(key),
    listSettings: (prefix) => listSettings.all(`${prefix.replace(/[\\%_]/g, '\\$&')}%`),
    close: () => db.close()
  };
}
