import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, resolveProduct } from '../services/index.js';
import { extractMercadoLivreId, getMercadoLivreProduct, resetMercadoLivreToken, resetMercadoLivreCache, searchMercadoLivreOffers } from '../services/mercadolivre.js';
import { createAliExpressSignature, extractAliExpressId, getAliExpressProduct, searchAliExpressOffers } from '../services/aliexpress.js';
import { createShopeeSignature, shopeeAuthorization, extractShopeeIds, getShopeeProduct } from '../services/shopee.js';

// Substitui o fetch global por respostas roteadas por URL e registra cada chamada.
let calls;
function mockFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const route = routes.find(([pattern]) => String(url).includes(pattern));
    if (!route) throw new Error(`fetch inesperado: ${url}`);
    const [, handler] = route;
    const result = typeof handler === 'function' ? handler(String(url), options) : handler;
    if (result instanceof Response || result?.redirected) return result;
    return new Response(JSON.stringify(result.body ?? result), { status: result.status ?? 200 });
  };
}

const realFetch = globalThis.fetch;
const env = { ...process.env };
beforeEach(() => {
  Object.assign(process.env, {
    SHOPEE_APP_ID: '123', SHOPEE_APP_SECRET: 'secret',
    ALIEXPRESS_APP_KEY: 'key', ALIEXPRESS_APP_SECRET: 'secret', ALIEXPRESS_TRACKING_ID: 'track',
    ML_AFFILIATE_PARAMS: 'matt_word=meucodigo&matt_tool=123'
  });
  for (const key of ['ML_CLIENT_ID', 'ML_CLIENT_SECRET', 'ML_REFRESH_TOKEN', 'ML_ACCESS_TOKEN']) delete process.env[key];
  resetMercadoLivreToken();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
});

test('detecta plataformas, inclusive links curtos', () => {
  assert.equal(detectPlatform('https://www.shopee.com.br/produto/1'), 'shopee');
  assert.equal(detectPlatform('https://s.shopee.com.br/abc'), 'shopee');
  assert.equal(detectPlatform('https://pt.aliexpress.com/item/100.html'), 'aliexpress');
  assert.equal(detectPlatform('https://s.click.aliexpress.com/e/_abc'), 'aliexpress');
  assert.equal(detectPlatform('https://www.mercadolivre.com.br/MLB-123456-produto'), 'mercadolivre');
  assert.equal(detectPlatform('https://mercadolivre.com/sec/abc'), 'mercadolivre');
  assert.throws(() => detectPlatform('https://example.com/produto'), /não suportada/);
  assert.throws(() => detectPlatform('não é url'), /URL válida/);
});

test('extrai IDs das URLs de cada plataforma', () => {
  assert.deepEqual(extractShopeeIds('https://shopee.com.br/Fone-Bluetooth-i.334455.998877?sp_atk=x'), { shopId: '334455', itemId: '998877' });
  assert.deepEqual(extractShopeeIds('https://shopee.com.br/product/334455/998877'), { shopId: '334455', itemId: '998877' });
  assert.throws(() => extractShopeeIds('https://shopee.com.br/m/ofertas'), /ID da loja/);
  assert.equal(extractAliExpressId('https://pt.aliexpress.com/item/1005006123456789.html?spm=a2g0o'), '1005006123456789');
  assert.deepEqual(extractMercadoLivreId('https://produto.mercadolivre.com.br/MLB-123456789-fone-_JM'), { type: 'item', id: 'MLB123456789' });
  assert.deepEqual(extractMercadoLivreId('https://www.mercadolivre.com.br/fone/p/MLB19615316'), { type: 'product', id: 'MLB19615316' });
  assert.deepEqual(extractMercadoLivreId('https://www.mercadolivre.com.br/fone/p/MLB19615316?pdp_filters=item_id:MLB3846027829'), { type: 'product', id: 'MLB19615316' });
  assert.deepEqual(extractMercadoLivreId('https://www.mercadolivre.com.br/fone/p/MLB19615316?item_id=MLB3846027829'), { type: 'item', id: 'MLB3846027829' });
});

test('assinaturas seguem o formato oficial', () => {
  assert.equal(createShopeeSignature('123', 1700000000, '{"query":"{ x }"}', 'secret'), '2e42bc06cb0c1e950cf36281b0bf8bd463d01e375042cff672d407d9f9e8590d');
  assert.equal(shopeeAuthorization('123', 'secret', '{"query":"{ x }"}', 1700000000),
    'SHA256 Credential=123, Timestamp=1700000000, Signature=2e42bc06cb0c1e950cf36281b0bf8bd463d01e375042cff672d407d9f9e8590d');
  // sign_method entra no cálculo; sign não.
  assert.equal(createAliExpressSignature({ b: '2', a: '1', sign_method: 'md5', sign: 'IGNORADO' }, 'secret'), 'CA1302239547EDD8F43BB1995D0A4577');
});

test('Shopee: consulta o produto, gera link curto e assina cada requisição', async () => {
  mockFetch([['graphql', (url, options) => {
    const { query } = JSON.parse(options.body);
    if (query.startsWith('mutation')) {
      assert.match(query, /generateShortLink\(input: \{ originUrl: "https:\/\/shopee\.com\.br\/product\/334455\/998877"/);
      return { data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/afiliado' } } };
    }
    assert.match(query, /productOfferV2\(shopId: 334455, itemId: 998877\)/);
    return { data: { productOfferV2: { nodes: [{ itemId: 998877, productName: 'Fone', priceMin: '49.9', priceMax: '59.9', imageUrl: 'https://img/1.jpg', productLink: 'https://shopee.com.br/product/334455/998877', offerLink: 'https://shope.ee/offer' }] } } };
  }]]);
  const product = await getShopeeProduct('https://shopee.com.br/Fone-i.334455.998877');
  assert.equal(product.affiliateUrl, 'https://s.shopee.com.br/afiliado');
  assert.equal(product.id, '998877');
  assert.match(product.price, /49,90 a .*59,90/);
  for (const { options } of calls) {
    const [, timestamp, signature] = options.headers.authorization.match(/^SHA256 Credential=123, Timestamp=(\d+), Signature=([0-9a-f]{64})$/);
    assert.equal(signature, createShopeeSignature('123', timestamp, options.body, 'secret'));
  }
});

test('Shopee: usa offerLink se o link curto falhar e repassa erros da API', async () => {
  mockFetch([['graphql', (url, options) => JSON.parse(options.body).query.startsWith('mutation')
    ? { errors: [{ message: 'rate limited', extensions: { code: 10030 } }] }
    : { data: { productOfferV2: { nodes: [{ itemId: 1, productName: 'X', priceMin: '10', priceMax: '10', offerLink: 'https://shope.ee/offer' }] } } }]]);
  assert.equal((await getShopeeProduct('https://shopee.com.br/product/2/1')).affiliateUrl, 'https://shope.ee/offer');

  mockFetch([['graphql', { errors: [{ message: 'Invalid Signature', extensions: { code: 10020 } }] }]]);
  await assert.rejects(getShopeeProduct('https://shopee.com.br/product/2/1'), /Shopee: Invalid Signature \(código 10020\)/);
});

test('AliExpress: chama productdetail.get e link.generate com parâmetros assinados', async () => {
  mockFetch([['api-sg.aliexpress.com', (url, options) => {
    const params = Object.fromEntries(new URLSearchParams(options.body));
    const { sign, ...rest } = params;
    assert.equal(sign, createAliExpressSignature(rest, 'secret'));
    assert.match(params.timestamp, /^\d{13}$/);
    if (params.method === 'aliexpress.affiliate.productdetail.get') {
      assert.equal(params.product_ids, '1005006123456789');
      assert.equal(params.target_currency, 'BRL');
      return { aliexpress_affiliate_productdetail_get_response: { resp_result: { resp_code: 200, result: { products: { product: [{ product_id: 1005006123456789, product_title: 'Relógio', target_sale_price: '89.90', target_sale_price_currency: 'BRL', product_main_image_url: 'https://img/a.jpg', promotion_link: 'https://s.click.aliexpress.com/detail' }] } } } } };
    }
    assert.equal(params.method, 'aliexpress.affiliate.link.generate');
    assert.equal(params.source_values, 'https://www.aliexpress.com/item/1005006123456789.html');
    return { aliexpress_affiliate_link_generate_response: { resp_result: { resp_code: 200, result: { promotion_links: { promotion_link: [{ promotion_link: 'https://s.click.aliexpress.com/e/_afiliado' }] } } } } };
  }]]);
  const product = await getAliExpressProduct('https://pt.aliexpress.com/item/1005006123456789.html');
  assert.equal(product.affiliateUrl, 'https://s.click.aliexpress.com/e/_afiliado');
  assert.match(product.price, /89,90/);
  assert.equal(calls.length, 2);
});

test('AliExpress: mostra a mensagem de erro da API', async () => {
  mockFetch([['api-sg.aliexpress.com', { error_response: { code: 'IncompleteSignature', msg: 'The request signature does not conform to platform standards' } }]]);
  await assert.rejects(getAliExpressProduct('https://pt.aliexpress.com/item/1005006123456789.html'), /AliExpress: The request signature .* \(código IncompleteSignature\)/);
  mockFetch([['api-sg.aliexpress.com', { aliexpress_affiliate_productdetail_get_response: { resp_result: { resp_code: 405, resp_msg: 'tracking id invalid' } } }]]);
  await assert.rejects(getAliExpressProduct('https://pt.aliexpress.com/item/1005006123456789.html'), /tracking id invalid \(código 405\)/);
});

test('AliExpress: busca por palavra-chave converte para o formato comum dos filtros', async () => {
  mockFetch([['api-sg.aliexpress.com', (url, options) => {
    const params = Object.fromEntries(new URLSearchParams(options.body));
    assert.equal(params.method, 'aliexpress.affiliate.product.query');
    assert.deepEqual([params.keywords, params.sort, params.page_no, params.page_size, params.ship_to_country, params.tracking_id],
      ['fone bluetooth', 'LAST_VOLUME_DESC', '2', '20', 'BR', 'track']);
    const { sign, ...rest } = params;
    assert.equal(sign, createAliExpressSignature(rest, 'secret'));
    return { aliexpress_affiliate_product_query_response: { resp_result: { resp_code: 200, result: { total_record_count: 100, products: { product: [
      { product_id: 1005001, product_title: 'Fone TWS', target_sale_price: '35.90', target_sale_price_currency: 'BRL', discount: '62%',
        evaluate_rate: '95.2%', lastest_volume: 1234, commission_rate: '7.0%', product_main_image_url: 'https://img/a.jpg', promotion_link: 'https://s.click.aliexpress.com/e/_x' },
      { product_id: 1005002, product_title: 'Sem link' }
    ] } } } } };
  }]]);
  const { products, hasNextPage } = await searchAliExpressOffers('fone bluetooth', { sort: 'mais-vendidos', page: 2, limit: 20 });
  assert.equal(hasNextPage, true);
  assert.equal(products.length, 1, 'descarta produto sem link de afiliado');
  const [product] = products;
  assert.deepEqual([product.id, product.discount, product.rating, product.sales, product.commissionRate, product.priceValue, product.affiliateUrl],
    ['1005001', 62, 4.8, 1234, 0.07, 35.9, 'https://s.click.aliexpress.com/e/_x']);
  assert.match(product.price, /35,90/);

  // Sem resultados a API responde resp_code 405: vira lista vazia, não erro.
  mockFetch([['api-sg.aliexpress.com', { aliexpress_affiliate_product_query_response: { resp_result: { resp_code: 405, resp_msg: 'The result is empty' } } }]]);
  assert.deepEqual(await searchAliExpressOffers('xyz'), { products: [], hasNextPage: false });
});

test('loja desativada no painel bloqueia os links dela', async () => {
  process.env.STORE_SHOPEE = 'false';
  await assert.rejects(resolveProduct('https://shopee.com.br/product/1/2'), /Shopee está desativada/);
  delete process.env.STORE_SHOPEE;
});

test('Mercado Livre: anúncio recebe os parâmetros de afiliado', async () => {
  mockFetch([['/items/MLB123456789', { id: 'MLB123456789', title: 'Fone', price: 99.9, currency_id: 'BRL', permalink: 'https://produto.mercadolivre.com.br/MLB-123456789-fone', pictures: [{ secure_url: 'https://img/ml.jpg' }] }]]);
  const product = await getMercadoLivreProduct('https://produto.mercadolivre.com.br/MLB-123456789-fone-_JM');
  assert.equal(product.affiliateUrl, 'https://produto.mercadolivre.com.br/MLB-123456789-fone?matt_word=meucodigo&matt_tool=123');
  assert.match(product.price, /99,90/);
  assert.equal(product.image, 'https://img/ml.jpg');
});

test('Mercado Livre: página de catálogo usa /products e o vencedor da buy box', async () => {
  mockFetch([['/products/MLB19615316', { id: 'MLB19615316', name: 'Fone Catálogo', permalink: 'https://www.mercadolivre.com.br/fone/p/MLB19615316', pictures: [{ url: 'http://img/c.jpg' }], buy_box_winner: { price: 150, currency_id: 'BRL' } }]]);
  const product = await getMercadoLivreProduct('https://www.mercadolivre.com.br/fone/p/MLB19615316', 'matt_word=x');
  assert.equal(product.title, 'Fone Catálogo');
  assert.equal(product.image, 'https://img/c.jpg');
  assert.match(product.price, /150,00/);
});

test('Mercado Livre: renova o token e guarda o novo refresh token', async () => {
  Object.assign(process.env, { ML_CLIENT_ID: 'cid', ML_CLIENT_SECRET: 'csecret', ML_REFRESH_TOKEN: 'TG-antigo' });
  const settings = new Map();
  const store = { getSetting: (key) => settings.get(key), setSetting: (key, value) => settings.set(key, value) };
  mockFetch([
    ['/oauth/token', (url, options) => {
      assert.equal(new URLSearchParams(options.body).get('refresh_token'), settings.get('ml_refresh_token') || 'TG-antigo');
      return { access_token: 'APP_USR-novo', refresh_token: 'TG-novo', expires_in: 21600 };
    }],
    ['/items/MLB1234567', (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer APP_USR-novo');
      return { id: 'MLB1234567', title: 'X', price: 1, permalink: 'https://produto.mercadolivre.com.br/MLB-1234567-x' };
    }]
  ]);
  await getMercadoLivreProduct('https://produto.mercadolivre.com.br/MLB-1234567-x', '', store);
  await getMercadoLivreProduct('https://produto.mercadolivre.com.br/MLB-1234567-x', '', store);
  assert.equal(settings.get('ml_refresh_token'), 'TG-novo');
  assert.equal(calls.filter(({ url }) => url.includes('/oauth/token')).length, 1, 'token deve ficar em cache');
});

test('Mercado Livre: 403 em anúncio pede o link do catálogo; 403 em catálogo pede credenciais', async () => {
  mockFetch([['/items/', { status: 403, body: { message: 'forbidden' } }]]);
  await assert.rejects(getMercadoLivreProduct('https://produto.mercadolivre.com.br/MLB-1234567-x'), /\/p\/MLB/);
  mockFetch([['/products/', { status: 403, body: { message: 'forbidden' } }]]);
  await assert.rejects(getMercadoLivreProduct('https://www.mercadolivre.com.br/x/p/MLB123'), /Configure ML_CLIENT_ID e ML_CLIENT_SECRET/);
});

test('Mercado Livre: só com ID e segredo usa client_credentials; sem preço no catálogo, avisa', async () => {
  Object.assign(process.env, { ML_CLIENT_ID: 'cid', ML_CLIENT_SECRET: 'csecret' });
  mockFetch([
    ['/oauth/token', (url, options) => {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('grant_type'), 'client_credentials');
      assert.equal(body.get('refresh_token'), null);
      return { access_token: 'APP_USR-app', expires_in: 21600 };
    }],
    ['/products/MLB76716558', (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer APP_USR-app');
      return { id: 'MLB76716558', name: 'Fone JBL', permalink: '', pictures: [{ url: 'https://img/jbl.jpg' }], buy_box_winner: null };
    }]
  ]);
  const product = await getMercadoLivreProduct('https://www.mercadolivre.com.br/fone-jbl/p/MLB76716558#reco', 'matt_word=x');
  assert.equal(product.price, 'Confira o preço no site');
  assert.equal(product.affiliateUrl, 'https://www.mercadolivre.com.br/p/MLB76716558?matt_word=x');
});

test('Mercado Livre: preço vem da oferta mais barata, com desconto real e frete grátis', async () => {
  mockFetch([
    ['/products/MLB55762063/items', { results: [
      { item_id: 'MLB2', price: 930, original_price: null, currency_id: 'BRL', shipping: { free_shipping: false } },
      { item_id: 'MLB1', price: 889, original_price: 1099, currency_id: 'BRL', shipping: { free_shipping: true } }
    ] }],
    ['/products/MLB55762063', { id: 'MLB55762063', name: 'Moto G06', permalink: '', pictures: [{ url: 'https://img/g06.jpg' }], buy_box_winner: null }]
  ]);
  const product = await getMercadoLivreProduct('https://www.mercadolivre.com.br/moto-g06/p/MLB55762063', 'matt_word=x');
  assert.match(product.price, /889,00/);
  assert.deepEqual([product.priceValue, product.discount, product.freeShipping, product.rating, product.sales], [889, 19, true, null, null]);
  assert.equal(product.affiliateUrl, 'https://www.mercadolivre.com.br/p/MLB55762063?matt_word=x');
});

test('Mercado Livre: busca automática usa os mais vendidos da categoria da palavra-chave', async () => {
  resetMercadoLivreCache();
  process.env.ML_AFFILIATE_PARAMS = 'matt_word=x';
  const requested = [];
  const product = (id) => ({ id, name: `Produto ${id}`, pictures: [{ url: `https://img/${id}.jpg` }] });
  mockFetch([
    ['domain_discovery', (url) => { requested.push('discovery'); assert.match(url, /q=caixa%20de%20som/); return [{ category_id: 'MLB40336' }]; }],
    // A categoria da palavra não tem mais vendidos: sobe para a categoria pai.
    ['/highlights/MLB/category/MLB40336', { status: 404, body: { message: 'not found' } }],
    ['/categories/MLB40336', { path_from_root: [{ id: 'MLB1000' }, { id: 'MLB3835' }, { id: 'MLB40336' }] }],
    ['/highlights/MLB/category/MLB3835', (url) => { requested.push('highlights-pai'); return { content: [
      { id: 'MLB10', type: 'PRODUCT' }, { id: 'MLB999', type: 'ITEM' }, { id: 'MLB11', type: 'PRODUCT' },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `MLB2${i}`, type: 'PRODUCT' }))
    ] }; }],
    ['/products/MLB11/items', { status: 404, body: { message: 'No winners found' } }],
    ['/items', (url) => ({ results: [{ price: 99.9, original_price: 149.9, currency_id: 'BRL', shipping: { free_shipping: true } }] })],
    ['/products/', (url) => product(url.match(/products\/(MLB\d+)/)[1])]
  ]);
  const first = await searchMercadoLivreOffers('caixa de som', { page: 1 });
  assert.deepEqual(first.products.map((item) => item.id), ['MLB10', 'MLB20', 'MLB21', 'MLB22', 'MLB23'], 'pula ITEM e produto sem ofertas; 6 por página');
  assert.equal(first.hasNextPage, true);
  assert.deepEqual([first.products[0].discount, first.products[0].freeShipping, first.products[0].affiliateUrl],
    [33, true, 'https://www.mercadolivre.com.br/p/MLB10?matt_word=x']);
  const second = await searchMercadoLivreOffers('caixa de som', { page: 2 });
  assert.deepEqual(second.products.map((item) => item.id), ['MLB24', 'MLB25']);
  assert.equal(second.hasNextPage, false);
  assert.deepEqual(requested, ['discovery', 'highlights-pai'], 'categoria fica em cache entre as páginas');
});

test('resolveProduct expande link curto antes de consultar a API', async () => {
  const final = 'https://produto.mercadolivre.com.br/MLB-1234567-x';
  mockFetch([
    ['mercadolivre.com/sec/', { url: final, redirected: true, body: null }],
    ['/items/MLB1234567', { id: 'MLB1234567', title: 'X', price: 1, permalink: final }]
  ]);
  // O painel espelha ML_AFFILIATE_PARAMS em process.env.
  process.env.ML_AFFILIATE_PARAMS = 'matt_word=dobanco';
  const store = { getSetting: () => undefined, setSetting() {} };
  const product = await resolveProduct('https://mercadolivre.com/sec/abc123', { store });
  assert.equal(product.affiliateUrl, `${final}?matt_word=dobanco`);
});
