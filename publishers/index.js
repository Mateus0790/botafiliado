import { couponMessage, productMessage } from '../utils/embed.js';
import { sendTelegramCoupon, sendTelegramOffer, telegramConfigured } from './telegram.js';
import { ensureMeliLink } from '../services/mercadolivre.js';

export const postHeader = (env = process.env) => env.POST_HEADER?.trim() || '🚨 PROMOÇÃO ENCONTRADA!';
export const couponHeader = (env = process.env) => env.COUPON_HEADER?.trim() || '🎟️ CUPOM DE DESCONTO!';
const discordEnabled = (env = process.env) => env.POST_DISCORD !== 'false';
const telegramEnabled = (env = process.env) => env.POST_TELEGRAM !== 'false' && telegramConfigured(env);

/** Destinos ativos: Discord quando há canal e está ligado; Telegram quando há token + chat e está ligado. */
export function destinations(discordChannelId) {
  return [discordChannelId && discordEnabled() && 'Discord', telegramEnabled() && 'Telegram'].filter(Boolean);
}

/**
 * Envia para todos os destinos ativos. Uma falha num destino não impede os outros;
 * só lança erro se nenhum deu certo.
 */
async function publish({ client, discordChannelId, discordMessage, sendTelegram }) {
  const sent = [];
  const errors = [];
  if (discordChannelId && discordEnabled()) {
    try {
      if (!client) throw new Error('bot não está conectado');
      const channel = await client.channels.fetch(discordChannelId);
      if (!channel?.isTextBased()) throw new Error('canal não é de texto ou não está acessível');
      await channel.send(discordMessage());
      sent.push('Discord');
    } catch (error) { errors.push(`Discord: ${error.message}`); }
  }
  if (telegramEnabled()) {
    try {
      await sendTelegram();
      sent.push('Telegram');
    } catch (error) { errors.push(error.message); }
  }
  if (!sent.length) throw new Error(errors.length ? errors.join(' | ') : 'Nenhum destino ativo (Discord ou Telegram).');
  return { sent, errors };
}

export async function publishOffer(product, { client, discordChannelId }) {
  // Ofertas da automática do Mercado Livre (modo meli.la) só ganham o link na hora de postar.
  await ensureMeliLink(product);
  return publish({
    client, discordChannelId,
    discordMessage: () => productMessage(product, { content: `**${postHeader()}**` }),
    sendTelegram: () => sendTelegramOffer(product)
  });
}

export const publishCoupon = (coupon, { client, discordChannelId }) => publish({
  client, discordChannelId,
  discordMessage: () => couponMessage(coupon, { content: `**${couponHeader()}**` }),
  sendTelegram: () => sendTelegramCoupon(coupon)
});
