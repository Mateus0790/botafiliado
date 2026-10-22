import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMeliLinks, setLinkbuilderBrowser, SessionError } from '../services/mlLinkbuilder.js';
import { getMercadoLivreProduct, searchMercadoLivreOffers, resetMercadoLivreCache } from '../services/mercadolivre.js';
import { toAffiliateLink } from '../services/affiliateLinks.js';
import { publishOffer } from '../publishers/index.js';

const KEYS = ['ML_LINK_MODE', 'ML_ETIQUETA', 'ML_AFFILIATE_PARAMS', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'POST_DISCORD'];
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setLinkbuilderBrowser(null);
  for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
});

const fakeLinks = (urls) => urls.map((_, i) => `https://meli.la/L${i}`);

test('gera meli.la em lotes de 10, com a etiqueta', async () => {
  const calls = [];
  const browser = async (urls, tag) => { calls.push([urls.length, tag]); return fakeLinks(urls); };
  const urls = Array.from({ length: 12 }, (_, i) => `https://www.mercadolivre.com.br/p/MLB${i}`);
  assert.equal((await createMeliLinks(urls, { env: { ML_ETIQUETA: 'bot' }, browser })).length, 12);
  assert.deepEqual(calls, [[10, 'bot'], [2, 'bot']]);
});

test('sessão expirada, etiqueta faltando e resposta incompleta viram erros claros', async () => {
  await assert.rejects(createMeliLinks(['x'], { env: {}, browser: async () => [] }), /falta a etiqueta/);
  const expired = async () => { throw Object.assign(new Error('A sessão expirou'), { session: true }); };
  await assert.rejects(createMeliLinks(['x'], { env: { ML_ETIQUETA: 'bot' }, browser: expired }), (error) => error instanceof SessionError && /expirou/.test(error.message));
  await assert.rejects(createMeliLinks(['x'], { env: { ML_ETIQUETA: 'bot' }, browser: async () => [''] }), /devolveu 0 link/);
});

function mockMercadoLivre() {
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    if (target.includes('domain_discovery')) return new Response(JSON.stringify([{ category_id: 'MLB1' }]));
    if (target.includes('/highlights/')) return new Response(JSON.stringify({ content: [{ id: 'MLB10', type: 'PRODUCT' }] }));
    if (target.includes('/items')) return new Response(JSON.stringify({ results: [{ price: 100, currency_id: 'BRL', shipping: {} }] }));
    if (target.includes('/products/')) return new Response(JSON.stringify({ id: target.match(/MLB\d+/)[0], name: 'Produto', pictures: [] }));
    throw new Error(`fetch inesperado: ${target}`);
  };
}
const linkbuilderEnv = { ML_LINK_MODE: 'linkbuilder', ML_ETIQUETA: 'bot', TELEGRAM_BOT_TOKEN: '1:a', TELEGRAM_CHAT_ID: '@c', POST_DISCORD: 'false' };

test('modo meli.la: link manual na hora; automática só gera o link ao postar', async () => {
  Object.assign(process.env, linkbuilderEnv);
  const created = [];
  setLinkbuilderBrowser(async (urls) => { created.push(...urls); return fakeLinks(urls); });
  mockMercadoLivre();

  const manual = await getMercadoLivreProduct('https://www.mercadolivre.com.br/x/p/MLB55');
  assert.equal(manual.affiliateUrl, 'https://meli.la/L0');
  assert.deepEqual(created, ['https://www.mercadolivre.com.br/p/MLB55']);

  resetMercadoLivreCache();
  const { products } = await searchMercadoLivreOffers('fone');
  assert.equal(products[0].affiliateUrl, 'https://www.mercadolivre.com.br/p/MLB10', 'busca não abre o navegador');
  assert.equal(created.length, 1);
  await publishOffer(products[0], { client: null });
  assert.equal(products[0].affiliateUrl, 'https://meli.la/L0');
  assert.equal(created.at(-1), 'https://www.mercadolivre.com.br/p/MLB10');

  assert.deepEqual(await toAffiliateLink('https://www.mercadolivre.com.br/ofertas?matt_word=outro'), { platform: 'mercadolivre', affiliateUrl: 'https://meli.la/L0' });
  assert.equal(created.at(-1), 'https://www.mercadolivre.com.br/ofertas', 'rastreio de terceiros removido antes');
});

test('modo meli.la com sessão expirada não posta link sem comissão', async () => {
  Object.assign(process.env, linkbuilderEnv);
  setLinkbuilderBrowser(async () => { throw Object.assign(new Error('A sessão expirou'), { session: true }); });
  let telegramPosts = 0;
  globalThis.fetch = async () => { telegramPosts += 1; return new Response('{}'); };
  const product = { platform: 'mercadolivre', platformLabel: 'Mercado Livre', id: 'MLB1', title: 'X', price: 'R$ 1', affiliateUrl: 'https://www.mercadolivre.com.br/p/MLB1', productUrl: 'https://www.mercadolivre.com.br/p/MLB1', needsMeliLink: true };
  await assert.rejects(publishOffer(product, { client: null }), /expirou/);
  assert.equal(telegramPosts, 0);
});

test('no Docker (sem navegador) o modo meli.la vira parâmetros e não pode ser ligado', async () => {
  const { linkbuilderEnabled } = await import('../services/mlLinkbuilder.js');
  const { setConfig } = await import('../utils/config.js');
  assert.equal(linkbuilderEnabled({ ML_LINK_MODE: 'linkbuilder' }), true);
  assert.equal(linkbuilderEnabled({ ML_LINK_MODE: 'linkbuilder', BOT_NO_BROWSER: '1' }), false);
  process.env.BOT_NO_BROWSER = '1';
  const settings = new Map();
  const store = { getSetting: (key) => settings.get(key), setSetting: (key, value) => settings.set(key, value), deleteSetting: (key) => settings.delete(key) };
  try {
    assert.throws(() => setConfig(store, { ML_LINK_MODE: 'linkbuilder' }), /não funciona no Docker/);
    assert.equal(settings.size, 0);
  } finally { delete process.env.BOT_NO_BROWSER; }
});

test('modo parâmetros continua igual e não abre navegador', async () => {
  Object.assign(process.env, { ML_AFFILIATE_PARAMS: 'matt_word=bot&matt_tool=1' });
  setLinkbuilderBrowser(async () => { throw new Error('não deveria abrir o navegador'); });
  mockMercadoLivre();
  const product = await getMercadoLivreProduct('https://www.mercadolivre.com.br/x/p/MLB55');
  assert.equal(product.affiliateUrl, 'https://www.mercadolivre.com.br/p/MLB55?matt_word=bot&matt_tool=1');
  assert.equal(product.needsMeliLink, undefined);
});

test('recusa do Linkbuilder explica se foi a sessão (JSON) ou o firewall (HTML)', async () => {
  const { refusalMessage } = await import('../services/mlBrowser.js');
  assert.match(refusalMessage({ status: 403, body: { message: 'forbidden' } }), /sessão do navegador do bot não está logada[\s\S]*Fazer login/);
  assert.match(refusalMessage({ status: 403, text: '<html>Access denied' }, { title: 'Access Denied' }), /firewall[\s\S]*"Access Denied"/);
});
