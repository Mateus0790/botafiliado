import { toAffiliateLink } from '../services/affiliateLinks.js';
import { publishCoupon } from '../publishers/index.js';
import { autoConfig, withinHours } from './autopost.js';

const CHECK_EVERY_MS = 5 * 60_000;
const CODE = /^[\p{L}\p{N}_\-.]{1,40}$/u;

const text = (value, max, label, { required = false } = {}) => {
  const result = String(value ?? '').trim();
  if (required && !result) throw new Error(`${label}: obrigatório.`);
  if (result.length > max) throw new Error(`${label}: máximo de ${max} caracteres.`);
  return result;
};

/** Valida e normaliza o que vem do painel. */
export function normalizeCoupon(input) {
  const code = text(input.code, 40, 'Código').replace(/\s+/g, '');
  if (code && !CODE.test(code)) throw new Error('Código: use só letras, números, ponto, hífen ou sublinhado.');
  let expiresAt = null;
  if (input.expiresAt) {
    const date = new Date(input.expiresAt);
    if (Number.isNaN(date.getTime())) throw new Error('Validade: data inválida.');
    expiresAt = date.toISOString();
  }
  const repeatHours = Number(input.repeatHours ?? 0);
  if (!Number.isInteger(repeatHours) || repeatHours < 0 || repeatHours > 168) throw new Error('Repetir a cada: de 0 a 168 horas.');
  return {
    id: input.id ? Number(input.id) : undefined,
    title: text(input.title, 80, 'Título', { required: true }),
    code, description: text(input.description, 300, 'Descrição'),
    url: text(input.url, 2000, 'Link', { required: true }),
    expiresAt, repeatHours, active: input.active !== false
  };
}

export function couponStatus(coupon, now = new Date()) {
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) return 'expirado';
  return coupon.active ? 'ativo' : 'pausado';
}

/** Salva o cupom; o link de afiliado é gerado de novo quando o link da loja muda. */
export async function saveCoupon(store, input) {
  const coupon = normalizeCoupon(input);
  const existing = coupon.id ? store.getCoupon(coupon.id) : null;
  if (coupon.id && !existing) throw new Error('Cupom não encontrado.');
  const { platform, affiliateUrl } = existing && existing.url === coupon.url
    ? existing
    : await toAffiliateLink(coupon.url);
  const id = store.saveCoupon({ ...coupon, platform, affiliateUrl });
  return store.getCoupon(id);
}

/** Cupons que devem ser repostados agora: ativos, válidos, com repetição e com o intervalo vencido. */
export function dueCoupons(coupons, now = new Date()) {
  return coupons.filter((coupon) => couponStatus(coupon, now) === 'ativo' && coupon.repeatHours > 0
    && (!coupon.lastPostedAt || now - new Date(coupon.lastPostedAt) >= coupon.repeatHours * 3_600_000));
}

export async function postCoupon(store, coupon, { client, publish = publishCoupon, now = new Date() }) {
  if (couponStatus(coupon, now) === 'expirado') throw new Error('Este cupom já expirou.');
  const result = await publish(coupon, { client, discordChannelId: process.env.CANAL_POSTAGEM_ID });
  store.markCouponPosted(coupon.id, now);
  return result;
}

export function startCouponScheduler({ getClient, store, logger = console, notify = async () => {} }) {
  let running = false;
  const tick = async () => {
    if (running || !withinHours(new Date(), autoConfig())) return;
    running = true;
    try {
      for (const coupon of dueCoupons(store.listCoupons())) {
        try {
          const { sent, errors } = await postCoupon(store, coupon, { client: getClient() });
          logger.log(`[cupons] repostou "${coupon.title}" em ${sent.join(' + ')}`);
          for (const error of errors) logger.error(`[cupons] falha parcial: ${error}`);
        } catch (error) {
          logger.error(`[cupons] falha ao postar "${coupon.title}": ${error.message}`);
          notify(`⚠️ Não consegui repostar o cupom "${coupon.title}": ${error.message}`);
        }
      }
    } finally { running = false; }
  };
  const timer = setInterval(tick, CHECK_EVERY_MS);
  return { tick, stop: () => clearInterval(timer) };
}
