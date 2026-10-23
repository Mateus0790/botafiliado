import { STORES } from '../services/stores.js';
import { publishOffer } from '../publishers/index.js';
import { autoConfig, mlPaused, ML_PAUSE_KEY, pickOffers, withinHours } from './autopost.js';

/**
 * Ofertas urgentes: uma varredura mais frequente que a postagem automática procura, nas palavras-chave
 * e lojas do rodízio, produtos com desconto muito alto (padrão 70% ou mais) e posta na hora, com um
 * título de urgência. Usa os mesmos filtros de qualidade e o mesmo histórico (não repete produto).
 * O desconto é o que a loja informa; a Shopee informa só o percentual, sem o preço antigo.
 */
const CHECK_EVERY_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ML_PAUSE_MS = 6 * 60 * 60 * 1000;
const POSTS_KEY = 'urgent_posts';
const INDEX_KEY = 'urgent_index';
const LAST_RUN_KEY = 'urgent_last';

export function urgentConfig(env = process.env) {
  const number = (value, fallback) => (value === undefined || value === '' || Number.isNaN(Number(value)) ? fallback : Number(value));
  return {
    enabled: env.URGENT_ENABLED === 'true',
    minDiscount: Math.min(99, Math.max(1, number(env.URGENT_MIN_DISCOUNT, 70))),
    intervalMin: Math.max(5, number(env.URGENT_INTERVAL_MIN, 15)),
    maxPerDay: Math.max(1, number(env.URGENT_MAX_PER_DAY, 5)),
    header: env.URGENT_HEADER?.trim() || '🔥 URGENTE: DESCONTO ABSURDO!'
  };
}

const recentPosts = (store, now) => {
  let list = [];
  try { list = JSON.parse(store.getSetting(POSTS_KEY) || '[]'); } catch { /* recomeça a contagem */ }
  return list.filter((time) => now.getTime() - time < DAY_MS);
};

/** Uma varredura: próxima palavra-chave em todas as lojas; posta a oferta com o maior desconto que passou nos filtros. */
export async function runUrgent({ client, store, now = new Date(), sources, publish = publishOffer, force = false }) {
  const config = urgentConfig();
  const auto = autoConfig();
  const active = (sources ?? auto.stores.map((id) => ({ id, search: STORES[id].search })))
    .filter((source) => source.id !== 'mercadolivre' || !mlPaused(store, now));
  if (!auto.terms.length) return { posted: [], reason: 'Nenhuma palavra-chave ou nicho configurado na postagem automática.' };
  if (!active.length) return { posted: [], reason: 'Nenhuma loja ativa com credenciais.' };
  if (!force && !withinHours(now, auto)) return { posted: [], reason: 'Fora do horário de postagem.' };
  const posts = recentPosts(store, now);
  if (posts.length >= config.maxPerDay) return { posted: [], reason: `Limite de ${config.maxPerDay} ofertas urgentes nas últimas 24 h atingido.` };

  const index = Number(store.getSetting(INDEX_KEY) || 0) % auto.terms.length;
  store.setSetting(INDEX_KEY, String(index + 1));
  store.setSetting(LAST_RUN_KEY, String(now.getTime()));
  const term = auto.terms[index];
  const filters = { ...auto, minDiscount: config.minDiscount };
  const errors = [];
  const candidates = [];
  for (const source of active) {
    try {
      const { products } = await source.search(term.keyword, { sort: auto.sort, page: 1, limit: 40, category: term.mlCategory });
      const sorted = [...products].sort((a, b) => (b.discount ?? 0) - (a.discount ?? 0));
      candidates.push(...pickOffers(sorted, store, filters, 1, { now }));
    } catch (error) { errors.push(`${STORES[source.id]?.label ?? source.id}: ${error.message}`); }
  }
  candidates.sort((a, b) => (b.discount ?? 0) - (a.discount ?? 0));
  for (const product of candidates) {
    try {
      const result = await publish({ ...product, header: config.header }, { client, discordChannelId: auto.channelId, store });
      store.markPosted(product, auto.channelId || 'telegram');
      store.setSetting(POSTS_KEY, JSON.stringify([...posts, now.getTime()]));
      return { keyword: term.keyword, posted: [product], sentTo: result.sent, errors: [...errors, ...result.errors] };
    } catch (error) {
      if (product.platform !== 'mercadolivre') throw error;
      // Mercado Livre recusou o link: fica fora por 6 h e tenta a próxima candidata.
      store.setSetting(ML_PAUSE_KEY, String(now.getTime() + ML_PAUSE_MS));
      errors.push(`${error.message} O Mercado Livre fica fora da postagem automática por 6 h.`);
    }
  }
  return { keyword: term.keyword, posted: [], errors, reason: `Nenhum produto com ${config.minDiscount}% OFF ou mais em "${term.keyword}".` };
}

export function startUrgent({ getClient, store, logger = console, notify = async () => {} }) {
  let running = false;
  const tick = async ({ force = false } = {}) => {
    const config = urgentConfig();
    const last = Number(store.getSetting(LAST_RUN_KEY) || 0);
    if (running || (!force && (!config.enabled || Date.now() - last < config.intervalMin * 60_000))) return null;
    running = true;
    try {
      const result = await runUrgent({ client: getClient(), store, force });
      if (result.posted.length) logger.log(`[urgente] postou "${result.posted[0].title}" (${result.posted[0].discount}% OFF) em ${result.sentTo.join(' + ')}`);
      else if (force) logger.log(`[urgente] ${result.reason}`);
      for (const error of result.errors ?? []) {
        logger.error(`[urgente] ${error}`);
        notify(`⚠️ Ofertas urgentes: ${error}`);
      }
      return result;
    } catch (error) {
      logger.error(`[urgente] falha: ${error.message}`);
      notify(`⚠️ Ofertas urgentes falharam: ${error.message}`);
      return { posted: [], reason: `Erro: ${error.message}`, errors: [] };
    } finally { running = false; }
  };
  const timer = setInterval(tick, CHECK_EVERY_MS);
  return { runNow: () => tick({ force: true }), stop: () => clearInterval(timer) };
}
