import { getShopeeProduct } from './shopee.js';
import { getAliExpressProduct } from './aliexpress.js';
import { getMercadoLivreProduct } from './mercadolivre.js';
import { AMAZON_HOSTS, getAmazonProduct } from './amazon.js';
import { resolveFinalUrl } from '../utils/http.js';
import { STORES, storeEnabled } from './stores.js';

// Links curtos que precisam ser expandidos antes de extrair o ID do produto.
const SHORT_HOSTS = /^(s\.shopee\.com\.br|shope\.ee|s\.click\.aliexpress\.com|a\.aliexpress\.com|click\.aliexpress\.com|mercadolivre\.com|meli\.la|amzn\.to|a\.co)$/;

function hostnameOf(input) {
  try { return new URL(input).hostname.toLowerCase().replace(/^www\./, ''); } catch { throw new Error('Envie uma URL válida de produto.'); }
}

export function detectPlatform(input) {
  const hostname = hostnameOf(input);
  if (/(^|\.)(shopee\.com\.br|shope\.ee)$/.test(hostname)) return 'shopee';
  if (/(^|\.)(mercadolivre\.com\.br|mercadolibre\.com|mercadolivre\.com|meli\.la)$/.test(hostname)) return 'mercadolivre';
  if (/(^|\.)(aliexpress\.com|aliexpress\.com\.br|aliexpress\.us)$/.test(hostname)) return 'aliexpress';
  if (AMAZON_HOSTS.test(hostname)) return 'amazon';
  throw new Error('Plataforma não suportada. Use Shopee, AliExpress, Mercado Livre ou Amazon.');
}

function ensureEnabled(platform) {
  if (!storeEnabled(platform)) throw new Error(`A loja ${STORES[platform].label} está desativada no painel.`);
}

/** `hints` (título/preço escritos pelo dono) só são usados na Amazon, que não tem API de produtos liberada. */
export async function resolveProduct(input, { store = null, hints } = {}) {
  ensureEnabled(detectPlatform(input));
  const url = SHORT_HOSTS.test(hostnameOf(input)) ? await resolveFinalUrl(input) : input;
  const platform = detectPlatform(url);
  ensureEnabled(platform);
  switch (platform) {
    case 'shopee': return getShopeeProduct(url);
    case 'aliexpress': return getAliExpressProduct(url);
    case 'amazon': return getAmazonProduct(url, { hints });
    default: return getMercadoLivreProduct(url, process.env.ML_AFFILIATE_PARAMS, store);
  }
}
