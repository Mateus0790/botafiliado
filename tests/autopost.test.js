import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { autoConfig, pickOffers, runAutoPost, withinHours } from '../jobs/autopost.js';

const AUTO_KEYS = ['AUTO_KEYWORDS', 'AUTO_ENABLED', 'AUTO_INTERVAL_MIN', 'AUTO_POSTS_PER_RUN', 'AUTO_CANAL_ID', 'CANAL_POSTAGEM_ID', 'AUTO_SORT',
  'AUTO_MIN_RATING', 'AUTO_MIN_SALES', 'AUTO_MIN_COMMISSION', 'AUTO_MAX_PRICE', 'AUTO_HORARIO'];
const saved = Object.fromEntries(AUTO_KEYS.map((key) => [key, process.env[key]]));
beforeEach(() => {
  for (const key of AUTO_KEYS) delete process.env[key];
  Object.assign(process.env, { AUTO_KEYWORDS: 'fone, relógio', CANAL_POSTAGEM_ID: '999', AUTO_HORARIO: '8-23' });
});
afterEach(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });

function fakeStore(posted = []) {
  const settings = new Map();
  const postedSet = new Set(posted);
  return {
    getSetting: (key) => settings.get(key), setSetting: (key, value) => settings.set(key, value),
    wasPosted: (platform, id) => postedSet.has(`${platform}:${id}`), markPosted: (product) => postedSet.add(`${product.platform}:${product.id}`), postedSet
  };
}
function fakeClient() {
  const sent = [];
  return { sent, channels: { fetch: async (id) => ({ id, isTextBased: () => true, send: async (message) => sent.push(message) }) } };
}
const offer = (id, extra = {}) => ({ platform: 'shopee', platformLabel: 'Shopee', id: String(id), title: `Produto ${id}`, price: 'R$ 10,00', priceValue: 10,
  affiliateUrl: `https://s.shopee.com.br/${id}`, rating: 4.8, sales: 500, commissionRate: 0.1, discount: 20, ...extra });
const noon = new Date(2026, 9, 20, 12, 0);

test('configuração lida de process.env, com padrões e intervalo mínimo', () => {
  let config = autoConfig();
  assert.deepEqual(config.keywords, ['fone', 'relógio']);
  assert.equal(config.enabled, false);
  assert.equal(config.intervalMin, 60);
  assert.equal(config.minRating, 4.5);
  Object.assign(process.env, { AUTO_ENABLED: 'true', AUTO_KEYWORDS: 'air fryer', AUTO_INTERVAL_MIN: '2' });
  config = autoConfig();
  assert.equal(config.enabled, true);
  assert.deepEqual(config.keywords, ['air fryer']);
  assert.equal(config.intervalMin, 5, 'intervalo mínimo de 5 minutos');
});

test('horário de postagem, inclusive faixa que vira a noite', () => {
  assert.equal(withinHours(new Date(2026, 0, 1, 7), { startHour: 8, endHour: 23 }), false);
  assert.equal(withinHours(new Date(2026, 0, 1, 8), { startHour: 8, endHour: 23 }), true);
  assert.equal(withinHours(new Date(2026, 0, 1, 23), { startHour: 8, endHour: 23 }), true);
  assert.equal(withinHours(new Date(2026, 0, 1, 2), { startHour: 20, endHour: 3 }), true);
  assert.equal(withinHours(new Date(2026, 0, 1, 12), { startHour: 20, endHour: 3 }), false);
});

test('filtros de qualidade e anti-duplicidade', () => {
  const store = fakeStore(['shopee:2']);
  const config = autoConfig();
  const products = [offer(1, { rating: 4.0 }), offer(2), offer(3, { sales: 10 }), offer(4, { commissionRate: 0.01 }), offer(5), offer(6)];
  assert.deepEqual(pickOffers(products, store, config, 5).map((product) => product.id), ['5', '6']);
  process.env.AUTO_MAX_PRICE = '5';
  assert.deepEqual(pickOffers(products, store, autoConfig(), 5), []);
});

test('rodada posta oferta nova, marca como postada e gira as palavras-chave', async () => {
  const store = fakeStore();
  const client = fakeClient();
  const searched = [];
  const search = async (keyword, options) => { searched.push([keyword, options.sort]); return { products: [offer(`${keyword}-1`)], hasNextPage: false }; };
  const first = await runAutoPost({ client, store, now: noon, search });
  const second = await runAutoPost({ client, store, now: noon, search });
  const third = await runAutoPost({ client, store, now: noon, search });
  assert.deepEqual(searched.map(([keyword]) => keyword), ['fone', 'relógio', 'fone']);
  assert.equal(searched[0][1], 'mais-vendidos', 'ordena por mais vendidos por padrão');
  assert.equal(first.posted[0].id, 'fone-1');
  assert.equal(second.posted[0].id, 'relógio-1');
  assert.equal(third.posted.length, 0, 'não repete produto já postado');
  assert.match(third.reason, /Nenhuma oferta nova para "fone"/);
  assert.equal(client.sent.length, 2);
  const [message] = client.sent;
  assert.equal(message.embeds[0].data.url, 'https://s.shopee.com.br/fone-1');
  assert.equal(message.embeds[0].data.description, '💰 **R$ 10,00**  ·  🏷️ **20% OFF**\n⭐ 4.8  ·  500 vendidos');
  const [button] = message.components[0].toJSON().components;
  assert.deepEqual([button.label, button.url], ['Comprar na Shopee', 'https://s.shopee.com.br/fone-1']);
});

test('rodada procura nas páginas seguintes quando a primeira já foi postada', async () => {
  const store = fakeStore(['shopee:1', 'shopee:2']);
  process.env.AUTO_POSTS_PER_RUN = '2';
  const pages = { 1: [offer(1), offer(2)], 2: [offer(3), offer(4), offer(5)] };
  const result = await runAutoPost({ client: fakeClient(), store, now: noon, search: async (keyword, { page }) => ({ products: pages[page] ?? [], hasNextPage: page < 2 }) });
  assert.deepEqual(result.posted.map((product) => product.id), ['3', '4']);
});

test('fora do horário não posta, a menos que seja forçado (/auto agora)', async () => {
  const store = fakeStore();
  const client = fakeClient();
  const search = async () => ({ products: [offer(1)], hasNextPage: false });
  const night = new Date(2026, 9, 20, 3, 0);
  const blocked = await runAutoPost({ client, store, now: night, search });
  assert.match(blocked.reason, /Fora do horário/);
  const forced = await runAutoPost({ client, store, now: night, search, force: true });
  assert.equal(forced.posted.length, 1);
});

test('sem palavras-chave, loja ou canal, explica o motivo', async () => {
  const search = async () => ({ products: [], hasNextPage: false });
  delete process.env.AUTO_KEYWORDS;
  assert.match((await runAutoPost({ client: fakeClient(), store: fakeStore(), now: noon, search })).reason, /palavra-chave/);
  process.env.AUTO_KEYWORDS = 'fone';
  assert.match((await runAutoPost({ client: fakeClient(), store: fakeStore(), now: noon, sources: [] })).reason, /Nenhuma loja ativa/);
  delete process.env.CANAL_POSTAGEM_ID;
  assert.match((await runAutoPost({ client: fakeClient(), store: fakeStore(), now: noon, search })).reason, /canal/);
});

test('reveza entre as lojas ativas: cada palavra passa por todas as lojas', async () => {
  const store = fakeStore();
  const calls = [];
  const source = (id) => ({ id, search: async (keyword) => { calls.push(`${keyword}/${id}`); return { products: [offer(`${id}-${keyword}`, { platform: id })], hasNextPage: false }; } });
  const sources = [source('shopee'), source('aliexpress')];
  const results = [];
  for (let i = 0; i < 5; i += 1) results.push(await runAutoPost({ client: fakeClient(), store, now: noon, sources }));
  assert.deepEqual(calls, ['fone/shopee', 'fone/aliexpress', 'relógio/shopee', 'relógio/aliexpress', 'fone/shopee']);
  assert.deepEqual(results.slice(0, 2).map((result) => result.store), ['Shopee', 'AliExpress']);
});

test('lojas da automática: só ativas, com credenciais e com busca', async () => {
  const { autoStores, storesStatus } = await import('../services/stores.js');
  const env = { SHOPEE_APP_ID: '1', SHOPEE_APP_SECRET: 's', ALIEXPRESS_APP_KEY: 'k', ALIEXPRESS_APP_SECRET: 's', ALIEXPRESS_TRACKING_ID: 't', ML_CLIENT_ID: 'c', ML_CLIENT_SECRET: 's' };
  assert.deepEqual(autoStores(env), ['shopee', 'aliexpress', 'mercadolivre']);
  assert.deepEqual(autoStores({ ...env, STORE_SHOPEE: 'false' }), ['aliexpress', 'mercadolivre']);
  assert.deepEqual(autoStores({ ...env, ALIEXPRESS_TRACKING_ID: '' }), ['shopee', 'mercadolivre']);
  const ml = storesStatus({ ...env, STORE_MERCADOLIVRE: 'false' }).find((store) => store.id === 'mercadolivre');
  assert.deepEqual([ml.enabled, ml.configured, ml.supportsAuto, ml.inAuto, ml.key], [false, true, true, false, 'STORE_MERCADOLIVRE']);
});

test('filtros de nota, vendas e comissão não se aplicam a métricas desconhecidas (Mercado Livre)', () => {
  const store = fakeStore();
  const ml = offer('MLB1', { platform: 'mercadolivre', rating: null, sales: null, commissionRate: null, priceValue: 50 });
  assert.deepEqual(pickOffers([ml], store, autoConfig(), 1).map((product) => product.id), ['MLB1']);
  process.env.AUTO_MAX_PRICE = '40';
  assert.deepEqual(pickOffers([ml], store, autoConfig(), 1), [], 'preço máximo continua valendo');
});

test('Mercado Livre recusado: sai do rodízio por 6 h e a rodada segue com a próxima loja', async () => {
  const store = fakeStore();
  const ml = { ...offer('MLB1'), platform: 'mercadolivre', rating: null, sales: null, commissionRate: null };
  const sources = [
    { id: 'mercadolivre', search: async () => ({ products: [ml], hasNextPage: false }) },
    { id: 'shopee', search: async () => ({ products: [offer(2)], hasNextPage: false }) }
  ];
  const publish = async (product) => {
    if (product.platform === 'mercadolivre') throw new Error('O firewall do Mercado Livre bloqueou o navegador do bot (HTTP 403).');
    return { sent: ['Discord'], errors: [] };
  };
  const result = await runAutoPost({ store, sources, publish, now: noon });
  assert.deepEqual(result.posted.map((product) => product.id), ['2']);
  assert.match(result.errors[0], /firewall[\s\S]*fora da postagem automática por 6 h/);
  assert.equal(Number(store.getSetting('ml_blocked_until')), noon.getTime() + 6 * 3_600_000);
  // Na rodada seguinte o Mercado Livre nem é consultado.
  let mlSearched = false;
  sources[0].search = async () => { mlSearched = true; return { products: [], hasNextPage: false }; };
  await runAutoPost({ store, sources, publish, now: new Date(noon.getTime() + 60_000) });
  assert.equal(mlSearched, false);
});
