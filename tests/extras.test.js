import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoConfig, pickOffers, runAutoPost, titleKey } from '../jobs/autopost.js';
import { searchTerms } from '../services/nichos.js';
import { FIELDS, normalizeValue } from '../utils/config.js';
import { productEmbed } from '../utils/embed.js';
import { telegramCaption } from '../publishers/telegram.js';
import { startTelegramInbox, findStoreUrl } from '../publishers/telegramInbox.js';
import { createCache } from '../utils/cache.js';

const KEYS = ['AUTO_KEYWORDS', 'AUTO_NICHOS', 'AUTO_MIN_DISCOUNT', 'AUTO_MIN_PRICE', 'AUTO_MAX_PRICE', 'AUTO_BLOCKED_WORDS', 'AUTO_REPEAT_DAYS',
  'AUTO_MIN_RATING', 'AUTO_MIN_SALES', 'AUTO_MIN_COMMISSION', 'CANAL_POSTAGEM_ID', 'AUTO_HORARIO', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  'TELEGRAM_OWNER_ID', 'TELEGRAM_ALERTS', 'POST_DISCORD', 'ML_AFFILIATE_PARAMS', 'ML_CLIENT_ID', 'ML_CLIENT_SECRET'];
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const realFetch = globalThis.fetch;
beforeEach(() => { for (const key of KEYS) delete process.env[key]; });
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
});

const product = (id, extra = {}) => ({ platform: 'shopee', platformLabel: 'Shopee', id: String(id), title: `Produto ${id} modelo exclusivo`, price: 'R$ 50,00',
  priceValue: 50, affiliateUrl: `https://s.shopee.com.br/${id}`, rating: 4.9, sales: 900, commissionRate: 0.1, discount: 30, ...extra });
function fakeStore({ posted = [], titles = [] } = {}) {
  const settings = new Map();
  const postedAt = new Map(posted);
  return {
    getSetting: (key) => settings.get(key), setSetting: (key, value) => settings.set(key, value),
    wasPosted: (platform, id, since) => postedAt.has(`${platform}:${id}`) && (!since || postedAt.get(`${platform}:${id}`) >= since),
    recentTitles: () => titles, markPosted: (p) => postedAt.set(`${p.platform}:${p.id}`, new Date()), countPosts: () => postedAt.size
  };
}

test('filtros novos: desconto mínimo, preço mínimo e palavras bloqueadas (sem acento)', () => {
  Object.assign(process.env, { AUTO_MIN_DISCOUNT: '20', AUTO_MIN_PRICE: '30', AUTO_BLOCKED_WORDS: 'película,capinha' });
  const config = autoConfig();
  const list = [product(1, { discount: 10 }), product(2, { priceValue: 20 }), product(3, { title: 'Pelicula de vidro 3D' }),
    product(4, { title: 'Capinha anti impacto' }), product(5)];
  assert.deepEqual(pickOffers(list, fakeStore(), config, 5).map((p) => p.id), ['5']);
});

test('repostar depois de N dias e pular variações do mesmo produto', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const store = fakeStore({ posted: [['shopee:1', new Date('2026-10-10T00:00:00Z')]], titles: ['Fone Bluetooth TWS Pro 3 preto'] });
  assert.deepEqual(pickOffers([product(1)], store, autoConfig(), 1, { now }), [], 'sem prazo, nunca reposta');
  process.env.AUTO_REPEAT_DAYS = '7';
  assert.deepEqual(pickOffers([product(1)], store, autoConfig(), 1, { now }).map((p) => p.id), ['1'], 'postado há 11 dias volta');
  process.env.AUTO_REPEAT_DAYS = '30';
  assert.deepEqual(pickOffers([product(1)], store, autoConfig(), 1, { now }), []);

  assert.equal(titleKey('Fone Bluetooth TWS Pro 3 — Branco'), 'fone bluetooth tws pro 3');
  const variants = [product(10, { title: 'Fone Bluetooth TWS Pro 3 branco' }), product(11, { title: 'Smartwatch D20 azul' }), product(12, { title: 'Smartwatch D20 rosa' })];
  assert.deepEqual(pickOffers(variants, store, autoConfig(), 3, { now }).map((p) => p.id), ['11'], 'pula variação já postada e variação repetida na mesma busca');
});

test('nichos viram termos de busca com a categoria do Mercado Livre', () => {
  const terms = searchTerms(['air fryer', 'Fone Bluetooth'], ['eletrodomesticos', 'inexistente']);
  assert.deepEqual(terms.slice(0, 3), [{ keyword: 'air fryer' }, { keyword: 'Fone Bluetooth' }, { keyword: 'liquidificador', mlCategory: 'MLB5726', nicho: '🔌 Eletrodomésticos' }]);
  assert.ok(!terms.slice(2).some((term) => term.keyword === 'air fryer'), 'palavra extra repetida no nicho não duplica');
  const field = FIELDS.find((item) => item.key === 'AUTO_NICHOS');
  assert.equal(normalizeValue(field, ['pet', 'casa', 'pet']), 'pet,casa');
  assert.throws(() => normalizeValue(field, 'pet,xyz'), /opção inválida \(xyz\)/);
});

test('rodada de nicho passa a categoria para a busca do Mercado Livre', async () => {
  Object.assign(process.env, { AUTO_NICHOS: 'pet', CANAL_POSTAGEM_ID: '999' });
  const calls = [];
  const sources = [{ id: 'mercadolivre', search: async (keyword, options) => { calls.push([keyword, options.category]); return { products: [], hasNextPage: false }; } }];
  const client = { channels: { fetch: async () => ({ isTextBased: () => true, send: async () => {} }) } };
  const result = await runAutoPost({ client, store: fakeStore(), sources, force: true });
  assert.deepEqual(calls, [['ração', 'MLB1071']]);
  assert.match(result.reason, /"ração" no Mercado Livre/);
});

test('preço "De/Por" só com preço original real', () => {
  const ml = product('MLB1', { platform: 'mercadolivre', platformLabel: 'Mercado Livre', price: 'R$ 889,00', priceValue: 889, originalPrice: 1099, discount: 19, rating: null });
  assert.match(productEmbed(ml).data.description, /^~~R\$\s1\.099,00~~ → 💰 \*\*R\$ 889,00\*\*/);
  assert.match(telegramCaption(ml), /<s>R\$\s1\.099,00<\/s> → 💰 <b>R\$ 889,00<\/b>/);
  assert.match(productEmbed(product(2)).data.description, /^💰 \*\*R\$ 50,00\*\*/, 'Shopee sem preço original');
});

test('banco: repostar atualiza o registro, "since" e títulos recentes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-'));
  const store = createCache(join(dir, 'x.sqlite'));
  try {
    store.markPosted(product(1), 'c');
    assert.equal(store.wasPosted('shopee', '1'), true);
    assert.equal(store.wasPosted('shopee', '1', new Date(Date.now() + 60_000)), false);
    store.markPosted(product(1, { title: 'Novo título' }), 'c');
    assert.equal(store.countPosts(), 1);
    assert.deepEqual(store.recentTitles(new Date(Date.now() - 60_000)), ['Novo título']);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('privado do Telegram: /id, dono, prévia com Postar e publicação', async () => {
  Object.assign(process.env, { TELEGRAM_BOT_TOKEN: '1:abc', TELEGRAM_CHAT_ID: '@canal', TELEGRAM_OWNER_ID: '42', POST_DISCORD: 'false' });
  const calls = [];
  const telegram = async (method, payload) => { calls.push([method, payload]); return { message_id: 7 }; };
  // Chamadas diretas da Bot API (sendPhoto da prévia e do canal) e da API do Mercado Livre.
  const sentPhotos = [];
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.includes('api.telegram.org')) { sentPhotos.push(JSON.parse(options.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 8 } })); }
    if (target.includes('/items')) return new Response(JSON.stringify({ results: [{ price: 99, original_price: 150, currency_id: 'BRL', shipping: { free_shipping: true } }] }));
    if (target.includes('/products/MLB777')) return new Response(JSON.stringify({ id: 'MLB777', name: 'Fone X', pictures: [{ url: 'https://img/x.jpg' }] }));
    throw new Error(`fetch inesperado: ${target}`);
  };
  const store = fakeStore();
  const inbox = startTelegramInbox({ store, getClient: () => null, telegram, logger: { log() {}, error() {} } });

  await inbox.handleUpdate({ message: { chat: { id: 5, type: 'private' }, from: { id: 99 }, text: '/id' } });
  assert.match(calls.at(-1)[1].text, /Seu ID de usuário: <code>99<\/code>/);
  calls.length = 0;
  await inbox.handleUpdate({ message: { chat: { id: 5, type: 'private' }, from: { id: 99 }, text: 'https://www.mercadolivre.com.br/x/p/MLB777' } });
  assert.equal(calls.length, 0, 'quem não é o dono é ignorado');

  await inbox.handleUpdate({ message: { chat: { id: 42, type: 'private' }, from: { id: 42 }, text: 'olha esse https://www.mercadolivre.com.br/fone/p/MLB777 top' } });
  const preview = sentPhotos.at(-1);
  assert.equal(preview.chat_id, 42, 'prévia vai para o privado do dono');
  const postButton = preview.reply_markup.inline_keyboard.at(-1)[0];
  assert.equal(postButton.text, '✅ Postar');

  await inbox.handleUpdate({ callback_query: { id: 'q1', from: { id: 42 }, data: postButton.callback_data, message: { chat: { id: 42 }, message_id: 8, reply_markup: preview.reply_markup } } });
  assert.equal(sentPhotos.at(-1).chat_id, '@canal', 'publicou no canal');
  assert.equal(store.wasPosted('mercadolivre', 'MLB777'), true);
  assert.match(calls.find(([method]) => method === 'answerCallbackQuery')[1].text, /Postado em Telegram/);

  await inbox.handleUpdate({ message: { chat: { id: 42, type: 'private' }, from: { id: 42 }, forward_origin: { chat: { id: -1001, title: 'Canal <Promo>' } }, text: 'post sem link' } });
  assert.match(calls.at(-1)[1].text, /Canal &lt;Promo&gt;": <code>-1001<\/code>/);
  assert.equal(findStoreUrl('veja https://example.com e https://shopee.com.br/product/1/2'), 'https://shopee.com.br/product/1/2');
});

test('avisos para o dono não se repetem dentro de 1 hora', async () => {
  Object.assign(process.env, { TELEGRAM_BOT_TOKEN: '1:abc', TELEGRAM_OWNER_ID: '42' });
  const calls = [];
  const inbox = startTelegramInbox({ store: fakeStore(), getClient: () => null, telegram: async (method, payload) => { calls.push(payload); return {}; } });
  await inbox.notify('⚠️ falhou');
  await inbox.notify('⚠️ falhou');
  await inbox.notify('⚠️ outra falha');
  assert.deepEqual(calls.map((payload) => [payload.chat_id, payload.text]), [['42', '⚠️ falhou'], ['42', '⚠️ outra falha']]);
  process.env.TELEGRAM_ALERTS = 'false';
  await inbox.notify('⚠️ desligado');
  assert.equal(calls.length, 2);
});
