import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import QRCode from 'qrcode';

/**
 * WhatsApp conectado por QR code (como o WhatsApp Web), pela biblioteca não oficial Baileys.
 * Permite publicar direto em Canais e grupos. Não é uma API oficial: o WhatsApp pode
 * restringir ou banir o número; por isso fica desligado até o dono escolher este modo.
 */
const TARGETS_KEY = 'wa_targets';
const NEWSLETTERS_KEY = 'wa_newsletters';
const ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);
const RECONNECT_MS = 10_000;

const silentLogger = {
  level: 'silent',
  child() { return silentLogger; },
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const whatsappWebMode = (env = process.env) => env.WHATSAPP_MODE === 'web';
const authDir = () => join(dirname(process.env.DATABASE_PATH || './data/botafiliado.sqlite'), 'whatsapp_auth');
export const hasWhatsappSession = () => existsSync(join(authDir(), 'creds.json'));

/** Código do convite em links como https://whatsapp.com/channel/0029Va... */
export function channelInviteCode(link) {
  return /whatsapp\.com\/channel\/([\w-]{10,})/i.exec(String(link ?? ''))?.[1] ?? null;
}

/** O Baileys devolve o metadado do canal em formatos diferentes conforme a versão. */
export function parseNewsletter(meta) {
  if (!meta?.id) return null;
  const name = meta.thread_metadata?.name?.text ?? meta.name?.text ?? meta.name ?? meta.id;
  const role = String(meta.viewer_metadata?.role ?? meta.role ?? '').toUpperCase();
  return { id: meta.id, name, type: 'canal', admin: ADMIN_ROLES.has(role) };
}

let sock = null;
let status = { state: 'desconectado', detail: 'Não conectado.', qr: null, me: null };
let store = null;
let wanted = false;
let starting = null;
let logger = console;

export function whatsappWebStatus() {
  return { ...status, targets: getTargets() };
}

export function getTargets() {
  try { return JSON.parse(store?.getSetting(TARGETS_KEY) || '[]'); } catch { return []; }
}

export function setTargets(targets) {
  const clean = (Array.isArray(targets) ? targets : [])
    .filter((target) => /@(newsletter|g\.us)$/.test(String(target?.id)))
    .map(({ id, name, type }) => ({ id: String(id), name: String(name ?? id).slice(0, 100), type: type === 'grupo' ? 'grupo' : 'canal' }));
  store.setSetting(TARGETS_KEY, JSON.stringify(clean));
  return clean;
}

function rememberNewsletters(chats = []) {
  const ids = chats.map((chat) => chat?.id).filter((id) => String(id).endsWith('@newsletter'));
  if (!ids.length || !store) return;
  let known = [];
  try { known = JSON.parse(store.getSetting(NEWSLETTERS_KEY) || '[]'); } catch { /* lista corrompida: recomeça */ }
  store.setSetting(NEWSLETTERS_KEY, JSON.stringify([...new Set([...known, ...ids])]));
}

/** Abre a conexão; sem sessão salva, gera o QR code para o painel mostrar. */
export function connectWhatsapp(options = {}) {
  if (options.store) store = options.store;
  if (options.logger) logger = options.logger;
  wanted = true;
  if (sock || starting) return starting ?? Promise.resolve();
  starting = open().finally(() => { starting = null; });
  return starting;
}

async function open() {
  const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = await import('baileys');
  status = { ...status, state: 'conectando', detail: 'Conectando ao WhatsApp…', qr: null };
  const { state: auth, saveCreds } = await useMultiFileAuthState(authDir());
  const version = await fetchLatestBaileysVersion().then((result) => result.version).catch(() => undefined);
  const socket = makeWASocket({
    auth, logger: silentLogger, browser: Browsers.ubuntu('BotAfiliado'), markOnlineOnConnect: false, syncFullHistory: false,
    ...(version ? { version } : {})
  });
  sock = socket;
  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('chats.upsert', rememberNewsletters);
  socket.ev.on('messaging-history.set', ({ chats }) => rememberNewsletters(chats));
  socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      status = { ...status, state: 'aguardando-qr', detail: 'Escaneie o QR code: WhatsApp → Aparelhos conectados → Conectar aparelho.', qr: await QRCode.toDataURL(qr, { margin: 1, width: 280 }) };
    }
    if (connection === 'open') {
      const me = socket.user?.id?.split(':')[0]?.split('@')[0] ?? null;
      status = { state: 'conectado', detail: `Conectado como +${me}${socket.user?.name ? ` (${socket.user.name})` : ''}.`, qr: null, me };
      logger.log(`[whatsapp] conectado como +${me}`);
    }
    if (connection === 'close') {
      if (sock === socket) sock = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        rmSync(authDir(), { recursive: true, force: true });
        status = { state: 'desconectado', detail: 'O aparelho foi desconectado no celular. Conecte de novo pelo QR code.', qr: null, me: null };
        logger.error('[whatsapp] sessão encerrada no celular; conecte de novo pelo painel');
        wanted = false;
        return;
      }
      if (!wanted) {
        status = { state: 'desconectado', detail: 'Não conectado.', qr: null, me: null };
        return;
      }
      // Ninguém escaneou os QR codes a tempo: para de gerar até o dono pedir de novo.
      if (status.state === 'aguardando-qr' && code !== DisconnectReason.restartRequired) {
        wanted = false;
        status = { state: 'desconectado', detail: 'O QR code expirou. Clique em "Conectar por QR code" de novo.', qr: null, me: null };
        return;
      }
      // QR expirado, reinício pedido pelo WhatsApp ou queda de rede: reconecta.
      status = { ...status, state: 'conectando', detail: 'Reconectando…', qr: null };
      setTimeout(() => { if (wanted && !sock) connectWhatsapp().catch((error) => logger.error(`[whatsapp] ${error.message}`)); },
        code === DisconnectReason.restartRequired ? 500 : RECONNECT_MS);
    }
  });
}

/** Desconecta; com `logout`, também apaga a sessão (será preciso escanear o QR de novo). */
export async function disconnectWhatsapp({ logout = false } = {}) {
  wanted = false;
  const socket = sock;
  sock = null;
  if (socket) {
    if (logout) await socket.logout().catch(() => {});
    else socket.end(undefined);
  }
  if (logout) rmSync(authDir(), { recursive: true, force: true });
  status = { state: 'desconectado', detail: 'Não conectado.', qr: null, me: null };
}

function requireSocket() {
  if (!sock || status.state !== 'conectado') throw new Error('WhatsApp desconectado. Conecte pelo QR code na página WhatsApp do painel.');
  return sock;
}

/** Grupos em que você está e canais que o WhatsApp sincronizou em que você é dono ou administrador. */
export async function listWhatsappTargets() {
  const socket = requireSocket();
  const groups = Object.values(await socket.groupFetchAllParticipating().catch(() => ({})))
    .map((group) => ({ id: group.id, name: group.subject || group.id, type: 'grupo' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  let ids = [];
  try { ids = JSON.parse(store.getSetting(NEWSLETTERS_KEY) || '[]'); } catch { /* sem canais conhecidos */ }
  for (const target of getTargets()) if (target.type === 'canal' && !ids.includes(target.id)) ids.push(target.id);
  const channels = [];
  for (const id of ids) {
    const channel = parseNewsletter(await socket.newsletterMetadata('jid', id).catch(() => null));
    if (channel?.admin) channels.push(channel);
  }
  channels.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return [...channels, ...groups];
}

/** Acha um canal pelo link de convite (para quando ele não aparece na lista). */
export async function findChannelByLink(link) {
  const code = channelInviteCode(link);
  if (!code) throw new Error('Cole o link do canal, no formato https://whatsapp.com/channel/…');
  const channel = parseNewsletter(await requireSocket().newsletterMetadata('invite', code));
  if (!channel) throw new Error('Canal não encontrado.');
  if (!channel.admin) throw new Error(`Você não é dono nem administrador de "${channel.name}", então não pode postar nele.`);
  rememberNewsletters([{ id: channel.id }]);
  return channel;
}

/** Envia para cada canal/grupo escolhido, com uma pausa entre eles para não parecer spam. */
async function sendToTargets(text, image) {
  const socket = requireSocket();
  const targets = getTargets();
  if (!targets.length) throw new Error('WhatsApp: escolha pelo menos um canal ou grupo no painel.');
  const failed = [];
  for (const [index, target] of targets.entries()) {
    if (index) await sleep(2000 + Math.random() * 2000);
    try {
      if (image) {
        try {
          await socket.sendMessage(target.id, { image: { url: image }, caption: text });
          continue;
        } catch { /* foto recusada: manda só o texto */ }
      }
      await socket.sendMessage(target.id, { text });
    } catch (error) { failed.push(`${target.name}: ${error.message}`); }
  }
  if (failed.length === targets.length) throw new Error(`WhatsApp: ${failed.join(' | ')}`);
  if (failed.length) logger.error(`[whatsapp] falhou em ${failed.join(' | ')}`);
}

export const sendWhatsappWeb = (text, { image } = {}) => sendToTargets(text, image);

/** Teste do painel: manda para a sua própria conversa ("Você"), sem postar no canal. */
export async function sendWhatsappWebToSelf(text) {
  const socket = requireSocket();
  await socket.sendMessage(`${status.me}@s.whatsapp.net`, { text });
}

/** Na inicialização: reconecta sozinho se o modo QR está ligado e já existe sessão salva. */
export function startWhatsappWeb(options) {
  store = options.store;
  if (options.logger) logger = options.logger;
  if (whatsappWebMode() && hasWhatsappSession()) connectWhatsapp().catch((error) => logger.error(`[whatsapp] ${error.message}`));
  return { stop: () => disconnectWhatsapp() };
}
