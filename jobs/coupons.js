import { toAffiliateLink } from '../services/affiliateLinks.js';
import { publishCoupon } from '../publishers/index.js';
import { autoConfig, withinHours } from './autopost.js';

// A cada minuto, para os cupons agendados (ex.: liberados à meia-noite) saírem na hora.
const CHECK_EVERY_MS = 60_000;
const MAX_CODES = 10;
const CODE = /^[\p{L}\p{N}_\-.]{1,40}$/u;

const text = (value, max, label, { required = false } = {}) => {
  const result = String(value ?? '').trim();
  if (required && !result) throw new Error(`${label}: obrigatório.`);
  if (result.length > max) throw new Error(`${label}: máximo de ${max} caracteres.`);
  return result;
};

const date = (value, label) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label}: data inválida.`);
  return parsed.toISOString();
};

const optionalUrl = (value, label) => {
  const result = text(value, 2000, label);
  if (!result) return null;
  let url;
  try { url = new URL(result); } catch { throw new Error(`${label}: link inválido.`); }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`${label}: use um link http(s).`);
  return result;
};

/**
 * Códigos, um por linha: "R$ 100 OFF em R$ 399: MOVEIS100" (condição: código) ou só "MOVEIS100".
 * O primeiro também fica em `code`, que é o que o resto do bot usa para comparar cupons.
 */
export function parseCodes(input) {
  const lines = Array.isArray(input) ? input : String(input ?? '').split('\n');
  const codes = [];
  for (const raw of lines) {
    const line = typeof raw === 'string' ? raw.trim() : `${raw?.label ? `${raw.label}: ` : ''}${raw?.code ?? ''}`.trim();
    if (!line) continue;
    const split = line.lastIndexOf(':');
    const label = split > 0 ? line.slice(0, split).trim().slice(0, 60) : '';
    const code = (split > 0 ? line.slice(split + 1) : line).replace(/\s+/g, '');
    if (!CODE.test(code)) throw new Error(`Código "${code || line}": use só letras, números, ponto, hífen ou sublinhado (formato: condição: CÓDIGO).`);
    codes.push({ label, code });
  }
  if (codes.length > MAX_CODES) throw new Error(`Códigos: no máximo ${MAX_CODES}.`);
  return codes;
}

/** Valida e normaliza o que vem do painel. */
export function normalizeCoupon(input) {
  const codes = parseCodes(input.codes ?? input.code);
  const expiresAt = date(input.expiresAt, 'Validade');
  const startsAt = date(input.startsAt, 'Postar a partir de');
  if (startsAt && expiresAt && startsAt >= expiresAt) throw new Error('"Postar a partir de" precisa ser antes da validade.');
  const extraUrl = optionalUrl(input.extraUrl, 'Link extra');
  const repeatHours = Number(input.repeatHours ?? 0);
  if (!Number.isInteger(repeatHours) || repeatHours < 0 || repeatHours > 168) throw new Error('Repetir a cada: de 0 a 168 horas.');
  return {
    id: input.id ? Number(input.id) : undefined,
    title: text(input.title, 80, 'Título', { required: true }),
    code: codes[0]?.code ?? '', codes, description: text(input.description, 1000, 'Descrição'),
    url: text(input.url, 2000, 'Link', { required: true }),
    image: optionalUrl(input.image, 'Imagem'),
    extraUrl, extraLabel: extraUrl ? text(input.extraLabel, 40, 'Nome do link extra') || 'Link do carrinho' : null,
    expiresAt, startsAt, repeatHours, active: input.active !== false
  };
}

export function couponStatus(coupon, now = new Date()) {
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) return 'expirado';
  if (!coupon.active) return 'pausado';
  return coupon.startsAt && new Date(coupon.startsAt) > now ? 'agendado' : 'ativo';
}

/** Salva o cupom; o link de afiliado é gerado de novo quando o link da loja muda. */
export async function saveCoupon(store, input) {
  const coupon = normalizeCoupon(input);
  const existing = coupon.id ? store.getCoupon(coupon.id) : null;
  if (coupon.id && !existing) throw new Error('Cupom não encontrado.');
  const { platform, affiliateUrl } = existing && existing.url === coupon.url
    ? existing
    : await toAffiliateLink(coupon.url);
  // O link extra (ex.: carrinho) também vira link de afiliado.
  const extraAffiliateUrl = !coupon.extraUrl ? null
    : existing?.extraUrl === coupon.extraUrl && existing.extraAffiliateUrl ? existing.extraAffiliateUrl
      : (await toAffiliateLink(coupon.extraUrl)).affiliateUrl;
  const id = store.saveCoupon({ ...coupon, platform, affiliateUrl, extraAffiliateUrl });
  return store.getCoupon(id);
}

/** Cupons que devem ser repostados agora: ativos, válidos, com repetição e com o intervalo vencido. */
export function dueCoupons(coupons, now = new Date()) {
  return coupons.filter((coupon) => couponStatus(coupon, now) === 'ativo' && coupon.repeatHours > 0 && !startDue(coupon, now)
    && (!coupon.lastPostedAt || now - new Date(coupon.lastPostedAt) >= coupon.repeatHours * 3_600_000));
}

/** Cupom agendado cujo horário chegou e que ainda não foi postado depois dele (ex.: liberado à meia-noite). */
export const startDue = (coupon, now = new Date()) => Boolean(coupon.startsAt) && couponStatus(coupon, now) === 'ativo'
  && (!coupon.lastPostedAt || new Date(coupon.lastPostedAt) < new Date(coupon.startsAt));

export async function postCoupon(store, coupon, { client, publish = publishCoupon, now = new Date() }) {
  if (couponStatus(coupon, now) === 'expirado') throw new Error('Este cupom já expirou.');
  const result = await publish(coupon, { client, discordChannelId: process.env.CANAL_POSTAGEM_ID });
  store.markCouponPosted(coupon.id, now);
  return result;
}

export function startCouponScheduler({ getClient, store, logger = console, notify = async () => {} }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const coupons = store.listCoupons();
      // Agendados saem na hora marcada, mesmo fora do horário de postagem; repetições só dentro dele.
      const due = [...coupons.filter((coupon) => startDue(coupon, now)), ...(withinHours(now, autoConfig()) ? dueCoupons(coupons, now) : [])];
      for (const coupon of due) {
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
