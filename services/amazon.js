/**
 * Amazon (Amazon Associados). Sem a API de produtos (a Amazon só libera depois de 3 vendas), o bot
 * faz o que é oficial e não depende dela: o link de afiliado é o link da Amazon com a sua tag
 * (`tag=seutag-20`). Título e preço não são buscados no site (seria scraping): o título vem do
 * link ou do que você escrever, e o preço só aparece se você informar.
 */
export const AMAZON_HOSTS = /(^|\.)(amazon\.com\.br|amzn\.to|a\.co)$/;
const ASIN = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?:[/?]|$)/i;
// Rastreios de outros afiliados e da própria Amazon que não devem ir no link convertido.
const DROP_PARAMS = /^(tag|ascsubtag|linkCode|linkId|ref|ref_|psc|pd_rd_.*|pf_rd_.*|content-id|creative|creativeASIN|camp|th|smid|spLa|sprefix|crid|qid|sr|keywords|dib|dib_tag|_encoding|utm_.*)$/;

export const amazonTag = (env = process.env) => env.AMAZON_TAG?.trim() || '';

export function extractAsin(url) {
  return ASIN.exec(new URL(url).pathname)?.[1]?.toUpperCase() ?? null;
}

/** Link de afiliado: produto vira amazon.com.br/dp/ASIN?tag=…; outras páginas (ofertas, cupons) só ganham a tag. */
export function amazonAffiliateUrl(url, tag = amazonTag()) {
  if (!tag) throw new Error('Preencha a sua tag de afiliado da Amazon (ex.: seutag-20) em Lojas e APIs → Amazon.');
  const parsed = new URL(url);
  const asin = extractAsin(url);
  const result = asin ? new URL(`https://www.amazon.com.br/dp/${asin}`) : parsed;
  if (!asin) for (const key of [...result.searchParams.keys()]) if (DROP_PARAMS.test(key)) result.searchParams.delete(key);
  result.searchParams.set('tag', tag);
  return result.toString();
}

/** Título a partir do link (/Fone-Bluetooth-JBL/dp/…), quando não informado. */
function titleFromUrl(url) {
  const slug = new URL(url).pathname.split('/').find((part, index, parts) => parts[index + 1] === 'dp' && part);
  return slug ? decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim() : '';
}

/** "R$ 199,90" ou "199,90" → número. */
const parsePrice = (text) => {
  const match = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\b/.exec(String(text ?? ''));
  return match ? Number(`${match[1].replace(/\./g, '')}.${match[2]}`) : null;
};

/**
 * Produto da Amazon para postar. `hints.title` e `hints.price` vêm do que o dono escreveu junto do
 * link (no privado do Telegram); sem eles, o título sai do link e o preço fica "confira na Amazon".
 */
export function getAmazonProduct(url, { hints = {} } = {}) {
  const asin = extractAsin(url);
  const priceValue = parsePrice(hints.price);
  const title = hints.title?.trim() || titleFromUrl(url) || 'Oferta na Amazon';
  return {
    platform: 'amazon', platformLabel: 'Amazon', id: asin ?? new URL(url).pathname, title: title.slice(0, 200),
    price: priceValue ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(priceValue) : 'Confira o preço na Amazon',
    priceValue, image: hints.image ?? null, affiliateUrl: amazonAffiliateUrl(url), discount: 0, rating: 0, sales: 0
  };
}

/** Linhas de texto que acompanham o link: a primeira que não é link nem preço é o título; a com R$ é o preço. */
export function hintsFromText(text, link) {
  const lines = String(text ?? '').split('\n').map((line) => line.trim()).filter((line) => line && !line.includes(link) && !/^https?:\/\//.test(line));
  const price = lines.find((line) => parsePrice(line) !== null);
  return { title: lines.find((line) => line !== price) ?? '', price: price ?? '' };
}
