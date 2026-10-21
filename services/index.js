import { getShopeeProduct } from './shopee.js';
import { getAliExpressProduct } from './aliexpress.js';
import { getMercadoLivreProduct } from './mercadolivre.js';
import { resolveFinalUrl } from '../utils/http.js';
import { STORES, storeEnabled } from './stores.js';

// Links curtos que precisam ser expandidos antes de extrair o ID do produto.
const SHORT_HOSTS = /^(s\.shopee\.com\.br|shope\.ee|s\.click\.aliexpress\.com|a\.aliexpress\.com|click\.aliexpress\.com|mercadolivre\.com|meli\.la)$/;

function hostnameOf(input) {
  try { return new URL(input).hostname.toLowerCase().replace(/^www\./, ''); } catch { throw new Error('Envie uma URL válida de produto.'); }
}

export function detectPlatform(input) {
  const hostname = hostnameOf(input);
  if (/(^|\.)(shopee\.com\.br|shope\.ee)$/.test(hostname)) return 'shopee';
  if (/(^|\.)(mercadolivre\.com\.br|mercadolibre\.com|mercadolivre\.com|meli\.la)$/.test(hostname)) return 'mercadolivre';
  if (/(^|\.)(aliexpress\.com|aliexpress\.com\.br|aliexpress\.us)$/.test(hostname)) return 'aliexpress';
  throw new Error('Plataforma não suportada. Use Shopee, AliExpress ou Mercado Livre.');
}

function ensureEnabled(platform) {
  if (!storeEnabled(platform)) throw new Error(`A loja ${STORES[platform].label} está desativada no painel.`);
}

export async function resolveProduct(input, { store = null } = {}) {
  ensureEnabled(detectPlatform(input));
  const url = SHORT_HOSTS.test(hostnameOf(input)) ? await resolveFinalUrl(input) : input;
  const platform = detectPlatform(url);
  ensureEnabled(platform);
  switch (platform) {
    case 'shopee': return getShopeeProduct(url);
    case 'aliexpress': return getAliExpressProduct(url);
    default: return getMercadoLivreProduct(url, process.env.ML_AFFILIATE_PARAMS, store);
  }
}
