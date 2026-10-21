import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCache } from '../utils/cache.js';
import { whatsappText, whatsappCouponText, sendWhatsappOffer } from '../publishers/whatsapp.js';
import { instagramCaption, instagramDm, instagramImageUrl, matchesKeyword, sendInstagramOffer } from '../publishers/instagram.js';
import { checkInstagramComments, refreshInstagramToken } from '../jobs/instagramComments.js';
import { destinations } from '../publishers/index.js';

const offer = { platform: 'mercadolivre', platformLabel: 'Mercado Livre', id: 'MLB1', title: 'Air Fryer 4L', price: 'R$ 299,90', priceValue: 299.9,
  originalPrice: 399.9, discount: 25, rating: 4.7, sales: 1500, freeShipping: true, image: 'https://http2.mlstatic.com/D_1-O.webp',
  affiliateUrl: 'https://meli.la/abc' };
const quiet = { log: () => {}, error: () => {} };
const newStore = () => createCache(join(mkdtempSync(join(tmpdir(), 'social-')), 'db.sqlite'));

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

test('texto do WhatsApp usa *negrito*, ~riscado~ e o link de afiliado', () => {
  assert.equal(whatsappText(offer).replace(/\u00a0/g, ' '),
    '*🚨 PROMOÇÃO ENCONTRADA!*\n\n*Air Fryer 4L*\n\n~R$ 399,90~ → 💰 *R$ 299,90*  ·  🏷️ *25% OFF*\n⭐ 4.7  ·  1.500 vendidos\n🚚 Frete grátis\n\n🛒 Comprar no Mercado Livre:\nhttps://meli.la/abc');
  assert.match(whatsappCouponText({ platform: 'shopee', title: 'Frete grátis', code: 'FRETE10', affiliateUrl: 'https://s.shopee.com.br/x' }), /Código: \*FRETE10\*[\s\S]*Pegar cupom na Shopee:\nhttps:\/\/s\.shopee/);
});

test('kit do WhatsApp vai para o privado do dono: foto e texto copiável com botão', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ method: String(url).split('/').pop(), payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: {} }));
  };
  await sendWhatsappOffer(offer, { env: { TELEGRAM_BOT_TOKEN: '1:a', TELEGRAM_OWNER_ID: '999' } });
  assert.deepEqual(calls.map((call) => call.method), ['sendPhoto', 'sendMessage']);
  assert.equal(calls[1].payload.chat_id, '999');
  assert.match(calls[1].payload.text, /<pre>\*🚨 PROMOÇÃO ENCONTRADA!\*/);
  assert.match(calls[1].payload.reply_markup.inline_keyboard[0][0].url, /^https:\/\/wa\.me\/\?text=/);
});

test('palavra-chave do comentário ignora maiúsculas, acentos e pontuação, mas não pega pedaço de palavra', () => {
  assert.ok(matchesKeyword('Quero!!', 'QUERO'));
  assert.ok(matchesKeyword('eu quero 🙋‍♀️', 'quero'));
  assert.ok(matchesKeyword('EU QUÉRO', 'quero'));
  assert.ok(!matchesKeyword('querosene', 'quero'));
  assert.ok(!matchesKeyword('lindo', 'quero'));
});

test('legenda do Instagram chama para comentar e o direct leva o link', () => {
  const caption = instagramCaption(offer, { env: { INSTAGRAM_KEYWORD: 'eu quero', INSTAGRAM_HASHTAGS: 'achadinhos,#casa' } }).replace(/\u00a0/g, ' ');
  assert.match(caption, /De R\$ 399,90 por 💰 R\$ 299,90/);
  assert.match(caption, /Comente EU QUERO que eu te mando o link no direct!/);
  assert.match(caption, /#achadinhos #casa$/);
  assert.ok(instagramCaption({ ...offer, title: 'x'.repeat(5000) }, { env: {} }).length <= 2200);
  const dm = instagramDm({ ...offer, title: 'y'.repeat(3000) }, { env: {} });
  assert.ok(dm.length <= 1000);
  assert.match(dm, /https:\/\/meli\.la\/abc$/);
  assert.equal(instagramImageUrl(offer.image), 'https://http2.mlstatic.com/D_1-O.jpg');
});

test('publica no Instagram (container → status → publish), guarda o post e respeita o limite diário', async () => {
  const store = newStore();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname.replace('/v23.0/', '');
    calls.push({ path, method: options.method ?? 'GET', body: options.body && JSON.parse(options.body) });
    if (path === 'me/media') return Response.json({ id: 'C1' });
    if (path === 'C1') return Response.json({ status_code: 'FINISHED' });
    return Response.json({ id: 'M1' });
  };
  const env = { INSTAGRAM_TOKEN: 'tok', INSTAGRAM_MAX_PER_DAY: '1' };
  await sendInstagramOffer(offer, { store, env });
  assert.deepEqual(calls.map((call) => call.path), ['me/media', 'C1', 'me/media_publish']);
  assert.equal(calls[0].body.image_url, 'https://http2.mlstatic.com/D_1-O.jpg');
  assert.equal(calls[2].body.creation_id, 'C1');
  assert.equal(store.recentInstagramPosts(new Date(0))[0].mediaId, 'M1');
  await assert.rejects(sendInstagramOffer(offer, { store, env }), (error) => error.skipped && /limite de 1/.test(error.message));
});

test('Instagram e WhatsApp entram nos destinos só quando ligados e configurados; cupom não vai para o Instagram', () => {
  Object.assign(process.env, { POST_DISCORD: 'false', POST_TELEGRAM: 'false', POST_INSTAGRAM: 'true', INSTAGRAM_TOKEN: 'tok', POST_WHATSAPP: 'true' });
  delete process.env.TELEGRAM_BOT_TOKEN;
  assert.deepEqual(destinations(null), ['Instagram']);
  process.env.TELEGRAM_BOT_TOKEN = '1:a';
  process.env.TELEGRAM_OWNER_ID = '999';
  assert.deepEqual(destinations(null), ['WhatsApp', 'Instagram']);
  assert.deepEqual(destinations(null, { coupon: true }), ['WhatsApp']);
});

test('comentário com a palavra recebe o link no direct uma vez; os outros são ignorados', async () => {
  const store = newStore();
  store.saveInstagramPost('M1', offer);
  const calls = [];
  const comments = [
    { id: 'c1', text: 'Quero!', from: { id: '7', username: 'ana' }, timestamp: new Date().toISOString() },
    { id: 'c2', text: 'que lindo', from: { id: '8', username: 'bia' }, timestamp: new Date().toISOString() },
    { id: 'c3', text: 'Te mandei o link no direct! 📩', from: { id: '1', username: 'minhaloja' }, timestamp: new Date().toISOString() }
  ];
  const api = async (path, { method = 'GET', body } = {}) => {
    calls.push({ path, method, body });
    if (path === 'me') return { user_id: '1', username: 'minhaloja' };
    if (path === 'me/media') return { data: [{ id: 'M1', comments_count: 3 }] };
    if (path === 'M1/comments') return { data: comments };
    return { id: 'ok' };
  };
  const env = { INSTAGRAM_TOKEN: 'tok', POST_INSTAGRAM: 'true' };
  const first = await checkInstagramComments({ store, env, api, logger: quiet });
  assert.equal(first.replied, 1);
  const dm = calls.find((call) => call.path === 'me/messages');
  assert.deepEqual(dm.body.recipient, { comment_id: 'c1' });
  assert.match(dm.body.message.text, /https:\/\/meli\.la\/abc/);
  assert.equal(calls.find((call) => call.path === 'c1/replies').body.message, 'Te mandei o link no direct! 📩');

  // Mesma contagem: nem busca os comentários de novo. Contagem nova: não repete o direct.
  calls.length = 0;
  await checkInstagramComments({ store, env, api, logger: quiet });
  assert.ok(!calls.some((call) => call.path === 'M1/comments'));
  store.setInstagramCommentsCount('M1', 0);
  const again = await checkInstagramComments({ store, env, api, logger: quiet });
  assert.equal(again.replied, 0);
  assert.equal(store.countInstagramReplies(), 1);
});

test('token do Instagram é renovado a cada 7 dias e salvo na configuração', async () => {
  const store = newStore();
  process.env.INSTAGRAM_TOKEN = 'antigo-token-0123456789';
  const now = new Date('2026-10-21T12:00:00Z');
  const request = async () => ({ access_token: 'novo-token-0123456789' });
  assert.equal(await refreshInstagramToken({ store, now, request, logger: quiet }), false, 'primeira vez só marca a data');
  assert.equal(await refreshInstagramToken({ store, now: new Date(now.getTime() + 8 * 86_400_000), request, logger: quiet }), true);
  assert.equal(process.env.INSTAGRAM_TOKEN, 'novo-token-0123456789');
  assert.equal(store.getSetting('cfg:INSTAGRAM_TOKEN'), 'novo-token-0123456789');
});
