import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runUrgent, urgentConfig } from '../jobs/urgent.js';
import { telegramCaption } from '../publishers/telegram.js';

const KEYS = ['AUTO_KEYWORDS', 'AUTO_HORARIO', 'CANAL_POSTAGEM_ID', 'AUTO_MIN_RATING', 'AUTO_MIN_SALES', 'AUTO_MIN_COMMISSION',
  'URGENT_MIN_DISCOUNT', 'URGENT_MAX_PER_DAY', 'URGENT_HEADER'];
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
beforeEach(() => {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, { AUTO_KEYWORDS: 'fone', AUTO_HORARIO: '8-23', CANAL_POSTAGEM_ID: '999' });
});
afterEach(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });

function fakeStore() {
  const settings = new Map();
  const posted = new Set();
  return { settings, getSetting: (key) => settings.get(key), setSetting: (key, value) => settings.set(key, value),
    wasPosted: (platform, id) => posted.has(`${platform}:${id}`), markPosted: (product) => posted.add(`${product.platform}:${product.id}`) };
}
const offer = (id, discount, extra = {}) => ({ platform: 'shopee', platformLabel: 'Shopee', id: String(id), title: `Produto ${id}`, price: 'R$ 10,00',
  priceValue: 10, affiliateUrl: `https://s.shopee.com.br/${id}`, rating: 4.8, sales: 500, commissionRate: 0.1, discount, ...extra });
const noon = new Date(2026, 9, 20, 12, 0);

test('configuração padrão: 70% OFF, a cada 15 min, até 5 por dia', () => {
  assert.deepEqual(urgentConfig({}), { enabled: false, minDiscount: 70, intervalMin: 15, maxPerDay: 5, header: '🔥 URGENTE: DESCONTO ABSURDO!' });
});

test('posta na hora a oferta com o maior desconto acima do mínimo, com o título de urgência', async () => {
  const store = fakeStore();
  const sources = [
    { id: 'shopee', search: async () => ({ products: [offer(1, 40), offer(2, 75)] }) },
    { id: 'aliexpress', search: async () => ({ products: [offer(3, 88, { platform: 'aliexpress', platformLabel: 'AliExpress' })] }) }
  ];
  const sent = [];
  const publish = async (product) => { sent.push(product); return { sent: ['Telegram'], errors: [] }; };
  const result = await runUrgent({ store, sources, publish, now: noon });
  assert.deepEqual(result.posted.map((product) => product.id), ['3']);
  assert.equal(sent[0].header, '🔥 URGENTE: DESCONTO ABSURDO!');
  assert.match(telegramCaption(sent[0]), /^<b>🔥 URGENTE: DESCONTO ABSURDO!<\/b>/);
  const again = await runUrgent({ store, sources, publish, now: new Date(noon.getTime() + 60_000) });
  assert.deepEqual(again.posted.map((product) => product.id), ['2'], 'não repete o produto já postado');
});

test('nada acima do mínimo: não posta; limite diário é respeitado', async () => {
  const store = fakeStore();
  const publish = async () => ({ sent: ['Telegram'], errors: [] });
  const low = await runUrgent({ store, sources: [{ id: 'shopee', search: async () => ({ products: [offer(1, 50)] }) }], publish, now: noon });
  assert.equal(low.posted.length, 0);
  assert.match(low.reason, /70% OFF ou mais/);
  process.env.URGENT_MAX_PER_DAY = '1';
  let id = 10;
  const sources = [{ id: 'shopee', search: async () => ({ products: [offer(id++, 90)] }) }];
  assert.equal((await runUrgent({ store, sources, publish, now: noon })).posted.length, 1);
  const limited = await runUrgent({ store, sources, publish, now: new Date(noon.getTime() + 60_000) });
  assert.match(limited.reason, /Limite de 1/);
});
