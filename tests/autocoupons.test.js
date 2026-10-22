import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCache } from '../utils/cache.js';
import { searchShopeePromotions } from '../services/shopee.js';
import { searchAliExpressPromoCodes } from '../services/aliexpress.js';
import { freshCoupons, runAutoCoupons } from '../jobs/autoCoupons.js';

const newStore = () => createCache(join(mkdtempSync(join(tmpdir(), 'cupons-')), 'db.sqlite'));
const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

test('campanhas da Shopee viram promoções com link de afiliado e validade', async () => {
  Object.assign(process.env, { SHOPEE_APP_ID: '1', SHOPEE_APP_SECRET: 's' });
  let query;
  globalThis.fetch = async (url, options) => {
    query = JSON.parse(options.body).query;
    return Response.json({ data: { shopeeOfferV2: { nodes: [
      { offerName: 'Cupons de Frete Grátis', offerLink: 'https://s.shopee.com.br/frete', originalLink: 'https://shopee.com.br/m/frete-gratis', periodStartTime: 1761000000, periodEndTime: 1761900000 },
      { offerName: '', offerLink: 'https://s.shopee.com.br/x' }
    ] } } });
  };
  const [promo, ...rest] = await searchShopeePromotions();
  assert.match(query, /shopeeOfferV2\(sortType: 1, page: 1, limit: 30\)/);
  assert.equal(rest.length, 0);
  assert.deepEqual(promo, { platform: 'shopee', key: 'shopee:https://shopee.com.br/m/frete-gratis', title: 'Cupons de Frete Grátis', code: '', description: '',
    url: 'https://shopee.com.br/m/frete-gratis', affiliateUrl: 'https://s.shopee.com.br/frete',
    startsAt: new Date(1761000000 * 1000).toISOString(), expiresAt: new Date(1761900000 * 1000).toISOString() });
});

test('AliExpress: só produtos com promo_code_info viram cupom com código real', async () => {
  Object.assign(process.env, { ALIEXPRESS_APP_KEY: 'k', ALIEXPRESS_APP_SECRET: 's', ALIEXPRESS_TRACKING_ID: 'bot' });
  globalThis.fetch = async () => Response.json({ aliexpress_affiliate_product_query_response: { resp_result: { resp_code: 200, result: { products: { product: [
    { product_id: 1, product_title: 'Fone Bluetooth', promotion_link: 'https://s.click.aliexpress.com/e/a',
      promo_code_info: { promo_code: 'BRAE10', code_value: 'R$10', code_mini_spend: 'R$50', code_availabletime_start: '2026-10-01 00:00:00', code_availabletime_end: '2026-10-31 23:59:59' } },
    { product_id: 2, product_title: 'Sem cupom', promotion_link: 'https://s.click.aliexpress.com/e/b' }
  ] } } } } });
  const coupons = await searchAliExpressPromoCodes('fone');
  assert.equal(coupons.length, 1);
  assert.equal(coupons[0].code, 'BRAE10');
  assert.equal(coupons[0].title, 'Cupom de R$10 no AliExpress');
  assert.equal(coupons[0].description, 'Compra mínima: R$50. Vale em: Fone Bluetooth');
  assert.equal(coupons[0].affiliateUrl, 'https://s.click.aliexpress.com/e/a');
  assert.equal(coupons[0].expiresAt, '2026-10-31T15:59:59.000Z', 'lido como UTC+8: na dúvida vence antes');
});

const promo = (key, extra = {}) => ({ platform: 'shopee', key, title: key, code: '', description: '', url: `https://shopee.com.br/m/${key}`, affiliateUrl: `https://s.shopee.com.br/${key}`, expiresAt: null, ...extra });

test('não repete cupom já divulgado, cadastrado à mão, vencido ou que ainda não começou', () => {
  const store = newStore();
  const now = new Date('2026-10-22T12:00:00Z');
  store.setSetting('auto_coupon_keys', JSON.stringify(['ja-postado']));
  store.saveCoupon({ ...promo('manual'), repeatHours: 0, active: true });
  const fresh = freshCoupons([
    promo('ja-postado'), promo('manual'), promo('vencido', { expiresAt: '2026-10-21T00:00:00Z' }),
    promo('futuro', { startsAt: '2026-10-30T00:00:00Z' }), promo('novo'), promo('novo')
  ], store, now);
  assert.deepEqual(fresh.map((coupon) => coupon.key), ['novo']);
});

test('rodada alterna as lojas, salva na página Cupons, posta e não repete na próxima', async () => {
  const store = newStore();
  process.env.AUTO_COUPONS_PER_RUN = '2';
  const sources = [
    { id: 'shopee', find: async () => [promo('s1'), promo('s2')] },
    { id: 'aliexpress', find: async () => [{ ...promo('a1'), platform: 'aliexpress', code: 'BRAE10' }] }
  ];
  const posted = [];
  const post = async (_store, coupon) => { posted.push(coupon.title); return { sent: ['Telegram'], errors: [] }; };
  const first = await runAutoCoupons({ store, sources, post, force: true });
  assert.deepEqual(posted, ['s1', 'a1']);
  assert.deepEqual(first.sentTo, ['Telegram']);
  assert.equal(store.listCoupons().length, 2);
  assert.equal(store.listCoupons().find((coupon) => coupon.code === 'BRAE10').platform, 'aliexpress');
  await runAutoCoupons({ store, sources, post, force: true });
  assert.deepEqual(posted, ['s1', 'a1', 's2']);
});

test('erro numa loja não impede a outra', async () => {
  const store = newStore();
  const sources = [
    { id: 'shopee', find: async () => { throw new Error('código 10035'); } },
    { id: 'aliexpress', find: async () => [{ ...promo('a1'), platform: 'aliexpress' }] }
  ];
  const result = await runAutoCoupons({ store, sources, post: async () => ({ sent: ['Discord'], errors: [] }), force: true });
  assert.equal(result.posted.length, 1);
  assert.match(result.errors[0], /Shopee: código 10035/);
});
