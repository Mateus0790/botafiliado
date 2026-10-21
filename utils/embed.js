import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { formatPrice } from '../services/price.js';

const PLATFORM_COLORS = { shopee: 0xEE4D2D, aliexpress: 0xE62E04, mercadolivre: 0xFFE600 };
// "na Shopee", mas "no AliExpress" e "no Mercado Livre".
const PREPOSITION = { shopee: 'na', aliexpress: 'no', mercadolivre: 'no' };

export const buyLabel = (product) => `Comprar ${PREPOSITION[product.platform] ?? 'na'} ${product.platformLabel}`;

export const STORE_LABELS = { shopee: 'Shopee', aliexpress: 'AliExpress', mercadolivre: 'Mercado Livre' };
export const couponButtonLabel = (coupon) =>
  `${coupon.code ? 'Pegar cupom' : 'Ver promoção'} ${PREPOSITION[coupon.platform] ?? 'na'} ${STORE_LABELS[coupon.platform] ?? coupon.platform}`;

/** "25/10 às 23:59", no fuso configurado (TZ). */
export function formatDeadline(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map(({ type, value }) => [type, value]));
  return `${parts.day}/${parts.month} às ${parts.hour}:${parts.minute}`;
}

/** Linhas do cupom (descrição, código e validade), em Markdown ou HTML conforme o destino. */
export function couponLines(coupon, { code = (text) => `\`${text}\`` } = {}) {
  const lines = [];
  if (coupon.description) lines.push(coupon.description);
  if (coupon.code) lines.push(`🎟️ Código: ${code(coupon.code)}`);
  if (coupon.expiresAt) lines.push(`⏰ Válido até ${formatDeadline(coupon.expiresAt)}`);
  return lines;
}

/** Mensagem de cupom no Discord: código em destaque e botão para a página do cupom com link de afiliado. */
export function couponMessage(coupon, { content } = {}) {
  const embed = new EmbedBuilder().setColor(PLATFORM_COLORS[coupon.platform] ?? 0x2ECC71)
    .setTitle(coupon.title.slice(0, 256)).setURL(coupon.affiliateUrl)
    .setFooter({ text: STORE_LABELS[coupon.platform] ?? coupon.platform }).setTimestamp();
  const lines = couponLines(coupon);
  if (lines.length) embed.setDescription(lines.join('\n'));
  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(coupon.affiliateUrl).setLabel(couponButtonLabel(coupon)).setEmoji('🎟️');
  return { ...(content ? { content } : {}), embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

/**
 * "De/Por" só com o preço original informado pela loja (Mercado Livre e AliExpress).
 * A Shopee só informa o percentual de desconto, então não inventamos o "de".
 */
export const originalPriceText = (product) =>
  (product.originalPrice && product.priceValue && product.originalPrice > product.priceValue ? formatPrice(product.originalPrice) : null);

export function productEmbed(product) {
  const original = originalPriceText(product);
  const highlights = [`${original ? `~~${original}~~ → ` : ''}💰 **${product.price}**`];
  if (product.discount) highlights.push(`🏷️ **${product.discount}% OFF**`);
  const lines = [highlights.join('  ·  ')];
  if (product.rating) lines.push(`⭐ ${product.rating.toFixed(1)}  ·  ${product.sales.toLocaleString('pt-BR')} vendidos`);
  if (product.freeShipping) lines.push('🚚 Frete grátis');

  const embed = new EmbedBuilder().setColor(PLATFORM_COLORS[product.platform] ?? 0x2ECC71)
    .setTitle(product.title.slice(0, 256)).setURL(product.affiliateUrl)
    .setDescription(lines.join('\n')).setFooter({ text: product.platformLabel }).setTimestamp();
  if (product.image) embed.setImage(product.image);
  return embed;
}

/** Mensagem completa da oferta: embed com imagem grande e botão de compra. */
export function productMessage(product, { content } = {}) {
  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(product.affiliateUrl)
    .setLabel(buyLabel(product)).setEmoji('🛒');
  return { ...(content ? { content } : {}), embeds: [productEmbed(product)], components: [new ActionRowBuilder().addComponents(button)] };
}
