import { requestJson } from '../utils/http.js';
import { buyLabel, couponButtonLabel, couponLines, originalPriceText } from '../utils/embed.js';

const CAPTION_LIMIT = 1024;

export function telegramConfigured(env = process.env) {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Legenda em HTML no mesmo estilo do embed do Discord. */
export function telegramCaption(product, { header = `<b>${escapeHtml(product.header ?? (process.env.POST_HEADER?.trim() || '🚨 PROMOÇÃO ENCONTRADA!'))}</b>` } = {}) {
  const original = originalPriceText(product);
  const highlights = [`${original ? `<s>${escapeHtml(original)}</s> → ` : ''}💰 <b>${escapeHtml(product.price)}</b>`];
  if (product.discount) highlights.push(`🏷️ <b>${product.discount}% OFF</b>`);
  const details = [highlights.join('  ·  ')];
  if (product.rating) details.push(`⭐ ${product.rating.toFixed(1)}  ·  ${product.sales.toLocaleString('pt-BR')} vendidos`);
  if (product.freeShipping) details.push('🚚 Frete grátis');
  const build = (title) => [header, `<b>${escapeHtml(title)}</b>`, details.join('\n')].filter(Boolean).join('\n\n');
  const caption = build(product.title);
  // Títulos muito longos são cortados para caber no limite de legenda de foto.
  return caption.length <= CAPTION_LIMIT ? caption : build(`${product.title.slice(0, product.title.length - (caption.length - CAPTION_LIMIT) - 1)}…`);
}

export async function callTelegram(method, payload, env = process.env) {
  try {
    const body = await requestJson(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (!body.ok) throw Object.assign(new Error(body.description || 'resposta inválida'), { body });
    return body.result;
  } catch (error) {
    throw new Error(`Telegram: ${error.body?.description || error.message}`);
  }
}

/**
 * Envia foto + legenda + botão de compra; se a foto falhar (URL recusada), manda só o texto.
 * `chatId` e `extraButtons` servem para a prévia no privado do dono (botões Postar/Descartar).
 */
export async function sendTelegramOffer(product, { env = process.env, chatId = env.TELEGRAM_CHAT_ID, extraButtons = [] } = {}) {
  const base = {
    chat_id: chatId, parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: `🛒 ${buyLabel(product)}`, url: product.affiliateUrl }], ...extraButtons] }
  };
  const caption = telegramCaption(product);
  if (product.image) {
    try {
      return await callTelegram('sendPhoto', { ...base, photo: product.image, caption }, env);
    } catch (error) {
      if (!/photo|image|file|wrong type|url/i.test(error.message)) throw error;
    }
  }
  return callTelegram('sendMessage', { ...base, text: caption, link_preview_options: { is_disabled: true } }, env);
}

export function telegramCouponText(coupon, { header = process.env.COUPON_HEADER?.trim() || '🎟️ CUPOM DE DESCONTO!' } = {}) {
  // <code> deixa o código copiável com um toque no Telegram.
  const lines = couponLines({ ...coupon, description: coupon.description && escapeHtml(coupon.description) }, { code: (text) => `<code>${escapeHtml(text)}</code>` });
  return [`<b>${escapeHtml(header)}</b>`, `<b>${escapeHtml(coupon.title)}</b>`, lines.join('\n')].filter(Boolean).join('\n\n');
}

export async function sendTelegramCoupon(coupon, { env = process.env } = {}) {
  const buttons = [[{ text: `🎟️ ${couponButtonLabel(coupon)}`, url: coupon.affiliateUrl }],
    ...(coupon.extraAffiliateUrl ? [[{ text: `🛒 ${coupon.extraLabel || 'Link do carrinho'}`, url: coupon.extraAffiliateUrl }]] : [])];
  const base = { chat_id: env.TELEGRAM_CHAT_ID, parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } };
  const text = telegramCouponText(coupon);
  // Com imagem (banner), vai como foto quando o texto cabe na legenda; senão, só o texto.
  if (coupon.image && text.length <= CAPTION_LIMIT) {
    try {
      return await callTelegram('sendPhoto', { ...base, photo: coupon.image, caption: text }, env);
    } catch (error) {
      if (!/photo|image|file|wrong type|url/i.test(error.message)) throw error;
    }
  }
  return callTelegram('sendMessage', { ...base, text, link_preview_options: { is_disabled: true } }, env);
}

/** Confere token e acesso ao canal sem postar nada. */
export async function checkTelegram(env = process.env) {
  const me = await callTelegram('getMe', {}, env);
  const chat = await callTelegram('getChat', { chat_id: env.TELEGRAM_CHAT_ID }, env);
  const member = await callTelegram('getChatMember', { chat_id: env.TELEGRAM_CHAT_ID, user_id: me.id }, env)
    .catch((error) => {
      // Em canais, o Telegram responde assim quando o bot não é administrador.
      if (/member list is inaccessible/i.test(error.message)) return { status: 'não é administrador' };
      throw error;
    });
  return { bot: `@${me.username}`, chat: chat.title || chat.username || String(chat.id), chatType: chat.type, status: member.status, canPost: member.status === 'creator' || member.can_post_messages !== false && member.status === 'administrator' };
}
