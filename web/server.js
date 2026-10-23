import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAuth } from './auth.js';
import { SECTIONS, publicConfig, setConfig } from '../utils/config.js';
import { recentLogs } from '../utils/logs.js';
import { resolveProduct } from '../services/index.js';
import { searchShopeeOffers } from '../services/shopee.js';
import { checkTelegram, telegramConfigured } from '../publishers/telegram.js';
import { sendWhatsappOffer, whatsappConfigured, whatsappText } from '../publishers/whatsapp.js';
import { connectWhatsapp, disconnectWhatsapp, findChannelByLink, listWhatsappTargets, sendWhatsappWebToSelf, setTargets, whatsappWebMode, whatsappWebStatus } from '../publishers/whatsappWeb.js';
import { checkInstagram, instagramConfigured } from '../publishers/instagram.js';
import { destinations, publishOffer } from '../publishers/index.js';
import { registerCommands } from '../commands/index.js';
import { storesStatus } from '../services/stores.js';
import { couponStatus, postCoupon, saveCoupon } from '../jobs/coupons.js';
import { ML_PAUSE_KEY } from '../jobs/autopost.js';
import { createMeliLink } from '../services/mlLinkbuilder.js';
import { finishLogin, startLogin } from '../services/mlLogin.js';

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8']
};
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
};
const MAX_BODY = 64 * 1024;
const DISCORD_KEYS = ['DISCORD_TOKEN'];
const SCHEDULE_KEYS = ['AUTO_ENABLED', 'AUTO_INTERVAL_MIN'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'cache-control': 'no-store', ...headers });
  res.end(body);
}
const json = (res, status, data, headers) => send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', ...headers });

async function readJson(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'Envie JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Requisição muito grande.');
    chunks.push(chunk);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { throw new HttpError(400, 'JSON inválido.'); }
}

const cookieToken = (req) => /(?:^|;\s*)painel=([a-f0-9]{64})/.exec(req.headers.cookie ?? '')?.[1];
const cookie = (token, maxAge) => `painel=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

/** Bloqueia POST vindo de outro site (além do SameSite=Strict do cookie). */
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Origem não permitida.');
}

function preview(product) {
  const { platform, platformLabel, id, title, price, image, affiliateUrl, discount, rating, sales, commissionRate, freeShipping, originalPrice } = product;
  return { platform, platformLabel, id, title, price, image, affiliateUrl, discount, rating, sales, commissionRate, freeShipping, originalPrice };
}

export function createPanel({ store, bot, autopost, autoCoupons, urgent, logger = console, publicDir = new URL('./public/', import.meta.url) }) {
  const auth = createAuth(store);
  // Sem senha definida, o primeiro acesso exige este código, que só aparece no log do container.
  let setupCode = auth.hasPassword() ? null : crypto.randomBytes(4).toString('hex').toUpperCase();
  if (setupCode) logger.log(`[painel] Primeiro acesso: use o código ${setupCode} para criar a senha do painel.`);

  function state() {
    const channelId = process.env.AUTO_CANAL_ID || process.env.CANAL_POSTAGEM_ID;
    return {
      sections: SECTIONS,
      fields: publicConfig(store),
      passwordFromEnv: auth.passwordFromEnv(),
      status: {
        discord: bot.status(),
        telegram: { configured: telegramConfigured(), enabled: process.env.POST_TELEGRAM !== 'false' },
        instagram: { configured: instagramConfigured(), enabled: process.env.POST_INSTAGRAM === 'true', replies: store.countInstagramReplies() },
        destinations: destinations(channelId),
        autopost: autopost.state(),
        stores: storesStatus(),
        mlPausedUntil: Number(store.getSetting(ML_PAUSE_KEY) || 0) > Date.now() ? new Date(Number(store.getSetting(ML_PAUSE_KEY))).toISOString() : null,
        totalPosts: store.countPosts()
      }
    };
  }

  const actions = {
    async 'run-now'() {
      const result = await autopost.runNow();
      return { message: result.posted.length ? `Postei ${result.posted.length} oferta(s) de "${result.keyword}" (${result.store}) em ${result.sentTo.join(' e ')}.` : result.reason,
        posted: result.posted.map(preview), errors: result.errors ?? [] };
    },
    async 'urgent-now'() {
      if (!urgent) throw new Error('Ofertas urgentes indisponíveis.');
      const result = await urgent.runNow();
      if (!result) throw new Error('Já existe uma busca de ofertas urgentes em andamento.');
      const [product] = result.posted;
      return { message: product ? `Postei "${product.title}" (${product.discount}% OFF) em ${result.sentTo.join(' e ')}.` : result.reason,
        posted: result.posted.map(preview), errors: result.errors ?? [] };
    },
    async 'coupons-now'() {
      if (!autoCoupons) throw new Error('Cupons automáticos indisponíveis.');
      const result = await autoCoupons.runNow();
      if (!result) throw new Error('Já existe uma busca de cupons em andamento.');
      return { message: result.posted.length ? `Postei ${result.posted.map((coupon) => `"${coupon.title}"`).join(', ')} em ${result.sentTo.join(' e ')}. Eles também aparecem na página Cupons.` : result.reason,
        errors: result.errors ?? [] };
    },
    async 'test-discord'() {
      const status = bot.status();
      const client = bot.getClient();
      if (!client) throw new Error(status.detail);
      const channelId = process.env.CANAL_POSTAGEM_ID;
      if (!channelId) return { message: `${status.detail}. Falta o ID do canal de postagem.` };
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) throw new Error('O bot não encontrou o canal de postagem (ID errado ou sem acesso).');
      return { message: `${status.detail}. Canal: #${channel.name}.` };
    },
    async 'register-commands'() { return { message: `Comandos registrados ${await registerCommands()}.` }; },
    async 'test-telegram'() {
      const result = await checkTelegram();
      if (!result.canPost) throw new Error(`${result.bot} não pode postar em "${result.chat}" (papel: ${result.status}). Adicione-o como administrador.`);
      return { message: `${result.bot} pode postar em "${result.chat}".` };
    },
    async 'test-whatsapp'() {
      const sample = { platform: 'shopee', platformLabel: 'Shopee', id: 'exemplo', title: 'Produto de exemplo (teste do painel)', price: 'R$ 49,90',
        priceValue: 49.9, discount: 30, rating: 4.8, sales: 1200, affiliateUrl: 'https://s.shopee.com.br/exemplo' };
      if (whatsappWebMode()) {
        await sendWhatsappWebToSelf(whatsappText(sample));
        return { message: 'Mandei um exemplo para a sua própria conversa no WhatsApp ("Você"). Nada foi postado nos canais.' };
      }
      if (!whatsappConfigured()) throw new Error('Preencha o token do Telegram e o seu ID de dono na página Telegram.');
      await sendWhatsappOffer(sample);
      return { message: 'Mandei um exemplo no seu privado do Telegram. Toque no texto para copiar e cole no Canal do WhatsApp.' };
    },
    async 'test-instagram'() {
      if (!instagramConfigured()) throw new Error('Preencha o token de acesso do Instagram.');
      const result = await checkInstagram();
      const tipo = { BUSINESS: 'comercial', MEDIA_CREATOR: 'criador de conteúdo' }[result.accountType];
      if (!tipo) throw new Error(`@${result.username} não é uma conta Profissional (tipo: ${result.accountType ?? 'desconhecido'}). Mude para conta comercial ou de criador no app do Instagram.`);
      return { message: `Conectado como @${result.username} (conta ${tipo}). ${store.countInstagramReplies()} link(s) já enviados no direct.` };
    },
    async 'test-shopee'() {
      const { products } = await searchShopeeOffers('fone bluetooth', { limit: 1 });
      return { message: 'API da Shopee respondeu.', posted: products.slice(0, 1).map(preview) };
    },
    async 'ml-login-start'(body, req) {
      const result = startLogin({ host: new URL(`http://${req.headers.host}`).hostname });
      return result.remote
        ? { message: `Login aberto por 20 min. Abra o link, digite a senha ${result.password}, entre no Mercado Livre, confira o Gerador de links e feche a janela do navegador (ou clique em "Concluir login").`, link: result.link }
        : { message: 'Abri o navegador do bot neste computador. Entre no Mercado Livre, confira que o Gerador de links aparece logado e feche a janela.' };
    },
    async 'ml-login-stop'() {
      finishLogin();
      return { message: 'Login concluído. Use "Testar sessão meli.la" para conferir.' };
    },
    async 'test-ml-session'() {
      const link = await createMeliLink('https://www.mercadolivre.com.br/p/MLB55762063');
      return { message: `Sessão OK: o Linkbuilder gerou ${link} para um produto de teste (nada foi postado).` };
    },
    async 'test-link'({ url }) {
      const product = await resolveProduct(String(url ?? ''), { store });
      return { message: store.wasPosted(product.platform, product.id) ? 'Produto encontrado (já foi postado antes).' : 'Produto encontrado.', posted: [preview(product)] };
    },
    async 'post-link'({ url, force }) {
      const product = await resolveProduct(String(url ?? ''), { store });
      if (!force && store.wasPosted(product.platform, product.id)) throw new Error('Este produto já foi postado. Marque "postar mesmo assim" para repetir.');
      const channelId = process.env.CANAL_POSTAGEM_ID;
      const { sent, errors } = await publishOffer(product, { client: bot.getClient(), discordChannelId: channelId, store });
      if (store.wasPosted(product.platform, product.id)) store.unmarkPosted(product.platform, product.id);
      store.markPosted(product, channelId || 'telegram');
      return { message: `Publicado em ${sent.join(' e ')}.`, posted: [preview(product)], errors };
    }
  };

  async function handleApi(req, res, path) {
    if (path === '/api/session' && req.method === 'GET') {
      return json(res, 200, { authenticated: auth.isValid(cookieToken(req)), setupRequired: !auth.hasPassword() });
    }
    if (req.method === 'POST') checkOrigin(req);
    if (path === '/api/setup' && req.method === 'POST') {
      const { code, password } = await readJson(req);
      if (auth.hasPassword()) throw new HttpError(409, 'A senha já foi criada.');
      if (!setupCode || String(code ?? '').trim().toUpperCase() !== setupCode) throw new HttpError(403, 'Código de primeiro acesso incorreto. Veja no log do bot.');
      auth.setPassword(password);
      setupCode = null;
      const token = auth.login(password, req.socket.remoteAddress);
      return json(res, 200, { ok: true }, { 'set-cookie': cookie(token, 7 * 24 * 3600) });
    }
    if (path === '/api/login' && req.method === 'POST') {
      const { password } = await readJson(req);
      try {
        const token = auth.login(password, req.socket.remoteAddress);
        return json(res, 200, { ok: true }, { 'set-cookie': cookie(token, 7 * 24 * 3600) });
      } catch (error) { throw new HttpError(401, error.message); }
    }

    const token = cookieToken(req);
    if (!auth.isValid(token)) throw new HttpError(401, 'Faça login.');

    if (path === '/api/logout' && req.method === 'POST') {
      auth.logout(token);
      return json(res, 200, { ok: true }, { 'set-cookie': cookie('', 0) });
    }
    if (path === '/api/state' && req.method === 'GET') return json(res, 200, state());
    if (path === '/api/config' && req.method === 'POST') {
      const { values = {}, clear = [] } = await readJson(req);
      const changed = setConfig(store, values, { clear });
      if (changed.includes('AUTO_KEYWORDS')) store.setSetting('auto_keyword_index', '0');
      if (changed.some((key) => SCHEDULE_KEYS.includes(key))) autopost.reschedule();
      if (changed.some((key) => DISCORD_KEYS.includes(key))) bot.restart().catch((error) => logger.error(`Discord: ${error.message}`));
      // Mexeu no Mercado Livre (login, modo, navegador): volta a tentar na hora.
      if (changed.some((key) => key.startsWith('ML_') || key === 'STORE_MERCADOLIVRE')) store.deleteSetting(ML_PAUSE_KEY);
      if (changed.includes('WHATSAPP_MODE') && !whatsappWebMode()) disconnectWhatsapp().catch(() => {});
      if (changed.length) logger.log(`[painel] configurações alteradas: ${changed.join(', ')}`);
      return json(res, 200, { changed, state: state() });
    }
    if (path === '/api/whatsapp' && req.method === 'GET') return json(res, 200, whatsappWebStatus());
    if (path.startsWith('/api/whatsapp/') && req.method === 'POST') {
      const body = await readJson(req);
      const action = path.slice('/api/whatsapp/'.length);
      try {
        if (action === 'connect') {
          if (!whatsappWebMode()) throw new Error('Escolha "Conectar por QR code" em "Como publicar" e salve antes de conectar.');
          await connectWhatsapp({ store, logger });
          return json(res, 200, { ok: true, ...whatsappWebStatus() });
        }
        if (action === 'disconnect') {
          await disconnectWhatsapp({ logout: body.logout === true });
          logger.log(`[whatsapp] ${body.logout ? 'sessão apagada' : 'desconectado'} pelo painel`);
          return json(res, 200, { ok: true, ...whatsappWebStatus() });
        }
        if (action === 'available') return json(res, 200, { ok: true, items: await listWhatsappTargets() });
        if (action === 'find-channel') return json(res, 200, { ok: true, item: await findChannelByLink(body.link) });
        if (action === 'targets') return json(res, 200, { ok: true, targets: setTargets(body.targets) });
      } catch (error) { return json(res, 200, { ok: false, message: error.message }); }
      throw new HttpError(404, 'Rota não encontrada.');
    }
    if (path === '/api/history' && req.method === 'GET') return json(res, 200, { total: store.countPosts(), items: store.recentPosts(100) });
    if (path === '/api/history/delete' && req.method === 'POST') {
      const { platform, id } = await readJson(req);
      return json(res, 200, { ok: store.unmarkPosted(String(platform), String(id)) });
    }
    if (path === '/api/logs' && req.method === 'GET') return json(res, 200, { items: recentLogs() });
    if (path === '/api/coupons' && req.method === 'GET') {
      return json(res, 200, { items: store.listCoupons().map((coupon) => ({ ...coupon, status: couponStatus(coupon) })) });
    }
    if (path.startsWith('/api/coupons/') && req.method === 'POST') {
      const body = await readJson(req);
      const action = path.slice('/api/coupons/'.length);
      const coupon = body.id ? store.getCoupon(Number(body.id)) : null;
      if (action !== 'save' && !coupon) throw new HttpError(404, 'Cupom não encontrado.');
      if (action === 'save') {
        const saved = await saveCoupon(store, body);
        let posted = null;
        // Cupom agendado sai na hora marcada, não ao salvar.
        if (body.postNow && couponStatus(saved) !== 'agendado') {
          try { posted = await postCoupon(store, saved, { client: bot.getClient() }); }
          catch (error) { posted = { sent: [], errors: [error.message] }; }
        }
        logger.log(`[cupons] ${body.id ? 'editado' : 'cadastrado'}: "${saved.title}"`);
        return json(res, 200, { coupon: { ...store.getCoupon(saved.id), status: couponStatus(saved) }, posted });
      }
      if (action === 'post') {
        try {
          const { sent, errors } = await postCoupon(store, coupon, { client: bot.getClient() });
          logger.log(`[cupons] postou "${coupon.title}" em ${sent.join(' + ')}`);
          return json(res, 200, { ok: true, message: `Cupom publicado em ${sent.join(' e ')}.`, errors });
        } catch (error) { return json(res, 200, { ok: false, message: error.message }); }
      }
      if (action === 'toggle') return json(res, 200, { ok: store.setCouponActive(coupon.id, Boolean(body.active)) });
      if (action === 'delete') return json(res, 200, { ok: store.deleteCoupon(coupon.id) });
      throw new HttpError(404, 'Rota não encontrada.');
    }
    if (path === '/api/password' && req.method === 'POST') {
      const { current, next } = await readJson(req);
      if (!auth.verify(current)) throw new HttpError(403, 'Senha atual incorreta.');
      auth.setPassword(next);
      const fresh = auth.login(next, req.socket.remoteAddress);
      return json(res, 200, { ok: true }, { 'set-cookie': cookie(fresh, 7 * 24 * 3600) });
    }
    const action = path.startsWith('/api/actions/') && req.method === 'POST' && actions[path.slice('/api/actions/'.length)];
    if (action) {
      const body = await readJson(req);
      try { return json(res, 200, { ok: true, ...(await action(body, req)) }); }
      catch (error) { return json(res, 200, { ok: false, message: error.message }); }
    }
    throw new HttpError(404, 'Rota não encontrada.');
  }

  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://painel').pathname;
    try {
      if (path.startsWith('/api/')) return await handleApi(req, res, path);
      const file = STATIC[path];
      if (!file || req.method !== 'GET') return send(res, 404, 'Não encontrado', { 'content-type': 'text/plain; charset=utf-8' });
      return send(res, 200, await readFile(new URL(file[0], publicDir)), { 'content-type': file[1] });
    } catch (error) {
      const status = error.status ?? 400;
      if (!error.status) logger.error(`[painel] ${req.method} ${path}: ${error.message}`);
      return json(res, status, { error: error.message });
    }
  });

  return {
    server,
    listen: (port = 3000, host = '0.0.0.0') => new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); })
  };
}
