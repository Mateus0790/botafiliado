import crypto from 'node:crypto';
import { requestJson } from '../utils/http.js';
import { formatPrice } from './price.js';

const API_URL = () => process.env.ALIEXPRESS_API_URL || 'https://api-sg.aliexpress.com/sync';

/**
 * AliExpress Open Platform (sign_method=md5): MD5 em hexadecimal maiúsculo de
 * APP_SECRET + (chaves ordenadas concatenadas aos seus valores) + APP_SECRET.
 * Todos os parâmetros entram no cálculo, inclusive sign_method; só o próprio sign fica de fora.
 */
export function createAliExpressSignature(params, secret) {
  const data = Object.keys(params).filter((key) => key !== 'sign').sort()
    .map((key) => `${key}${params[key]}`).join('');
  return crypto.createHash('md5').update(`${secret}${data}${secret}`, 'utf8').digest('hex').toUpperCase();
}

/** Aceita `/item/1005001234567890.html` e variações regionais (pt., m., aliexpress.us...). */
export function extractAliExpressId(url) {
  const match = new URL(url).pathname.match(/\/(\d{6,})\.html/);
  if (!match) throw new Error('Não foi possível localizar o ID do produto na URL do AliExpress.');
  return match[1];
}

function credentials() {
  const { ALIEXPRESS_APP_KEY: appKey, ALIEXPRESS_APP_SECRET: secret, ALIEXPRESS_TRACKING_ID: trackingId } = process.env;
  if (!appKey || !secret || !trackingId) throw new Error('Credenciais AliExpress ausentes (APP_KEY, APP_SECRET ou TRACKING_ID).');
  return { appKey, secret, trackingId };
}

export function buildAliExpressParams(method, parameters, { appKey, secret }, timestamp = Date.now()) {
  const params = { app_key: appKey, method, sign_method: 'md5', timestamp: String(timestamp), format: 'json', v: '2.0', ...parameters };
  params.sign = createAliExpressSignature(params, secret);
  return params;
}

// resp_code 405 é a resposta da busca quando nenhum produto atende aos parâmetros.
const EMPTY_RESULT = 405;

function unwrap(body, method, { allowEmpty = false } = {}) {
  if (body?.error_response) {
    const { msg, sub_msg: subMsg, code } = body.error_response;
    throw new Error(`AliExpress: ${subMsg || msg || 'requisição recusada'}${code ? ` (código ${code})` : ''}`);
  }
  const result = body?.[`${method.replaceAll('.', '_')}_response`]?.resp_result;
  if (!result) throw new Error('Resposta inesperada da API AliExpress.');
  if (allowEmpty && Number(result.resp_code) === EMPTY_RESULT) return null;
  if (Number(result.resp_code) !== 200) throw new Error(`AliExpress: ${result.resp_msg || 'requisição recusada'} (código ${result.resp_code})`);
  return result.result;
}

async function call(method, parameters, options) {
  const params = buildAliExpressParams(method, parameters, credentials());
  return unwrap(await requestJson(API_URL(), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: new URLSearchParams(params)
  }), method, options);
}

const regional = () => ({
  target_currency: process.env.ALIEXPRESS_CURRENCY || 'BRL',
  target_language: process.env.ALIEXPRESS_LANGUAGE || 'PT'
});

/** Converte o produto da API para o formato comum (o mesmo da Shopee), usado nos filtros e na mensagem. */
function toProduct(item, affiliateUrl = item.promotion_link) {
  const price = Number(item.target_sale_price);
  const original = Number(item.target_original_price) || 0;
  // evaluate_rate vem como "95.2%" de avaliações positivas; convertido para a escala de 5 estrelas.
  const positive = parseFloat(item.evaluate_rate);
  return {
    platform: 'aliexpress', platformLabel: 'AliExpress', id: String(item.product_id), title: item.product_title,
    price: price ? formatPrice(price, item.target_sale_price_currency || 'BRL') : 'Preço indisponível',
    image: item.product_main_image_url, affiliateUrl,
    priceValue: price || null, discount: parseInt(item.discount, 10) || 0,
    originalPrice: price && original > price ? original : null,
    commissionRate: (parseFloat(item.commission_rate) || 0) / 100,
    sales: Number(item.lastest_volume) || 0,
    rating: Number.isFinite(positive) ? Math.round(positive / 2) / 10 : 0
  };
}

const ALIEXPRESS_SORT = { 'mais-vendidos': 'LAST_VOLUME_DESC', 'menor-preco': 'SALE_PRICE_ASC', 'maior-preco': 'SALE_PRICE_DESC' };

/** Busca ofertas por palavra-chave; o promotion_link já é o link de afiliado com o seu tracking ID. */
export async function searchAliExpressOffers(keyword, { sort = 'mais-vendidos', page = 1, limit = 20 } = {}) {
  const { trackingId } = credentials();
  const pageSize = Math.min(Number(limit), 50);
  const result = await call('aliexpress.affiliate.product.query', {
    keywords: keyword, page_no: String(page), page_size: String(pageSize), tracking_id: trackingId,
    ship_to_country: process.env.ALIEXPRESS_COUNTRY || 'BR', ...regional(),
    ...(ALIEXPRESS_SORT[sort] ? { sort: ALIEXPRESS_SORT[sort] } : {})
  }, { allowEmpty: true });
  const items = result?.products?.product ?? [];
  return {
    products: items.filter((item) => item.product_id && item.promotion_link).map((item) => toProduct(item)),
    hasNextPage: page * pageSize < Number(result?.total_record_count ?? 0)
  };
}

/** Converte qualquer link do AliExpress (produto, cupom, campanha, loja) em link de afiliado. */
export async function generateAliExpressLink(url) {
  const { trackingId } = credentials();
  const links = await call('aliexpress.affiliate.link.generate', { promotion_link_type: '0', source_values: url, tracking_id: trackingId });
  const link = links?.promotion_links?.promotion_link?.[0]?.promotion_link;
  if (!link) throw new Error('O AliExpress não gerou o link de afiliado para este endereço.');
  return link;
}

export async function getAliExpressProduct(url) {
  const id = extractAliExpressId(url);
  const { trackingId } = credentials();
  const detail = await call('aliexpress.affiliate.productdetail.get', {
    product_ids: id, tracking_id: trackingId, ...regional(),
    country: process.env.ALIEXPRESS_COUNTRY || 'BR'
  });
  const product = detail?.products?.product?.[0];
  if (!product?.product_title) throw new Error('Produto não encontrado no AliExpress ou fora do programa de afiliados.');

  const links = await call('aliexpress.affiliate.link.generate', {
    promotion_link_type: '0', source_values: `https://www.aliexpress.com/item/${id}.html`, tracking_id: trackingId
  }).catch(() => null);
  const affiliateUrl = links?.promotion_links?.promotion_link?.[0]?.promotion_link || product.promotion_link;
  if (!affiliateUrl) throw new Error('A API AliExpress não retornou um link de afiliado.');

  return toProduct({ ...product, product_id: product.product_id || id }, affiliateUrl);
}
