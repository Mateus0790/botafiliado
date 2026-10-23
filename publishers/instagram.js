import { requestJson } from '../utils/http.js';
import { buyLabel, originalPriceText } from '../utils/embed.js';

/**
 * Instagram pela API oficial com login do Instagram (graph.instagram.com): publica a foto da
 * oferta e, para quem comenta a palavra-chave, manda o link no direct (resposta privada a
 * comentário). Link na legenda não é clicável no Instagram; no direct é.
 */
const API = 'https://graph.instagram.com/v23.0';
const CAPTION_LIMIT = 2200;
const DM_LIMIT = 1000;
const STATUS_TRIES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const instagramConfigured = (env = process.env) => Boolean(env.INSTAGRAM_TOKEN);
export const instagramKeyword = (env = process.env) => env.INSTAGRAM_KEYWORD?.trim() || 'QUERO';

export async function callInstagram(path, { method = 'GET', params, body, env = process.env } = {}) {
  const url = new URL(`${API}/${path}`);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  try {
    return await requestJson(url, {
      method,
      headers: { authorization: `Bearer ${env.INSTAGRAM_TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (error) {
    throw new Error(`Instagram: ${error.body?.error?.error_user_msg || error.body?.error?.message || error.message}`);
  }
}

const normalize = (text) => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** "quero", "Quero!!", "eu quero 🙋" contam; "querosene" não. */
export function matchesKeyword(text, keyword = instagramKeyword()) {
  const word = normalize(keyword).trim();
  if (!word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(normalize(text));
}

const hashtags = (env) => (env.INSTAGRAM_HASHTAGS ?? 'achadinhos,promoção,ofertas').split(',')
  .map((tag) => tag.trim().replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean).slice(0, 30).map((tag) => `#${tag}`).join(' ');

export function instagramCaption(product, { env = process.env } = {}) {
  const original = originalPriceText(product);
  const highlights = [`${original ? `De ${original} por ` : ''}💰 ${product.price}`];
  if (product.discount) highlights.push(`🏷️ ${product.discount}% OFF`);
  const details = [highlights.join('  ·  ')];
  if (product.rating) details.push(`⭐ ${product.rating.toFixed(1)}  ·  ${product.sales.toLocaleString('pt-BR')} vendidos`);
  if (product.freeShipping) details.push('🚚 Frete grátis');
  const header = product.header ?? (env.POST_HEADER?.trim() || '🚨 PROMOÇÃO ENCONTRADA!');
  const cta = `💬 Comente ${instagramKeyword(env).toUpperCase()} que eu te mando o link no direct!`;
  const build = (title) => [header, title, details.join('\n'), cta, hashtags(env)].filter(Boolean).join('\n\n');
  const caption = build(product.title);
  return caption.length <= CAPTION_LIMIT ? caption : build(`${product.title.slice(0, product.title.length - (caption.length - CAPTION_LIMIT) - 1)}…`);
}

/** Texto do direct com o link de afiliado. */
export function instagramDm(post, { env = process.env } = {}) {
  const intro = env.INSTAGRAM_DM?.trim() || 'Oi! Aqui está o link da oferta 👇';
  const tail = `💰 ${post.price}\n\n🛒 ${buyLabel(post)}:\n${post.affiliateUrl}`;
  const room = DM_LIMIT - intro.length - tail.length - 4;
  const title = post.title.length > room ? `${post.title.slice(0, Math.max(0, room - 1))}…` : post.title;
  return [intro, title, tail].join('\n\n');
}

/** O Instagram só aceita JPEG; o Mercado Livre às vezes entrega .webp, mas tem o mesmo arquivo em .jpg. */
export const instagramImageUrl = (url) => (/mlstatic\.com\//.test(url) ? url.replace(/\.webp(\?|$)/, '.jpg$1') : url);

const skip = (message) => Object.assign(new Error(message), { skipped: true });

/**
 * Publica a oferta como foto no feed. Respeita o limite diário configurado: acima dele a
 * oferta só não vai para o Instagram (sem erro). Guarda o post para o "comente e receba".
 */
export async function sendInstagramOffer(product, { store, env = process.env, wait = sleep } = {}) {
  if (!product.image) throw skip('oferta sem foto');
  const limit = Number(env.INSTAGRAM_MAX_PER_DAY || 10);
  if (store && store.countInstagramPostsSince(new Date(Date.now() - DAY_MS)) >= limit) throw skip(`limite de ${limit} posts por dia atingido`);

  const container = await callInstagram('me/media', { method: 'POST', body: { image_url: instagramImageUrl(product.image), caption: instagramCaption(product, { env }) }, env });
  for (let attempt = 0; attempt < STATUS_TRIES; attempt += 1) {
    const { status_code: status } = await callInstagram(container.id, { params: { fields: 'status_code' }, env });
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`Instagram: não aceitou a foto da oferta (${status}).`);
    await wait(2000);
  }
  const media = await callInstagram('me/media_publish', { method: 'POST', body: { creation_id: container.id }, env });
  store?.saveInstagramPost(media.id, product);
  return media;
}

/** Confere o token sem publicar nada. */
export async function checkInstagram(env = process.env) {
  const me = await callInstagram('me', { params: { fields: 'user_id,username,account_type' }, env });
  return { username: me.username, userId: String(me.user_id ?? me.id), accountType: me.account_type };
}
