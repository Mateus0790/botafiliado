import { searchShopeePromotions } from '../services/shopee.js';
import { searchAliExpressPromoCodes } from '../services/aliexpress.js';
import { STORES, storeEnabled } from '../services/stores.js';
import { autoConfig, withinHours } from './autopost.js';
import { postCoupon } from './coupons.js';

/**
 * Cupons automáticos: só divulga promoções e códigos reais que as APIs de afiliados devolvem
 * (campanhas da Shopee e promo_code_info do AliExpress), já com o link de afiliado. O Mercado
 * Livre não tem nada parecido na API. Cada cupom achado é salvo na página Cupons e postado uma vez.
 */
const CHECK_EVERY_MS = 5 * 60_000;
const SEEN_KEY = 'auto_coupon_keys';
const SEEN_LIMIT = 1000;
const LAST_RUN_KEY = 'auto_coupon_last';
const INDEX_KEY = 'auto_coupon_index';

export function autoCouponConfig(env = process.env) {
  const number = (value, fallback) => (value === undefined || value === '' || Number.isNaN(Number(value)) ? fallback : Number(value));
  return {
    enabled: env.AUTO_COUPONS_ENABLED === 'true',
    intervalHours: Math.max(1, number(env.AUTO_COUPONS_INTERVAL_H, 6)),
    perRun: Math.max(1, number(env.AUTO_COUPONS_PER_RUN, 1))
  };
}

const ready = (id, env) => storeEnabled(id, env) && STORES[id].configured(env);

/** Fontes de cupom das lojas ativas com credenciais. O AliExpress busca pela próxima palavra do rodízio. */
export function couponSources(store, env = process.env) {
  const sources = [];
  if (ready('shopee', env)) sources.push({ id: 'shopee', find: () => searchShopeePromotions() });
  const { terms } = autoConfig(env);
  if (ready('aliexpress', env) && terms.length) {
    sources.push({ id: 'aliexpress', find: () => {
      const index = Number(store.getSetting(INDEX_KEY) || 0) % terms.length;
      store.setSetting(INDEX_KEY, String(index + 1));
      return searchAliExpressPromoCodes(terms[index].keyword);
    } });
  }
  return sources;
}

function seenKeys(store) {
  try { return JSON.parse(store.getSetting(SEEN_KEY) || '[]'); } catch { return []; }
}

/** Válido agora, ainda não divulgado (nem cadastrado à mão com o mesmo código ou link). */
export function freshCoupons(candidates, store, now = new Date()) {
  const seen = new Set(seenKeys(store));
  const existing = store.listCoupons();
  const taken = (coupon) => existing.some((other) => other.platform === coupon.platform
    && ((coupon.code && other.code === coupon.code) || other.affiliateUrl === coupon.affiliateUrl || other.url === coupon.url));
  const unique = new Map();
  for (const coupon of candidates) {
    if (seen.has(coupon.key) || unique.has(coupon.key) || taken(coupon)) continue;
    if (coupon.startsAt && new Date(coupon.startsAt) > now) continue;
    if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) continue;
    unique.set(coupon.key, coupon);
  }
  return [...unique.values()];
}

/** Uma rodada: busca em cada loja, escolhe alternando entre elas, salva na página Cupons e posta. */
export async function runAutoCoupons({ client, store, now = new Date(), sources = couponSources(store), post = postCoupon, force = false }) {
  const config = autoCouponConfig();
  if (!sources.length) return { posted: [], reason: 'Nenhuma loja com cupons automáticos configurada (Shopee, ou AliExpress com palavras-chave).' };
  if (!force && !withinHours(now, autoConfig())) return { posted: [], reason: 'Fora do horário de postagem.' };

  const errors = [];
  const lists = [];
  for (const source of sources) {
    try { lists.push(freshCoupons(await source.find(), store, now)); } catch (error) { errors.push(`${STORES[source.id]?.label ?? source.id}: ${error.message}`); }
  }
  // Alterna entre as lojas: Shopee, AliExpress, Shopee…
  const picked = [];
  for (let index = 0; picked.length < config.perRun && lists.some((list) => index < list.length); index += 1) {
    for (const list of lists) if (list[index] && picked.length < config.perRun) picked.push(list[index]);
  }
  store.setSetting(LAST_RUN_KEY, String(now.getTime()));
  if (!picked.length) return { posted: [], errors, reason: errors.length ? 'Não consegui buscar cupons.' : 'Nenhum cupom ou promoção nova encontrada.' };

  const posted = [];
  const sentTo = new Set();
  for (const found of picked) {
    const { key, startsAt, ...fields } = found;
    store.setSetting(SEEN_KEY, JSON.stringify([...seenKeys(store), key].slice(-SEEN_LIMIT)));
    const id = store.saveCoupon({ ...fields, repeatHours: 0, active: true });
    try {
      const result = await post(store, store.getCoupon(id), { client, now });
      result.sent.forEach((name) => sentTo.add(name));
      errors.push(...result.errors);
      posted.push(found);
    } catch (error) { errors.push(`"${found.title}": ${error.message}`); }
  }
  return { posted, sentTo: [...sentTo], errors };
}

export function startAutoCoupons({ getClient, store, logger = console, notify = async () => {} }) {
  let running = false;
  const tick = async ({ force = false } = {}) => {
    const config = autoCouponConfig();
    const last = Number(store.getSetting(LAST_RUN_KEY) || 0);
    if (running || (!force && (!config.enabled || Date.now() - last < config.intervalHours * 3_600_000))) return null;
    running = true;
    try {
      const result = await runAutoCoupons({ client: getClient(), store, force });
      logger.log(`[cupons-auto] ${result.posted.length ? `postou ${result.posted.map((coupon) => `"${coupon.title}"`).join(', ')} em ${result.sentTo.join(' + ')}` : result.reason}`);
      for (const error of result.errors ?? []) {
        logger.error(`[cupons-auto] ${error}`);
        notify(`⚠️ Cupons automáticos: ${error}`);
      }
      return result;
    } catch (error) {
      logger.error(`[cupons-auto] falha: ${error.message}`);
      return { posted: [], reason: `Erro: ${error.message}`, errors: [] };
    } finally { running = false; }
  };
  const timer = setInterval(tick, CHECK_EVERY_MS);
  return { runNow: () => tick({ force: true }), stop: () => clearInterval(timer) };
}
