import { couponMessage, productMessage } from '../utils/embed.js';
import { sendTelegramCoupon, sendTelegramOffer, telegramConfigured } from './telegram.js';
import { sendWhatsappCoupon, sendWhatsappOffer, whatsappConfigured } from './whatsapp.js';
import { instagramConfigured, sendInstagramOffer } from './instagram.js';
import { ensureMeliLink } from '../services/mercadolivre.js';

export const postHeader = (env = process.env) => env.POST_HEADER?.trim() || '🚨 PROMOÇÃO ENCONTRADA!';
export const couponHeader = (env = process.env) => env.COUPON_HEADER?.trim() || '🎟️ CUPOM DE DESCONTO!';
const discordEnabled = (env = process.env) => env.POST_DISCORD !== 'false';
const telegramEnabled = (env = process.env) => env.POST_TELEGRAM !== 'false' && telegramConfigured(env);
const whatsappEnabled = (env = process.env) => env.POST_WHATSAPP === 'true' && whatsappConfigured(env);
const instagramEnabled = (env = process.env) => env.POST_INSTAGRAM === 'true' && instagramConfigured(env);

/**
 * Destinos ativos: Discord quando há canal e está ligado; Telegram quando há token + chat e está ligado;
 * WhatsApp (kit no privado do dono) e Instagram quando ligados. Cupons não vão para o Instagram (não têm foto).
 */
export function destinations(discordChannelId, { coupon = false } = {}) {
  return [discordChannelId && discordEnabled() && 'Discord', telegramEnabled() && 'Telegram',
    whatsappEnabled() && 'WhatsApp', !coupon && instagramEnabled() && 'Instagram'].filter(Boolean);
}

/**
 * Envia para todos os destinos ativos. Uma falha num destino não impede os outros;
 * só lança erro se nenhum deu certo. Um destino pulado de propósito (ex.: limite diário
 * do Instagram) não conta como erro.
 */
async function publish({ client, discordChannelId, discordMessage, senders }) {
  const sent = [];
  const errors = [];
  const skipped = [];
  if (discordChannelId && discordEnabled()) {
    try {
      if (!client) throw new Error('bot não está conectado');
      const channel = await client.channels.fetch(discordChannelId);
      if (!channel?.isTextBased()) throw new Error('canal não é de texto ou não está acessível');
      await channel.send(discordMessage());
      sent.push('Discord');
    } catch (error) { errors.push(`Discord: ${error.message}`); }
  }
  for (const [name, enabled, send] of senders) {
    if (!enabled) continue;
    try {
      await send();
      sent.push(name);
    } catch (error) {
      if (error.skipped) skipped.push(`${name}: ${error.message}`);
      else errors.push(error.message);
    }
  }
  if (!sent.length) {
    throw new Error(errors.length ? errors.join(' | ') : skipped.length ? skipped.join(' | ') : 'Nenhum destino ativo (Discord, Telegram, WhatsApp ou Instagram).');
  }
  return { sent, errors, skipped };
}

export async function publishOffer(product, { client, discordChannelId, store }) {
  // Ofertas da automática do Mercado Livre (modo meli.la) só ganham o link na hora de postar.
  await ensureMeliLink(product);
  return publish({
    client, discordChannelId,
    discordMessage: () => productMessage(product, { content: `**${postHeader()}**` }),
    senders: [
      ['Telegram', telegramEnabled(), () => sendTelegramOffer(product)],
      ['WhatsApp', whatsappEnabled(), () => sendWhatsappOffer(product)],
      ['Instagram', instagramEnabled(), () => sendInstagramOffer(product, { store })]
    ]
  });
}

export const publishCoupon = (coupon, { client, discordChannelId }) => publish({
  client, discordChannelId,
  discordMessage: () => couponMessage(coupon, { content: `**${couponHeader()}**` }),
  senders: [
    ['Telegram', telegramEnabled(), () => sendTelegramCoupon(coupon)],
    ['WhatsApp', whatsappEnabled(), () => sendWhatsappCoupon(coupon)]
  ]
});
