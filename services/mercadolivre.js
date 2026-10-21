import { requestJson } from '../utils/http.js';
import { formatPrice } from './price.js';
import { createMeliLink, linkbuilderEnabled } from './mlLinkbuilder.js';

const API = 'https://api.mercadolibre.com';
const ID = /(ML[A-Z])-?(\d{6,})/i;

/**
 * Distingue anúncio (`/items/MLB123`) de produto de catálogo (`/p/MLB123`, servido por `/products/MLB123`).
 * Em páginas de catálogo, `item_id`/`wid` na query apontam para o anúncio vencedor e têm prioridade.
 */
export function extractMercadoLivreId(url) {
  const parsed = new URL(url);
  const itemParam = parsed.searchParams.get('item_id') || parsed.searchParams.get('wid');
  const fromParam = itemParam?.match(ID);
  if (fromParam) return { type: 'item', id: `${fromParam[1].toUpperCase()}${fromParam[2]}` };
  const path = decodeURIComponent(parsed.pathname);
  const catalog = path.match(/\/p\/(ML[A-Z])(\d+)/i);
  if (catalog) return { type: 'product', id: `${catalog[1].toUpperCase()}${catalog[2]}` };
  const match = path.match(ID);
  if (!match) throw new Error('Não foi possível localizar o ID do item do Mercado Livre na URL.');
  return { type: 'item', id: `${match[1].toUpperCase()}${match[2]}` };
}

export function addAffiliateParams(url, params) {
  if (!params) return url;
  const target = new URL(url);
  const configured = new URLSearchParams(params.replace(/^\?/, ''));
  for (const [key, value] of configured) target.searchParams.set(key, value);
  return target.toString();
}

let tokenCache = null;

/**
 * Com ML_CLIENT_ID/ML_CLIENT_SECRET o token do app é gerado sozinho (client_credentials, dura 6 h).
 * Se houver ML_REFRESH_TOKEN, usa o token do usuário; esse refresh token é de uso único,
 * por isso o novo é salvo no SQLite. Sem ID/segredo, usa ML_ACCESS_TOKEN fixo, se existir.
 */
async function getAccessToken(store, { force = false } = {}) {
  const { ML_CLIENT_ID: clientId, ML_CLIENT_SECRET: clientSecret } = process.env;
  if (!clientId || !clientSecret) return process.env.ML_ACCESS_TOKEN || null;
  if (!force && tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const refreshToken = store?.getSetting('ml_refresh_token') || process.env.ML_REFRESH_TOKEN;
  const grant = refreshToken ? { grant_type: 'refresh_token', refresh_token: refreshToken } : { grant_type: 'client_credentials' };
  const body = await requestJson(`${API}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ ...grant, client_id: clientId, client_secret: clientSecret })
  }).catch((error) => { throw new Error(`Mercado Livre: falha ao obter o token (${error.message}). Confira ML_CLIENT_ID/ML_CLIENT_SECRET${refreshToken ? ' e gere um novo ML_REFRESH_TOKEN' : ''}.`); });
  if (body.refresh_token) store?.setSetting('ml_refresh_token', body.refresh_token);
  tokenCache = { token: body.access_token, expiresAt: Date.now() + (Number(body.expires_in || 21600) - 300) * 1000 };
  return tokenCache.token;
}

export function resetMercadoLivreToken() { tokenCache = null; }

async function mlGet(path, store) {
  const get = (token) => requestJson(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  try {
    return await get(await getAccessToken(store));
  } catch (error) {
    if (error.status === 401 && process.env.ML_CLIENT_ID) return get(await getAccessToken(store, { force: true }));
    if ((error.status === 401 || error.status === 403) && path.startsWith('/items/')) {
      throw new Error('O Mercado Livre não libera dados de anúncios avulsos para aplicativos. Use o link da página do produto (o que tem /p/MLB… no endereço).');
    }
    if (error.status === 401 || error.status === 403) {
      throw new Error('Mercado Livre recusou o acesso (HTTP ' + error.status + '). Configure ML_CLIENT_ID e ML_CLIENT_SECRET.');
    }
    if (error.status === 404) throw Object.assign(new Error('Produto não encontrado no Mercado Livre.'), { notFound: true });
    throw error;
  }
}

/** Como mlGet, mas devolve null em 404 (produto sem ofertas ativas, categoria sem mais vendidos…). */
async function mlGetOptional(path, store) {
  try { return await mlGet(path, store); } catch (error) { if (error.notFound) return null; throw error; }
}

/**
 * Menor preço entre as ofertas ativas de um produto de catálogo. O buy_box_winner do /products
 * vem vazio para tokens de aplicativo, mas /products/{id}/items lista as ofertas com preço.
 */
async function bestOffer(productId, store) {
  const data = await mlGetOptional(`/products/${productId}/items?limit=20`, store);
  const offers = (data?.results ?? []).filter((offer) => Number(offer.price) > 0);
  return offers.reduce((best, offer) => (!best || Number(offer.price) < Number(best.price) ? offer : best), null);
}

function catalogToProduct(catalog, offer, affiliateParams) {
  const price = Number(offer?.price) || Number(catalog.buy_box_winner?.price) || null;
  // Desconto calculado a partir do preço original informado pelo próprio Mercado Livre.
  const original = Number(offer?.original_price) || 0;
  return {
    platform: 'mercadolivre', platformLabel: 'Mercado Livre', id: catalog.id, title: catalog.name,
    price: price ? formatPrice(price, offer?.currency_id || 'BRL') : 'Confira o preço no site',
    priceValue: price, discount: original > price ? Math.round((1 - price / original) * 100) : 0,
    originalPrice: original > price ? original : null,
    freeShipping: Boolean(offer?.shipping?.free_shipping),
    // A API não informa nota, vendas nem comissão: null faz esses filtros não se aplicarem a esta loja.
    rating: null, sales: null, commissionRate: null,
    image: catalog.pictures?.[0]?.url?.replace('http://', 'https://'),
    ...affiliateFields(catalog.permalink || `https://www.mercadolivre.com.br/p/${catalog.id}`, affiliateParams)
  };
}

/**
 * Modo parâmetros: anexa matt_word/matt_tool. Modo meli.la: guarda a URL do produto e marca
 * `needsMeliLink`; o meli.la é gerado só quando a oferta vai ser mostrada ou postada (ensureMeliLink).
 */
function affiliateFields(productUrl, affiliateParams) {
  if (linkbuilderEnabled()) return { affiliateUrl: productUrl, productUrl, needsMeliLink: true };
  return { affiliateUrl: addAffiliateParams(productUrl, affiliateParams), productUrl };
}

/** Troca a URL do produto pelo meli.la (modo Linkbuilder). Não faz nada nos outros casos. */
export async function ensureMeliLink(product) {
  if (!product?.needsMeliLink) return product;
  product.affiliateUrl = await createMeliLink(product.productUrl);
  product.needsMeliLink = false;
  return product;
}

export async function getMercadoLivreProduct(url, affiliateParams = process.env.ML_AFFILIATE_PARAMS, store = null) {
  const { type, id } = extractMercadoLivreId(url);
  if (type === 'product') {
    const [catalog, offer] = await Promise.all([mlGet(`/products/${id}`, store), bestOffer(id, store)]);
    if (!catalog?.id) throw new Error('Produto não encontrado no Mercado Livre.');
    return ensureMeliLink(catalogToProduct(catalog, offer, affiliateParams));
  }
  const item = await mlGet(`/items/${id}`, store);
  if (!item?.id) throw new Error('Produto não encontrado no Mercado Livre.');
  return ensureMeliLink({
    platform: 'mercadolivre', platformLabel: 'Mercado Livre', id: item.id, title: item.title,
    price: formatPrice(item.price, item.currency_id || 'BRL'), priceValue: Number(item.price) || null,
    image: (item.pictures?.[0]?.secure_url || item.thumbnail)?.replace('http://', 'https://'),
    ...affiliateFields(item.permalink || url, affiliateParams)
  });
}

const CATEGORY_TTL_MS = 6 * 60 * 60 * 1000;
const PAGE_SIZE = 6;
const bestSellerCache = new Map();

/**
 * Palavra-chave → categoria (domain_discovery) → mais vendidos da categoria (highlights).
 * Nem toda categoria tem lista de mais vendidos; nesse caso sobe até duas categorias na árvore.
 */
async function bestSellerIds(keyword, store, category) {
  const cacheKey = category ? `cat:${category}` : keyword;
  const cached = bestSellerCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.ids;
  // Nichos já trazem a categoria; palavras livres passam pelo domain_discovery.
  let categoryId = category ?? (await mlGetOptional(`/sites/MLB/domain_discovery/search?q=${encodeURIComponent(keyword)}&limit=1`, store))?.[0]?.category_id;
  let ids = [];
  for (let level = 0; categoryId && level < 3; level += 1) {
    const highlights = await mlGetOptional(`/highlights/MLB/category/${categoryId}`, store);
    // Itens avulsos (type ITEM) são bloqueados para apps; só produtos de catálogo servem.
    ids = (highlights?.content ?? []).filter((entry) => entry.type === 'PRODUCT').map((entry) => entry.id);
    if (ids.length) break;
    const path = (await mlGetOptional(`/categories/${categoryId}`, store))?.path_from_root ?? [];
    categoryId = path.length > 1 ? path[path.length - 2].id : null;
  }
  bestSellerCache.set(cacheKey, { ids, expiresAt: Date.now() + CATEGORY_TTL_MS });
  return ids;
}

export function resetMercadoLivreCache() { bestSellerCache.clear(); }

/** Busca ofertas para a postagem automática: os mais vendidos da categoria da palavra-chave, com preço. */
export async function searchMercadoLivreOffers(keyword, { sort = 'mais-vendidos', page = 1, store = null, category } = {}) {
  const ids = await bestSellerIds(keyword, store, category);
  const slice = ids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const products = (await Promise.all(slice.map(async (id) => {
    const [catalog, offer] = await Promise.all([mlGetOptional(`/products/${id}`, store), bestOffer(id, store)]);
    return catalog?.id && offer ? catalogToProduct(catalog, offer, process.env.ML_AFFILIATE_PARAMS) : null;
  }))).filter(Boolean);
  if (sort === 'menor-preco') products.sort((a, b) => a.priceValue - b.priceValue);
  if (sort === 'maior-preco') products.sort((a, b) => b.priceValue - a.priceValue);
  return { products, hasNextPage: page * PAGE_SIZE < ids.length };
}
