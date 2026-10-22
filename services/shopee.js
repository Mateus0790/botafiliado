import crypto from 'node:crypto';
import { requestJson } from '../utils/http.js';
import { formatPrice } from './price.js';

const API_URL = () => process.env.SHOPEE_API_URL || 'https://open-api.affiliate.shopee.com.br/graphql';

/**
 * Affiliate Open API da Shopee: Signature = SHA256(AppId + Timestamp + Payload + Secret), em hexadecimal,
 * onde Payload é o JSON exatamente enviado no corpo. Vai no header
 * `Authorization: SHA256 Credential=<AppId>, Timestamp=<unix s>, Signature=<hash>`.
 */
export function createShopeeSignature(appId, timestamp, payload, secret) {
  return crypto.createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`, 'utf8').digest('hex');
}

export function shopeeAuthorization(appId, secret, payload, timestamp = Math.floor(Date.now() / 1000)) {
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${createShopeeSignature(appId, timestamp, payload, secret)}`;
}

/** Aceita URLs nos formatos `/nome-do-produto-i.<shopId>.<itemId>` e `/product/<shopId>/<itemId>`. */
export function extractShopeeIds(url) {
  const { pathname } = new URL(url);
  const match = pathname.match(/-i\.(\d+)\.(\d+)/) || pathname.match(/\/(\d+)\/(\d+)\/?$/);
  if (!match) throw new Error('Não foi possível localizar o ID da loja/produto na URL da Shopee.');
  return { shopId: match[1], itemId: match[2] };
}

async function graphql(query) {
  const { SHOPEE_APP_ID: appId, SHOPEE_APP_SECRET: secret } = process.env;
  if (!appId || !secret) throw new Error('Credenciais Shopee ausentes (SHOPEE_APP_ID/SHOPEE_APP_SECRET).');
  const payload = JSON.stringify({ query });
  const body = await requestJson(API_URL(), {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: shopeeAuthorization(appId, secret, payload) }, body: payload
  });
  if (body.errors?.length) {
    const [error] = body.errors;
    const code = error.extensions?.code ? ` (código ${error.extensions.code})` : '';
    throw new Error(`Shopee: ${error.message}${code}`);
  }
  return body.data;
}

const NODE_FIELDS = 'itemId shopId productName priceMin priceMax priceDiscountRate commissionRate sales ratingStar imageUrl productLink offerLink';

function toProduct(node, affiliateUrl) {
  const min = Number(node.priceMin);
  const max = Number(node.priceMax);
  const price = !min ? 'Preço indisponível' : max > min ? `${formatPrice(min)} a ${formatPrice(max)}` : formatPrice(min);
  return {
    platform: 'shopee', platformLabel: 'Shopee', id: String(node.itemId), title: node.productName, price, image: node.imageUrl, affiliateUrl,
    priceValue: min || null, discount: Number(node.priceDiscountRate) || 0, commissionRate: Number(node.commissionRate) || 0,
    sales: Number(node.sales) || 0, rating: Number(node.ratingStar) || 0
  };
}

/** Converte qualquer link da Shopee (produto, cupom, campanha, loja) em link curto de afiliado. */
export async function generateShopeeLink(originUrl) {
  const result = await graphql(`mutation { generateShortLink(input: { originUrl: ${JSON.stringify(originUrl)}, subIds: ["botafiliado"] }) { shortLink } }`);
  const shortLink = result?.generateShortLink?.shortLink;
  if (!shortLink) throw new Error('A Shopee não gerou o link de afiliado.');
  return shortLink;
}

const shortLinkFor = (originUrl) => generateShopeeLink(originUrl).catch(() => null);

export async function getShopeeProduct(url) {
  const { shopId, itemId } = extractShopeeIds(url);
  const data = await graphql(`{ productOfferV2(shopId: ${shopId}, itemId: ${itemId}) { nodes { ${NODE_FIELDS} } } }`);
  const node = data?.productOfferV2?.nodes?.[0];
  if (!node?.itemId) throw new Error('Produto não encontrado na Shopee ou fora do programa de afiliados.');
  const affiliateUrl = await shortLinkFor(node.productLink || `https://shopee.com.br/product/${shopId}/${itemId}`) || node.offerLink;
  if (!affiliateUrl) throw new Error('A Shopee não retornou um link de afiliado para este produto.');
  return toProduct(node, affiliateUrl);
}

/** Ordenações aceitas por productOfferV2 (sortType). */
export const SHOPEE_SORT = { relevancia: 1, 'mais-vendidos': 2, 'maior-preco': 3, 'menor-preco': 4, 'maior-comissao': 5 };

/**
 * Busca ofertas por palavra-chave. O offerLink já é o link de afiliado da sua conta,
 * então não é preciso gerar link curto para cada resultado.
 */
export async function searchShopeeOffers(keyword, { sortType = SHOPEE_SORT['mais-vendidos'], page = 1, limit = 20 } = {}) {
  const data = await graphql(`{ productOfferV2(keyword: ${JSON.stringify(keyword)}, sortType: ${Number(sortType)}, page: ${Number(page)}, limit: ${Number(limit)}) { nodes { ${NODE_FIELDS} } pageInfo { hasNextPage } } }`);
  const nodes = data?.productOfferV2?.nodes ?? [];
  return {
    products: nodes.filter((node) => node.itemId && node.offerLink).map((node) => toProduct(node, node.offerLink)),
    hasNextPage: Boolean(data?.productOfferV2?.pageInfo?.hasNextPage)
  };
}

/**
 * Campanhas ativas da Shopee (cupons, frete grátis, datas especiais) pelo shopeeOfferV2, já com o
 * link de afiliado (offerLink). A Shopee não informa códigos: o cupom é pego na página da campanha.
 */
export async function searchShopeePromotions({ keyword = '', page = 1, limit = 30 } = {}) {
  const args = [`sortType: 1`, `page: ${Number(page)}`, `limit: ${Number(limit)}`, keyword && `keyword: ${JSON.stringify(keyword)}`].filter(Boolean).join(', ');
  const data = await graphql(`{ shopeeOfferV2(${args}) { nodes { offerName offerLink originalLink imageUrl periodStartTime periodEndTime } } }`);
  const time = (seconds) => (Number(seconds) > 0 ? new Date(Number(seconds) * 1000).toISOString() : null);
  return (data?.shopeeOfferV2?.nodes ?? []).filter((node) => node.offerName && node.offerLink).map((node) => ({
    platform: 'shopee', key: `shopee:${node.originalLink || node.offerLink}`, title: node.offerName, code: '', description: '',
    url: node.originalLink || node.offerLink, affiliateUrl: node.offerLink, startsAt: time(node.periodStartTime), expiresAt: time(node.periodEndTime)
  }));
}
