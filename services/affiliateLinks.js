import { detectPlatform } from './index.js';
import { STORES, storeEnabled } from './stores.js';
import { generateShopeeLink } from './shopee.js';
import { generateAliExpressLink } from './aliexpress.js';
import { addAffiliateParams } from './mercadolivre.js';
import { createMeliLink, linkbuilderEnabled } from './mlLinkbuilder.js';
import { resolveFinalUrl } from '../utils/http.js';
import { amazonAffiliateUrl } from './amazon.js';

// Links curtos de terceiros podem carregar o rastreio de outro afiliado: expandimos antes de converter.
const SHORT_HOSTS = /^(s\.shopee\.com\.br|shope\.ee|s\.click\.aliexpress\.com|a\.aliexpress\.com|click\.aliexpress\.com|mercadolivre\.com|amzn\.to|a\.co)$/;
// Parâmetros de rastreio que não devem ir para o link convertido.
const TRACKING_PARAMS = /^(utm_|af_|mmp_|sp_atk$|xptdk$|smtt$|aff_|matt_|ref$|forceInApp$)/;

function cleanUrl(url) {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
  return parsed.toString();
}

/**
 * Converte qualquer link de loja (página de cupom, campanha, loja ou produto) em link de afiliado,
 * usando a API oficial de cada loja. Um meli.la é mantido como está: já é o seu link gerado no portal.
 */
export async function toAffiliateLink(input) {
  let url;
  try { url = new URL(String(input).trim()).toString(); } catch { throw new Error('Informe um link válido da loja.'); }
  const platform = detectPlatform(url);
  if (!storeEnabled(platform)) throw new Error(`A loja ${STORES[platform].label} está desativada no painel.`);
  const host = new URL(url).hostname.replace(/^www\./, '');
  if (host === 'meli.la') return { platform, affiliateUrl: url };
  const target = cleanUrl(SHORT_HOSTS.test(host) ? await resolveFinalUrl(url) : url);
  if (platform === 'shopee') return { platform, affiliateUrl: await generateShopeeLink(target) };
  if (platform === 'aliexpress') return { platform, affiliateUrl: await generateAliExpressLink(target) };
  if (platform === 'amazon') return { platform, affiliateUrl: amazonAffiliateUrl(target) };
  if (linkbuilderEnabled()) return { platform, affiliateUrl: await createMeliLink(target) };
  if (!process.env.ML_AFFILIATE_PARAMS) throw new Error('Preencha os parâmetros de afiliado do Mercado Livre (matt_word e matt_tool) ou use um link meli.la.');
  return { platform, affiliateUrl: addAffiliateParams(target, process.env.ML_AFFILIATE_PARAMS) };
}
