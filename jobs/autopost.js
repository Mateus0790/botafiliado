import { STORES, autoStores } from '../services/stores.js';
import { publishOffer, destinations } from '../publishers/index.js';
import { searchTerms } from '../services/nichos.js';

const SORTS = new Set(['mais-vendidos', 'maior-comissao', 'relevancia', 'menor-preco', 'maior-preco']);

const MAX_PAGES = 3;

/** Lê a configuração de process.env, onde o painel e o /auto espelham o que salvam (ver utils/config.js). */
export function autoConfig(env = process.env) {
  const number = (value, fallback) => (value === undefined || value === '' || Number.isNaN(Number(value)) ? fallback : Number(value));
  const keywords = (env.AUTO_KEYWORDS ?? '').split(',').map((word) => word.trim()).filter(Boolean);
  const nichos = (env.AUTO_NICHOS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  const [startHour, endHour] = (env.AUTO_HORARIO || '8-23').split('-').map(Number);
  return {
    enabled: env.AUTO_ENABLED === 'true',
    keywords,
    nichos,
    terms: searchTerms(keywords, nichos),
    intervalMin: Math.max(5, number(env.AUTO_INTERVAL_MIN, 60)),
    postsPerRun: Math.max(1, number(env.AUTO_POSTS_PER_RUN, 1)),
    channelId: env.AUTO_CANAL_ID || env.CANAL_POSTAGEM_ID,
    sort: SORTS.has(env.AUTO_SORT) ? env.AUTO_SORT : 'mais-vendidos',
    stores: autoStores(env),
    minRating: number(env.AUTO_MIN_RATING, 4.5),
    minSales: number(env.AUTO_MIN_SALES, 100),
    minCommission: number(env.AUTO_MIN_COMMISSION, 0.03),
    minDiscount: number(env.AUTO_MIN_DISCOUNT, 0),
    minPrice: number(env.AUTO_MIN_PRICE, 0),
    maxPrice: number(env.AUTO_MAX_PRICE, Infinity),
    blockedWords: (env.AUTO_BLOCKED_WORDS ?? '').split(',').map((word) => normalizeText(word).trim()).filter(Boolean),
    repeatDays: Math.max(0, number(env.AUTO_REPEAT_DAYS, 0)),
    startHour: number(startHour, 8),
    endHour: number(endHour, 23)
  };
}

const normalizeText = (text) => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const DAY_MS = 24 * 60 * 60 * 1000;
const VARIANT_WINDOW_DAYS = 7;

// Cores não diferenciam produtos: "Smartwatch D20 azul" e "Smartwatch D20 rosa" são o mesmo.
const COLORS = new Set(['preto', 'preta', 'branco', 'branca', 'azul', 'rosa', 'vermelho', 'vermelha', 'verde', 'cinza', 'amarelo', 'amarela',
  'roxo', 'roxa', 'dourado', 'dourada', 'prata', 'bege', 'marrom', 'laranja', 'lilas', 'grafite', 'nude', 'cor']);

/** Variações do mesmo produto (cor, tamanho, voltagem) costumam repetir as primeiras palavras do título. */
export const titleKey = (title) => (normalizeText(title).match(/[a-z0-9]+/g) ?? []).filter((word) => !COLORS.has(word)).slice(0, 5).join(' ');

export function withinHours(date, { startHour, endHour }) {
  const hour = date.getHours();
  return startHour <= endHour ? hour >= startHour && hour <= endHour : hour >= startHour || hour <= endHour;
}

/**
 * Filtra por qualidade e remove o que já foi postado (ou postado dentro do prazo de repetição)
 * e variações de produtos postados nos últimos 7 dias; mantém a ordem da busca.
 * Métricas null (o Mercado Livre não informa nota, vendas nem comissão) não são filtradas.
 * `seen` acumula as chaves de título já escolhidas na rodada, entre páginas e lojas.
 */
export function pickOffers(products, store, config, count, { now = new Date(), seen } = {}) {
  const atLeast = (value, minimum) => value === null || value === undefined || value >= minimum;
  const since = config.repeatDays > 0 ? new Date(now - config.repeatDays * DAY_MS) : undefined;
  const keys = seen ?? new Set((store.recentTitles?.(new Date(now - VARIANT_WINDOW_DAYS * DAY_MS)) ?? []).map(titleKey));
  const picked = [];
  for (const product of products) {
    if (picked.length >= count) break;
    const title = normalizeText(product.title ?? '');
    const key = titleKey(product.title ?? '');
    const ok = atLeast(product.rating, config.minRating) && atLeast(product.sales, config.minSales)
      && atLeast(product.commissionRate, config.minCommission) && (product.discount ?? 0) >= config.minDiscount
      && (product.priceValue ?? 0) <= config.maxPrice && (product.priceValue === null || product.priceValue === undefined || product.priceValue >= config.minPrice)
      && !config.blockedWords.some((word) => title.includes(word))
      && !store.wasPosted(product.platform, product.id, since)
      && !(key && keys.has(key));
    if (!ok) continue;
    if (key) keys.add(key);
    picked.push(product);
  }
  return picked;
}

/**
 * Uma rodada: próximo par (palavra-chave, loja) do rodízio → busca → filtra → posta.
 * Com 2 palavras e 2 lojas a ordem é: palavra1/loja1, palavra1/loja2, palavra2/loja1, palavra2/loja2.
 * `sources` permite injetar buscas nos testes; por padrão vem das lojas ativas com credenciais.
 */
export async function runAutoPost({ client, store, now = new Date(), search, sources, publish = publishOffer, force = false }) {
  const config = autoConfig();
  const active = sources ?? (search ? [{ id: 'shopee', search }] : config.stores.map((id) => ({ id, search: STORES[id].search })));
  if (!config.terms.length) return { posted: [], reason: 'Nenhuma palavra-chave ou nicho configurado.' };
  if (!active.length) return { posted: [], reason: 'Nenhuma loja ativa com credenciais para a postagem automática (Shopee ou AliExpress).' };
  if (!destinations(config.channelId).length) return { posted: [], reason: 'Nenhum destino configurado (canal do Discord, Telegram, WhatsApp ou Instagram).' };
  if (!force && !withinHours(now, config)) return { posted: [], reason: `Fora do horário de postagem (${config.startHour}h–${config.endHour}h).` };

  const pairs = config.terms.length * active.length;
  const index = Number(store.getSetting('auto_keyword_index') || 0) % pairs;
  const term = config.terms[Math.floor(index / active.length)];
  const { keyword } = term;
  const source = active[index % active.length];
  const storeLabel = STORES[source.id]?.label ?? source.id;
  store.setSetting('auto_keyword_index', String(index + 1));

  const picked = [];
  const seen = new Set((store.recentTitles?.(new Date(now - VARIANT_WINDOW_DAYS * DAY_MS)) ?? []).map(titleKey));
  for (let page = 1; page <= MAX_PAGES && picked.length < config.postsPerRun; page += 1) {
    const { products, hasNextPage } = await source.search(keyword, { sort: config.sort, page, limit: 20, category: term.mlCategory });
    const fresh = pickOffers(products, store, config, config.postsPerRun - picked.length, { now, seen })
      .filter((product) => !picked.some((chosen) => chosen.id === product.id));
    picked.push(...fresh);
    if (!hasNextPage) break;
  }
  if (!picked.length) return { keyword, store: storeLabel, posted: [], reason: `Nenhuma oferta nova para "${keyword}" no ${storeLabel} dentro dos filtros.` };

  const errors = [];
  let sentTo = [];
  for (const product of picked) {
    const result = await publish(product, { client, discordChannelId: config.channelId, store });
    store.markPosted(product, config.channelId || 'telegram');
    sentTo = result.sent;
    errors.push(...result.errors);
  }
  return { keyword, store: storeLabel, posted: picked, sentTo, errors };
}

/**
 * Agenda as rodadas. `getClient` devolve o cliente do Discord atual (ou null), porque o bot
 * pode reconectar quando o token muda no painel. Mudanças de intervalo valem após reschedule().
 */
export function startAutoPost({ getClient, store, logger = console, notify = async () => {} }) {
  let timer = null;
  let running = false;
  let nextRunAt = null;
  let lastRun = null;
  const tick = async ({ force = false } = {}) => {
    if (running) return { posted: [], reason: 'Já existe uma rodada em andamento.' };
    running = true;
    try {
      const result = await runAutoPost({ client: getClient(), store, force });
      logger.log(`[auto] ${result.posted.length ? `postou ${result.posted.length} oferta(s) de "${result.keyword}" (${result.store}) em ${result.sentTo.join(' + ')}` : result.reason}`);
      for (const error of result.errors ?? []) {
        logger.error(`[auto] falha parcial: ${error}`);
        notify(`⚠️ Postagem automática: ${error}`);
      }
      lastRun = { at: new Date().toISOString(), keyword: result.keyword ?? null, store: result.store ?? null, posted: result.posted.map(({ title }) => title), reason: result.reason ?? null, errors: result.errors ?? [] };
      return result;
    } catch (error) {
      logger.error(`[auto] falha na rodada: ${error.message}`);
      notify(`⚠️ A postagem automática falhou: ${error.message}`);
      lastRun = { at: new Date().toISOString(), keyword: null, posted: [], reason: `Erro: ${error.message}`, errors: [] };
      return { posted: [], reason: `Erro: ${error.message}` };
    } finally { running = false; }
  };
  const schedule = () => {
    clearTimeout(timer);
    const delay = autoConfig().intervalMin * 60_000;
    nextRunAt = new Date(Date.now() + delay).toISOString();
    timer = setTimeout(async () => {
      if (autoConfig().enabled) await tick();
      schedule();
    }, delay);
  };
  schedule();
  return {
    runNow: () => tick({ force: true }),
    reschedule: schedule,
    stop: () => clearTimeout(timer),
    state: () => ({ ...autoConfig(), maxPrice: Number.isFinite(autoConfig().maxPrice) ? autoConfig().maxPrice : null, running, nextRunAt, lastRun })
  };
}
