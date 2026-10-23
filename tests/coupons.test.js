import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCoupon, couponStatus, dueCoupons, saveCoupon, postCoupon } from '../jobs/coupons.js';
import { toAffiliateLink } from '../services/affiliateLinks.js';
import { couponMessage, formatDeadline } from '../utils/embed.js';
import { telegramCouponText } from '../publishers/telegram.js';

const realFetch = globalThis.fetch;
const KEYS = ['SHOPEE_APP_ID', 'SHOPEE_APP_SECRET', 'ALIEXPRESS_APP_KEY', 'ALIEXPRESS_APP_SECRET', 'ALIEXPRESS_TRACKING_ID', 'ML_AFFILIATE_PARAMS', 'STORE_SHOPEE', 'COUPON_HEADER'];
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
});

function memoryStore() {
  const coupons = new Map();
  let next = 1;
  return {
    coupons,
    getCoupon: (id) => (coupons.has(id) ? { ...coupons.get(id) } : null),
    saveCoupon: (coupon) => { const id = coupon.id ?? next++; coupons.set(id, { postCount: 0, lastPostedAt: null, ...coupons.get(id), ...coupon, id }); return id; },
    listCoupons: () => [...coupons.values()],
    markCouponPosted: (id, at) => { const coupon = coupons.get(id); coupon.postCount += 1; coupon.lastPostedAt = at.toISOString(); }
  };
}

test('valida e normaliza o cupom', () => {
  const coupon = normalizeCoupon({ title: ' R$ 20 OFF ', code: ' SHOPEE 20 ', url: 'https://shopee.com.br/m/cupom', expiresAt: '2026-10-25T23:59:00-03:00', repeatHours: '6' });
  assert.deepEqual([coupon.title, coupon.code, coupon.expiresAt, coupon.repeatHours, coupon.active], ['R$ 20 OFF', 'SHOPEE20', '2026-10-26T02:59:00.000Z', 6, true]);
  assert.throws(() => normalizeCoupon({ url: 'https://x' }), /Título: obrigatório/);
  assert.throws(() => normalizeCoupon({ title: 'x', url: 'https://x', code: 'A$B' }), /Código/);
  assert.throws(() => normalizeCoupon({ title: 'x', url: 'https://x', repeatHours: 500 }), /168/);
  assert.throws(() => normalizeCoupon({ title: 'x', url: 'https://x', expiresAt: 'amanhã' }), /data inválida/);
});

test('status e repetição: só ativos, válidos e com o intervalo vencido', () => {
  const now = new Date('2026-10-21T15:00:00Z');
  const base = { active: true, repeatHours: 6, expiresAt: '2026-10-25T00:00:00Z' };
  const coupons = [
    { id: 1, ...base, lastPostedAt: null },
    { id: 2, ...base, lastPostedAt: '2026-10-21T08:00:00Z' },
    { id: 3, ...base, lastPostedAt: '2026-10-21T12:00:00Z' },
    { id: 4, ...base, repeatHours: 0, lastPostedAt: null },
    { id: 5, ...base, active: false, lastPostedAt: null },
    { id: 6, ...base, expiresAt: '2026-10-21T14:00:00Z', lastPostedAt: null }
  ];
  assert.deepEqual(dueCoupons(coupons, now).map((coupon) => coupon.id), [1, 2]);
  assert.deepEqual(coupons.map((coupon) => couponStatus(coupon, now)), ['ativo', 'ativo', 'ativo', 'ativo', 'pausado', 'expirado']);
});

test('converte o link da página do cupom em link de afiliado em cada loja', async () => {
  Object.assign(process.env, { SHOPEE_APP_ID: '1', SHOPEE_APP_SECRET: 's', ALIEXPRESS_APP_KEY: 'k', ALIEXPRESS_APP_SECRET: 's', ALIEXPRESS_TRACKING_ID: 't', ML_AFFILIATE_PARAMS: 'matt_word=bot&matt_tool=1' });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('shopee')) {
      const { query } = JSON.parse(options.body);
      assert.match(query, /originUrl: "https:\/\/shopee\.com\.br\/m\/cupons-de-desconto\?promo=1"/, 'parâmetros de rastreio removidos, os da página mantidos');
      return new Response(JSON.stringify({ data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/meu' } } }));
    }
    const params = new URLSearchParams(options.body);
    assert.equal(params.get('source_values'), 'https://pt.aliexpress.com/campaign/wow/gcp/sale');
    return new Response(JSON.stringify({ aliexpress_affiliate_link_generate_response: { resp_result: { resp_code: 200, result: { promotion_links: { promotion_link: [{ promotion_link: 'https://s.click.aliexpress.com/e/_meu' }] } } } } }));
  };
  assert.deepEqual(await toAffiliateLink('https://shopee.com.br/m/cupons-de-desconto?promo=1&utm_source=x&smtt=0.1'), { platform: 'shopee', affiliateUrl: 'https://s.shopee.com.br/meu' });
  assert.deepEqual(await toAffiliateLink('https://pt.aliexpress.com/campaign/wow/gcp/sale?aff_fcid=outro'), { platform: 'aliexpress', affiliateUrl: 'https://s.click.aliexpress.com/e/_meu' });
  assert.deepEqual(await toAffiliateLink('https://www.mercadolivre.com.br/ofertas?matt_word=outro'),
    { platform: 'mercadolivre', affiliateUrl: 'https://www.mercadolivre.com.br/ofertas?matt_word=bot&matt_tool=1' });
  assert.deepEqual(await toAffiliateLink('https://meli.la/Exemplo1'), { platform: 'mercadolivre', affiliateUrl: 'https://meli.la/Exemplo1' }, 'meli.la é mantido');
  assert.equal(calls.length, 2);
  process.env.STORE_SHOPEE = 'false';
  await assert.rejects(toAffiliateLink('https://shopee.com.br/m/x'), /desativada/);
  await assert.rejects(toAffiliateLink('https://amazon.com.br/x'), /não suportada/);
});

test('salvar só gera o link de afiliado de novo quando o link da loja muda', async () => {
  const store = memoryStore();
  const first = await saveCoupon(store, { title: 'Cupom', url: 'https://meli.la/abc', code: 'ML10' });
  assert.equal(first.affiliateUrl, 'https://meli.la/abc');
  store.coupons.get(first.id).affiliateUrl = 'https://meli.la/abc?gerado=1';
  const edited = await saveCoupon(store, { id: first.id, title: 'Cupom editado', url: 'https://meli.la/abc' });
  assert.deepEqual([edited.title, edited.affiliateUrl], ['Cupom editado', 'https://meli.la/abc?gerado=1']);
  await assert.rejects(saveCoupon(store, { id: 99, title: 'x', url: 'https://meli.la/x' }), /não encontrado/);
});

test('postar marca o cupom e recusa cupom expirado', async () => {
  const store = memoryStore();
  const id = store.saveCoupon({ title: 'X', platform: 'shopee', affiliateUrl: 'https://s.shopee.com.br/x', active: true, repeatHours: 0, expiresAt: null });
  const published = [];
  await postCoupon(store, store.getCoupon(id), { publish: async (coupon) => { published.push(coupon.title); return { sent: ['Telegram'], errors: [] }; } });
  assert.deepEqual([published, store.getCoupon(id).postCount], [['X'], 1]);
  await assert.rejects(postCoupon(store, { ...store.getCoupon(id), expiresAt: '2000-01-01T00:00:00Z' }, { publish: async () => ({}) }), /expirou/);
});

test('mensagens: código copiável, validade e botão "Pegar cupom"', () => {
  process.env.COUPON_HEADER = '🎟️ CUPOM!';
  const coupon = { platform: 'aliexpress', title: 'US$ 5 OFF <hoje>', code: 'ALI5', description: 'Acima de R$ 50 & frete', affiliateUrl: 'https://s.click.aliexpress.com/e/_x', expiresAt: '2026-10-26T02:59:00Z' };
  const deadline = formatDeadline(coupon.expiresAt);
  assert.match(deadline, /^\d{2}\/\d{2} às \d{2}:\d{2}$/);
  const discord = couponMessage(coupon, { content: '**🎟️ CUPOM!**' });
  assert.equal(discord.embeds[0].data.description, `Acima de R$ 50 & frete\n🎟️ Código: \`ALI5\`\n⏰ Válido até ${deadline}`);
  const [button] = discord.components[0].toJSON().components;
  assert.deepEqual([button.label, button.url], ['Pegar cupom no AliExpress', coupon.affiliateUrl]);
  assert.equal(telegramCouponText(coupon),
    `<b>🎟️ CUPOM!</b>\n\n<b>US$ 5 OFF &lt;hoje&gt;</b>\n\nAcima de R$ 50 &amp; frete\n🎟️ Código: <code>ALI5</code>\n⏰ Válido até ${deadline}`);
  const linkOnly = couponMessage({ ...coupon, platform: 'shopee', code: '' });
  assert.equal(linkOnly.components[0].toJSON().components[0].label, 'Ver promoção na Shopee');
});

test('vários códigos com condição, um por linha; o primeiro vira o code', async () => {
  const { parseCodes } = await import('../jobs/coupons.js');
  assert.deepEqual(parseCodes('R$ 100 OFF em R$ 399: MOVEIS100\n\nR$ 200 OFF em R$ 1599: MOVEIS200\nFRETE10'),
    [{ label: 'R$ 100 OFF em R$ 399', code: 'MOVEIS100' }, { label: 'R$ 200 OFF em R$ 1599', code: 'MOVEIS200' }, { label: '', code: 'FRETE10' }]);
  assert.throws(() => parseCodes('Desconto: código com espaço?'), /Código/);
  const coupon = normalizeCoupon({ title: 'Cupons Mercado Livre', codes: 'R$ 100 OFF em R$ 399: MOVEIS100\nR$ 200 OFF em R$ 1599: MOVEIS200', url: 'https://meli.la/x',
    extraUrl: 'https://s.shopee.com.br/carrinho', image: 'https://exemplo.com/banner.jpg', startsAt: '2026-11-11T03:00:00Z', expiresAt: '2026-11-12T03:00:00Z' });
  assert.equal(coupon.code, 'MOVEIS100');
  assert.equal(coupon.extraLabel, 'Link do carrinho');
  assert.throws(() => normalizeCoupon({ title: 'x', url: 'https://meli.la/x', startsAt: '2026-11-12T00:00:00Z', expiresAt: '2026-11-11T00:00:00Z' }), /antes da validade/);
});

test('cupom com vários códigos, imagem e link extra em Telegram, Discord e WhatsApp', async () => {
  const { whatsappCouponText } = await import('../publishers/whatsapp.js');
  const coupon = { platform: 'mercadolivre', title: 'Cupons Mercado Livre', code: 'MOVEIS100', description: 'Resgate no app.',
    codes: [{ label: 'R$ 100 OFF em R$ 399', code: 'MOVEIS100' }, { label: 'R$ 200 OFF em R$ 1599', code: 'MOVEIS200' }],
    affiliateUrl: 'https://meli.la/abc', image: 'https://exemplo.com/banner.jpg', extraLabel: 'Link do carrinho', extraAffiliateUrl: 'https://meli.la/carrinho' };
  assert.match(telegramCouponText(coupon), /Resgate no app\.\n\n🎟️ R\$ 100 OFF em R\$ 399: <code>MOVEIS100<\/code>\n🎟️ R\$ 200 OFF em R\$ 1599: <code>MOVEIS200<\/code>/);
  const discord = couponMessage(coupon);
  assert.equal(discord.embeds[0].data.image.url, 'https://exemplo.com/banner.jpg');
  assert.deepEqual(discord.components[0].components.map((button) => button.data.url), ['https://meli.la/abc', 'https://meli.la/carrinho']);
  assert.match(whatsappCouponText(coupon), /🛒 Link do carrinho:\nhttps:\/\/meli\.la\/carrinho$/);

  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ method: String(url).split('/').pop(), payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: {} }));
  };
  const { sendTelegramCoupon } = await import('../publishers/telegram.js');
  await sendTelegramCoupon(coupon, { env: { TELEGRAM_BOT_TOKEN: '1:a', TELEGRAM_CHAT_ID: '@canal' } });
  assert.equal(calls[0].method, 'sendPhoto');
  assert.equal(calls[0].payload.photo, 'https://exemplo.com/banner.jpg');
  assert.deepEqual(calls[0].payload.reply_markup.inline_keyboard.map(([button]) => button.url), ['https://meli.la/abc', 'https://meli.la/carrinho']);
});

test('cupom agendado: fica "agendado" e sai uma vez na hora marcada, mesmo fora do horário', async () => {
  const { startDue } = await import('../jobs/coupons.js');
  const coupon = { active: true, startsAt: '2026-11-11T03:00:00Z', expiresAt: '2026-11-12T03:00:00Z', repeatHours: 0, lastPostedAt: null };
  assert.equal(couponStatus(coupon, new Date('2026-11-11T02:59:00Z')), 'agendado');
  assert.equal(startDue(coupon, new Date('2026-11-11T02:59:00Z')), false);
  assert.equal(startDue(coupon, new Date('2026-11-11T03:00:30Z')), true);
  assert.equal(startDue({ ...coupon, lastPostedAt: '2026-11-11T03:01:00Z' }, new Date('2026-11-11T03:05:00Z')), false, 'não repete');
  assert.deepEqual(dueCoupons([{ ...coupon, repeatHours: 6 }], new Date('2026-11-11T03:00:30Z')), [], 'a primeira postagem é a do agendamento');
});
