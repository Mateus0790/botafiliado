import { callInstagram, instagramConfigured, instagramDm, matchesKeyword } from '../publishers/instagram.js';
import { STORE_LABELS } from '../utils/embed.js';
import { setConfig } from '../utils/config.js';

const CHECK_EVERY_MS = 2 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
// O Instagram só aceita resposta privada até 7 dias depois do comentário.
const REPLY_WINDOW_MS = 7 * DAY_MS;
const REFRESH_EVERY_MS = 7 * DAY_MS;
const REFRESH_KEY = 'instagram_token_refreshed_at';

/**
 * Uma verificação do "comente e receba": olha os posts do bot dos últimos 7 dias, busca os
 * comentários só dos que mudaram de contagem e, para cada comentário novo com a palavra-chave,
 * manda o link no direct (resposta privada) e responde o comentário em público.
 * Usa consulta periódica em vez de webhook porque o painel normalmente não tem HTTPS público.
 */
export async function checkInstagramComments({ store, env = process.env, api = callInstagram, logger = console, notify = async () => {}, now = new Date() }) {
  if (!instagramConfigured(env) || env.POST_INSTAGRAM !== 'true' || env.INSTAGRAM_COMMENT_REPLY === 'false') return { replied: 0 };
  const posts = store.recentInstagramPosts(new Date(now - REPLY_WINDOW_MS));
  if (!posts.length) return { replied: 0 };

  const me = await api('me', { params: { fields: 'user_id,username' }, env });
  const media = await api('me/media', { params: { fields: 'id,comments_count', limit: '50' }, env });
  const counts = new Map((media.data ?? []).map((item) => [String(item.id), Number(item.comments_count ?? 0)]));
  const publicReply = env.INSTAGRAM_REPLY?.trim() ?? 'Te mandei o link no direct! 📩';
  let replied = 0;

  for (const post of posts) {
    const count = counts.get(post.mediaId);
    if (count === undefined || count === post.commentsCount) continue;
    const { data: comments = [] } = await api(`${post.mediaId}/comments`, { params: { fields: 'id,text,username,from,timestamp', limit: '50' }, env });
    for (const comment of comments) {
      const author = comment.from?.username ?? comment.username;
      if (store.wasCommentHandled(comment.id)) continue;
      if (comment.from?.id && String(comment.from.id) === String(me.user_id) || author === me.username) {
        store.markCommentHandled(comment.id, post.mediaId, author, 'próprio');
        continue;
      }
      if (now - new Date(comment.timestamp ?? now) > REPLY_WINDOW_MS || !matchesKeyword(comment.text ?? '', env.INSTAGRAM_KEYWORD?.trim() || 'QUERO')) {
        store.markCommentHandled(comment.id, post.mediaId, author, 'ignorado');
        continue;
      }
      try {
        const dm = instagramDm({ ...post, platformLabel: STORE_LABELS[post.platform] ?? post.platform }, { env });
        await api('me/messages', { method: 'POST', body: { recipient: { comment_id: comment.id }, message: { text: dm } }, env });
        store.markCommentHandled(comment.id, post.mediaId, author, 'enviado');
        replied += 1;
        logger.log(`[instagram] mandou o link de "${post.title}" no direct de @${author ?? '?'}`);
      } catch (error) {
        // Resposta privada só pode ser enviada uma vez por comentário; não insiste.
        store.markCommentHandled(comment.id, post.mediaId, author, `erro: ${error.message}`.slice(0, 300));
        logger.error(`[instagram] não consegui mandar o direct para @${author ?? '?'}: ${error.message}`);
        notify(`⚠️ Instagram: não consegui mandar o link no direct (${error.message})`);
        continue;
      }
      if (publicReply) {
        await api(`${comment.id}/replies`, { method: 'POST', body: { message: publicReply }, env })
          .catch((error) => logger.error(`[instagram] não consegui responder o comentário: ${error.message}`));
      }
    }
    // As respostas públicas do bot também mudam a contagem; a próxima leitura só as marca como próprias.
    store.setInstagramCommentsCount(post.mediaId, count);
  }
  return { replied };
}

/**
 * O token de longa duração vale 60 dias; renovado a cada 7 dias ele não vence.
 * O Instagram só renova tokens com mais de 24 h, então uma falha tenta de novo no dia seguinte.
 */
export async function refreshInstagramToken({ store, env = process.env, logger = console, now = new Date(), request = callRefresh }) {
  if (!instagramConfigured(env)) return false;
  const last = Number(store.getSetting(REFRESH_KEY) || 0);
  if (!last) { store.setSetting(REFRESH_KEY, String(now.getTime())); return false; }
  if (now - last < REFRESH_EVERY_MS) return false;
  try {
    const { access_token: token } = await request(env.INSTAGRAM_TOKEN);
    if (!token) throw new Error('resposta sem token');
    setConfig(store, { INSTAGRAM_TOKEN: token });
    store.setSetting(REFRESH_KEY, String(now.getTime()));
    logger.log('[instagram] token renovado por mais 60 dias');
    return true;
  } catch (error) {
    store.setSetting(REFRESH_KEY, String(now.getTime() - REFRESH_EVERY_MS + DAY_MS));
    logger.error(`[instagram] não consegui renovar o token: ${error.message}`);
    return false;
  }
}

async function callRefresh(token) {
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token);
  const response = await fetch(url, { signal: AbortSignal.timeout(Number(process.env.REQUEST_TIMEOUT_MS || 15000)) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`);
  return body;
}

export function startInstagramWatcher({ store, logger = console, notify = async () => {} }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await refreshInstagramToken({ store, logger });
      await checkInstagramComments({ store, logger, notify });
    } catch (error) {
      logger.error(`[instagram] falha ao ler comentários: ${error.message}`);
    } finally { running = false; }
  };
  const timer = setInterval(tick, CHECK_EVERY_MS);
  return { tick, stop: () => clearInterval(timer) };
}
