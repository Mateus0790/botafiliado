import 'dotenv/config';
import { captureConsole } from './utils/logs.js';
import { createCache } from './utils/cache.js';
import { applyStoredConfig } from './utils/config.js';
import { createDiscordBot } from './bot/discord.js';
import { startAutoPost, autoConfig } from './jobs/autopost.js';
import { startCouponScheduler } from './jobs/coupons.js';
import { startAutoCoupons } from './jobs/autoCoupons.js';
import { startUrgent } from './jobs/urgent.js';
import { startTelegramInbox } from './publishers/telegramInbox.js';
import { startInstagramWatcher } from './jobs/instagramComments.js';
import { startWhatsappWeb } from './publishers/whatsappWeb.js';
import { createPanel } from './web/server.js';

captureConsole();
const cache = createCache();
// O que foi salvo no painel tem prioridade sobre o .env e as variáveis do Docker.
applyStoredConfig(cache);

let autopost = null;
const bot = createDiscordBot({ store: cache, getAutopost: () => autopost });
const inbox = startTelegramInbox({ store: cache, getClient: bot.getClient });
autopost = startAutoPost({ getClient: bot.getClient, store: cache, notify: inbox.notify });
const coupons = startCouponScheduler({ getClient: bot.getClient, store: cache, notify: inbox.notify });
const autoCoupons = startAutoCoupons({ getClient: bot.getClient, store: cache, notify: inbox.notify });
const urgent = startUrgent({ getClient: bot.getClient, store: cache, notify: inbox.notify });
const instagram = startInstagramWatcher({ store: cache, notify: inbox.notify });
const whatsapp = startWhatsappWeb({ store: cache });
const panel = createPanel({ store: cache, bot, autopost, autoCoupons, urgent });

const port = Number(process.env.PAINEL_PORTA || 3000);
await panel.listen(port);
console.log(`[painel] aberto em http://localhost:${port}`);
const config = autoConfig();
console.log(`[auto] ${config.enabled ? 'ligada' : 'desligada'} · a cada ${config.intervalMin} min · palavras: ${config.keywords.join(', ') || 'nenhuma'}`);
inbox.start();
await bot.start();

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  autopost.stop();
  coupons.stop();
  autoCoupons.stop();
  urgent.stop();
  instagram.stop();
  await whatsapp.stop();
  inbox.stop();
  await panel.close();
  await bot.stop();
  cache.close();
  process.exit(0);
}
// O Docker para o container com SIGTERM; no terminal é Ctrl+C (SIGINT).
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
