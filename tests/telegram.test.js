import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { telegramCaption, sendTelegramOffer } from '../publishers/telegram.js';
import { publishOffer } from '../publishers/index.js';

const env = { TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '@meucanal' };
const offer = { platform: 'shopee', platformLabel: 'Shopee', id: '1', title: 'Caixa <K12> & Mic', price: 'R$ 27,49 a R$ 32,99', priceValue: 27.49,
  image: 'https://cf.shopee.com.br/file/x', affiliateUrl: 'https://s.shopee.com.br/abc', discount: 73, rating: 4.8, sales: 5873, commissionRate: 0.1 };

let calls;
const realFetch = globalThis.fetch;
const saved = { TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID };
function mockTelegram(handler) {
  calls = [];
  globalThis.fetch = async (url, options) => {
    const method = String(url).split('/').pop();
    const payload = JSON.parse(options.body);
    calls.push({ url: String(url), method, payload });
    const { status = 200, body } = handler(method, payload);
    return new Response(JSON.stringify(body), { status });
  };
}
beforeEach(() => { delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID; });
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
});

test('legenda em HTML escapa o título e mostra preço, desconto e avaliação', () => {
  assert.equal(telegramCaption(offer),
    '<b>🚨 PROMOÇÃO ENCONTRADA!</b>\n\n<b>Caixa &lt;K12&gt; &amp; Mic</b>\n\n💰 <b>R$ 27,49 a R$ 32,99</b>  ·  🏷️ <b>73% OFF</b>\n⭐ 4.8  ·  5.873 vendidos');
  const long = telegramCaption({ ...offer, title: 'x'.repeat(2000) });
  assert.ok(long.length <= 1024);
  assert.match(long, /…<\/b>/);
});

test('envia foto com legenda e botão de compra', async () => {
  mockTelegram(() => ({ body: { ok: true, result: { message_id: 7 } } }));
  await sendTelegramOffer(offer, { env });
  assert.equal(calls.length, 1);
  const [{ url, method, payload }] = calls;
  assert.equal(url, 'https://api.telegram.org/bot123:abc/sendPhoto');
  assert.equal(method, 'sendPhoto');
  assert.equal(payload.chat_id, '@meucanal');
  assert.equal(payload.photo, offer.image);
  assert.equal(payload.parse_mode, 'HTML');
  assert.deepEqual(payload.reply_markup.inline_keyboard, [[{ text: '🛒 Comprar na Shopee', url: 'https://s.shopee.com.br/abc' }]]);
});

test('se a foto for recusada, envia só o texto', async () => {
  mockTelegram((method) => (method === 'sendPhoto'
    ? { status: 400, body: { ok: false, description: 'Bad Request: wrong type of the web page content' } }
    : { body: { ok: true, result: {} } }));
  await sendTelegramOffer(offer, { env });
  assert.deepEqual(calls.map((call) => call.method), ['sendPhoto', 'sendMessage']);
  assert.equal(calls[1].payload.text, telegramCaption(offer));
});

test('erros do Telegram chegam com a descrição da API', async () => {
  mockTelegram(() => ({ status: 403, body: { ok: false, description: 'Forbidden: bot is not a member of the channel chat' } }));
  await assert.rejects(sendTelegramOffer(offer, { env }), /Telegram: Forbidden: bot is not a member/);
});

test('publishOffer manda para Discord e Telegram, e uma falha não derruba o outro', async () => {
  Object.assign(process.env, env);
  mockTelegram(() => ({ body: { ok: true, result: {} } }));
  const discordSent = [];
  const client = { channels: { fetch: async () => ({ isTextBased: () => true, send: async (message) => discordSent.push(message) }) } };
  assert.deepEqual((await publishOffer(offer, { client, discordChannelId: '999' })).sent, ['Discord', 'Telegram']);
  assert.equal(discordSent.length, 1);

  const broken = { channels: { fetch: async () => { throw new Error('Missing Access'); } } };
  const partial = await publishOffer(offer, { client: broken, discordChannelId: '999' });
  assert.deepEqual(partial.sent, ['Telegram']);
  assert.deepEqual(partial.errors, ['Discord: Missing Access']);

  mockTelegram(() => ({ status: 400, body: { ok: false, description: 'chat not found' } }));
  await assert.rejects(publishOffer(offer, { client: broken, discordChannelId: '999' }), /Discord: Missing Access \| Telegram: chat not found/);
});

test('sem Telegram configurado, publica só no Discord', async () => {
  const client = { channels: { fetch: async () => ({ isTextBased: () => true, send: async () => {} }) } };
  assert.deepEqual((await publishOffer(offer, { client, discordChannelId: '999' })).sent, ['Discord']);
});
