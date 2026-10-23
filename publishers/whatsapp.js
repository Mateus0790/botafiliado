import { callTelegram } from './telegram.js';
import { buyLabel, couponButtonLabel, couponLines, originalPriceText } from '../utils/embed.js';
import { sendWhatsappWeb, whatsappWebMode } from './whatsappWeb.js';

/**
 * Canais do WhatsApp não têm API oficial para publicar. Em vez de usar bibliotecas não oficiais
 * (que arriscam banir o número), o modo padrão manda no privado do dono no Telegram a foto e o texto
 * já formatado para o WhatsApp: é só tocar no texto para copiar e colar no canal.
 * No modo QR code (WHATSAPP_MODE=web, não oficial) o bot posta direto nos canais/grupos escolhidos.
 */
export function whatsappConfigured(env = process.env) {
  return whatsappWebMode(env) || Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_OWNER_ID);
}

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MESSAGE_LIMIT = 4096;
const BUTTON_URL_LIMIT = 2000;

/** Texto da oferta com a formatação do WhatsApp (*negrito*, ~riscado~). */
export function whatsappText(product, { header = product.header ?? (process.env.POST_HEADER?.trim() || '🚨 PROMOÇÃO ENCONTRADA!') } = {}) {
  const original = originalPriceText(product);
  const highlights = [`${original ? `~${original}~ → ` : ''}💰 *${product.price}*`];
  if (product.discount) highlights.push(`🏷️ *${product.discount}% OFF*`);
  const details = [highlights.join('  ·  ')];
  if (product.rating) details.push(`⭐ ${product.rating.toFixed(1)}  ·  ${product.sales.toLocaleString('pt-BR')} vendidos`);
  if (product.freeShipping) details.push('🚚 Frete grátis');
  return [`*${header}*`, `*${product.title}*`, details.join('\n'), `🛒 ${buyLabel(product)}:\n${product.affiliateUrl}`].join('\n\n');
}

export function whatsappCouponText(coupon, { header = process.env.COUPON_HEADER?.trim() || '🎟️ CUPOM DE DESCONTO!' } = {}) {
  const lines = couponLines(coupon, { code: (text) => `*${text}*` });
  return [`*${header}*`, `*${coupon.title}*`, lines.join('\n'), `🎟️ ${couponButtonLabel(coupon)}:\n${coupon.affiliateUrl}`].filter(Boolean).join('\n\n');
}

/** Bloco <pre> (copia com um toque) + botão que abre o WhatsApp com o texto, quando o link cabe. */
async function sendKit(text, { image, env }) {
  const chatId = env.TELEGRAM_OWNER_ID;
  if (image) {
    await callTelegram('sendPhoto', { chat_id: chatId, photo: image, caption: '📲 Foto para o Canal do WhatsApp (segure para salvar).' }, env)
      .catch(() => {}); // sem a foto, o texto ainda serve
  }
  const intro = '📲 <b>Pronto para o Canal do WhatsApp</b> — toque no texto para copiar:\n\n';
  const body = text.length + intro.length + 11 > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - intro.length - 12)}…` : text;
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  return callTelegram('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML', text: `${intro}<pre>${escapeHtml(body)}</pre>`, link_preview_options: { is_disabled: true },
    ...(shareUrl.length <= BUTTON_URL_LIMIT ? { reply_markup: { inline_keyboard: [[{ text: '📲 Abrir no WhatsApp', url: shareUrl }]] } } : {})
  }, env).catch((error) => { throw new Error(error.message.replace(/^Telegram:/, 'WhatsApp (privado do Telegram):')); });
}

export const sendWhatsappOffer = (product, { env = process.env } = {}) => (whatsappWebMode(env)
  ? sendWhatsappWeb(whatsappText(product), { image: product.image })
  : sendKit(whatsappText(product), { image: product.image, env }));
export const sendWhatsappCoupon = (coupon, { env = process.env } = {}) => (whatsappWebMode(env)
  ? sendWhatsappWeb(whatsappCouponText(coupon))
  : sendKit(whatsappCouponText(coupon), { env }));
