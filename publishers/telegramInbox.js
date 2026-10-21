import crypto from 'node:crypto';
import { callTelegram, sendTelegramOffer } from './telegram.js';
import { publishOffer, destinations } from './index.js';
import { detectPlatform, resolveProduct } from '../services/index.js';

// O long polling precisa terminar antes do tempo limite das requisições (REQUEST_TIMEOUT_MS).
const pollTimeout = () => Math.max(1, Math.min(50, Math.floor(Number(process.env.REQUEST_TIMEOUT_MS || 15000) / 1000) - 5));
const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PREVIEW_TTL_MS = 60 * 60 * 1000;
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ownerId = () => process.env.TELEGRAM_OWNER_ID?.trim() || '';

/** Primeiro link de loja suportada dentro de um texto. */
export function findStoreUrl(text) {
  for (const url of String(text ?? '').match(URL_PATTERN) ?? []) {
    try { detectPlatform(url); return url; } catch { /* não é de loja suportada */ }
  }
  return null;
}

/**
 * Atende o privado do bot no Telegram (long polling da Bot API oficial):
 * - /id mostra o seu ID; encaminhar um post de canal mostra o ID do canal;
 * - o dono (TELEGRAM_OWNER_ID) cola um link de produto e recebe a prévia com ✅ Postar / 🗑 Descartar;
 * - notify() manda avisos de erro para o dono.
 */
export function startTelegramInbox({ store, getClient, logger = console, telegram = callTelegram }) {
  const pending = new Map();
  const lastAlerts = new Map();
  let offset = 0;
  let stopped = false;
  let conflictLogged = false;

  const reply = (chatId, text, extra = {}) => telegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

  async function handleMessage(message) {
    if (message.chat?.type !== 'private') return;
    const chatId = message.chat.id;
    const userId = String(message.from?.id ?? '');
    const text = message.text ?? message.caption ?? '';
    const forwardedChat = message.forward_origin?.chat ?? message.forward_from_chat;

    if (/^\/(id|start)\b/.test(text)) {
      const isOwner = userId === ownerId();
      return reply(chatId, [
        '🤖 <b>Bot de ofertas</b>',
        `Seu ID de usuário: <code>${userId}</code>`,
        isOwner ? '✅ Você é o dono: cole um link de produto aqui para preparar um post.'
          : ownerId() ? '' : 'Para usar o conversor, coloque esse número em <b>Telegram → Seu ID (dono)</b> no painel.',
        'Para ver o ID de um canal, encaminhe um post dele para mim.'
      ].filter(Boolean).join('\n'));
    }
    const url = findStoreUrl(text);
    if (forwardedChat && !url) return reply(chatId, `📢 ID de "${escapeHtml(forwardedChat.title ?? forwardedChat.username ?? 'canal')}": <code>${forwardedChat.id}</code>`);
    if (!ownerId()) return reply(chatId, `Defina o seu ID (<code>${userId}</code>) em <b>Telegram → Seu ID (dono)</b> no painel para usar o conversor.`);
    if (userId !== ownerId()) return null;
    if (/^\/status\b/.test(text)) {
      return reply(chatId, `📊 ${store.countPosts()} oferta(s) postada(s)\n📣 Destinos ativos: ${destinations(process.env.CANAL_POSTAGEM_ID).join(' e ') || 'nenhum'}`);
    }
    if (!url) return reply(chatId, 'Cole um link de produto da Shopee, AliExpress ou Mercado Livre que eu preparo o post com o seu link de afiliado.');

    const status = await reply(chatId, '🔎 Convertendo…');
    try {
      const product = await resolveProduct(url, { store });
      const token = crypto.randomBytes(6).toString('hex');
      pending.set(token, { product, expiresAt: Date.now() + PREVIEW_TTL_MS });
      const warning = store.wasPosted(product.platform, product.id) ? [[{ text: '⚠️ Já foi postado antes', callback_data: 'noop' }]] : [];
      await sendTelegramOffer(product, { chatId, extraButtons: [...warning, [{ text: '✅ Postar', callback_data: `post:${token}` }, { text: '🗑 Descartar', callback_data: `drop:${token}` }]] });
      await telegram('deleteMessage', { chat_id: chatId, message_id: status.message_id }).catch(() => {});
    } catch (error) {
      await telegram('editMessageText', { chat_id: chatId, message_id: status.message_id, text: `❌ Não consegui converter: ${error.message}` }).catch(() => {});
    }
    return null;
  }

  async function handleCallback(query) {
    const [action, token] = String(query.data ?? '').split(':');
    if (String(query.from?.id) !== ownerId() || action === 'noop') return telegram('answerCallbackQuery', { callback_query_id: query.id });
    const entry = pending.get(token);
    pending.delete(token);
    const message = query.message;
    // Deixa só o botão de compra na prévia.
    const keepBuy = () => telegram('editMessageReplyMarkup', {
      chat_id: message.chat.id, message_id: message.message_id, reply_markup: { inline_keyboard: message.reply_markup?.inline_keyboard?.slice(0, 1) ?? [] }
    }).catch(() => {});
    if (!entry || entry.expiresAt < Date.now()) {
      await keepBuy();
      return telegram('answerCallbackQuery', { callback_query_id: query.id, text: 'Essa prévia expirou. Mande o link de novo.', show_alert: true });
    }
    if (action === 'drop') {
      await keepBuy();
      return telegram('answerCallbackQuery', { callback_query_id: query.id, text: '🗑 Descartado' });
    }
    try {
      const channelId = process.env.CANAL_POSTAGEM_ID;
      const { sent, errors } = await publishOffer(entry.product, { client: getClient(), discordChannelId: channelId });
      store.markPosted(entry.product, channelId || 'telegram');
      await keepBuy();
      await telegram('answerCallbackQuery', { callback_query_id: query.id, text: `✅ Postado em ${sent.join(' e ')}` });
      if (errors.length) await reply(message.chat.id, `⚠️ ${errors.join('\n⚠️ ')}`);
      logger.log(`[telegram] postou pelo privado: "${entry.product.title}" em ${sent.join(' + ')}`);
    } catch (error) {
      pending.set(token, entry);
      await telegram('answerCallbackQuery', { callback_query_id: query.id, text: `❌ ${error.message}`.slice(0, 190), show_alert: true });
    }
    return null;
  }

  async function handleUpdate(update) {
    if (update.message) return handleMessage(update.message);
    if (update.callback_query) return handleCallback(update.callback_query);
    return null;
  }

  async function loop() {
    while (!stopped) {
      if (!process.env.TELEGRAM_BOT_TOKEN) { await sleep(15_000); continue; }
      try {
        const updates = await telegram('getUpdates', { offset, timeout: pollTimeout(), allowed_updates: ['message', 'callback_query'] });
        conflictLogged = false;
        for (const update of updates ?? []) {
          offset = update.update_id + 1;
          await handleUpdate(update).catch((error) => logger.error(`[telegram] falha ao responder: ${error.message}`));
        }
        for (const [token, entry] of pending) if (entry.expiresAt < Date.now()) pending.delete(token);
      } catch (error) {
        if (/terminated by other getUpdates|Conflict/i.test(error.message)) {
          if (!conflictLogged) logger.error('[telegram] outro programa está lendo as mensagens deste bot (ex.: outra cópia do bot rodando). O privado fica desativado até ela parar.');
          conflictLogged = true;
          await sleep(30_000);
        } else {
          logger.error(`[telegram] ${error.message}`);
          await sleep(10_000);
        }
      }
    }
  }

  return {
    start: () => { loop(); },
    stop: () => { stopped = true; },
    handleUpdate,
    /** Aviso para o dono; a mesma mensagem não se repete por 1 hora. */
    notify: async (text) => {
      const owner = ownerId();
      if (!owner || !process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_ALERTS === 'false') return;
      if ((lastAlerts.get(text) ?? 0) > Date.now() - ALERT_COOLDOWN_MS) return;
      lastAlerts.set(text, Date.now());
      await reply(owner, text).catch((error) => logger.error(`[telegram] não consegui avisar o dono: ${error.message}`));
    }
  };
}
