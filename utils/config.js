/**
 * Configuração editável pelo painel. Cada campo é uma variável de ambiente; o valor salvo no
 * painel fica no SQLite (`cfg:<CHAVE>`) e é espelhado em process.env, então todo o código
 * continua lendo process.env. Prioridade: painel > .env/variáveis do Docker > padrão.
 */
import { NICHO_OPTIONS } from '../services/nichos.js';

export const SECTIONS = [
  { id: 'auto', title: 'Postagem automática', description: 'Busca ofertas por palavra-chave nas lojas ativas, revezando entre elas, e publica sozinha nos destinos ativos. No Mercado Livre usa os mais vendidos da categoria; nota, vendas e comissão mínimas valem só para Shopee e AliExpress.' },
  { id: 'mensagem', title: 'Mensagem', description: 'Como as ofertas aparecem no Discord e no Telegram.' },
  { id: 'discord', title: 'Discord', description: 'Bot do Discord Developer Portal. Mudar o token reconecta o bot.' },
  { id: 'telegram', title: 'Telegram', description: 'Bot do @BotFather, administrador do canal com permissão de publicar. Com o seu ID de dono, você cola links no privado do bot e recebe a prévia com ✅ Postar / 🗑 Descartar.' },
  { id: 'whatsapp', title: 'WhatsApp', description: 'Dois modos. "Kit no privado do Telegram" (sem risco): o bot manda a foto e o texto pronto no seu privado do Telegram e você cola no canal. "Conectar por QR code" (não oficial): o bot entra no seu WhatsApp como um aparelho conectado e posta sozinho nos canais e grupos que você escolher; o WhatsApp não autoriza bots assim e pode restringir ou banir o número, então prefira um número só para isso.' },
  { id: 'instagram', title: 'Instagram', description: 'API oficial do Instagram (login do Instagram) com conta Profissional. O bot publica a foto da oferta com "Comente QUERO" na legenda e, a cada 2 minutos, manda o link no direct de quem comentou a palavra-chave e responde o comentário. O token de 60 dias é renovado sozinho.' },
  { id: 'shopee', title: 'Shopee', description: 'Shopee Affiliate Open API. Entra na postagem automática e na manual.' },
  { id: 'aliexpress', title: 'AliExpress', description: 'AliExpress Affiliate Open Platform. Entra na postagem automática e na manual.' },
  { id: 'mercadolivre', title: 'Mercado Livre', description: 'App do developers.mercadolivre.com.br para buscar produtos e preços. Para o link de afiliado, escolha o modo: parâmetros matt_word/matt_tool (oficial) ou meli.la pelo Linkbuilder (não oficial: o bot usa um navegador com perfil próprio; faça o login uma vez pelo botão "Fazer login do Mercado Livre" — no PC abre o navegador na tela, no Docker abre a tela do navegador do container no seu navegador, com senha). Se a sessão expirar, o bot para de postar Mercado Livre e avisa no seu privado do Telegram.' },
  { id: 'geral', title: 'Geral', description: 'Fuso horário e rede.' }
];

const SORT_OPTIONS = [
  ['mais-vendidos', 'Mais vendidos'], ['maior-comissao', 'Maior comissão'], ['relevancia', 'Relevância'],
  ['menor-preco', 'Menor preço'], ['maior-preco', 'Maior preço']
];

export const FIELDS = [
  { key: 'AUTO_ENABLED', section: 'auto', label: 'Postagem automática ligada', type: 'bool', default: 'false' },
  { key: 'AUTO_NICHOS', section: 'auto', label: 'Nichos prontos (somam palavras-chave e, no Mercado Livre, usam a categoria certa)', type: 'multi', options: NICHO_OPTIONS, default: '' },
  { key: 'AUTO_KEYWORDS', section: 'auto', label: 'Palavras-chave extras (uma por linha, em rodízio)', type: 'list', default: '' },
  { key: 'AUTO_INTERVAL_MIN', section: 'auto', label: 'Intervalo entre rodadas (minutos)', type: 'number', min: 5, max: 1440, default: '60' },
  { key: 'AUTO_POSTS_PER_RUN', section: 'auto', label: 'Ofertas por rodada', type: 'number', min: 1, max: 10, default: '1' },
  { key: 'AUTO_HORARIO', section: 'auto', label: 'Horário de postagem (início-fim, ex.: 8-23)', type: 'text', pattern: /^([01]?\d|2[0-3])-([01]?\d|2[0-3])$/, default: '8-23' },
  { key: 'AUTO_SORT', section: 'auto', label: 'Ordem da busca', type: 'select', options: SORT_OPTIONS, default: 'mais-vendidos' },
  { key: 'AUTO_MIN_RATING', section: 'auto', label: 'Nota mínima (0 a 5)', type: 'number', min: 0, max: 5, step: 0.1, default: '4.5' },
  { key: 'AUTO_MIN_SALES', section: 'auto', label: 'Vendas mínimas', type: 'number', min: 0, default: '100' },
  { key: 'AUTO_MIN_COMMISSION', section: 'auto', label: 'Comissão mínima (%)', type: 'percent', min: 0, max: 100, default: '0.03' },
  { key: 'AUTO_MIN_DISCOUNT', section: 'auto', label: 'Desconto mínimo (%)', type: 'number', min: 0, max: 99, default: '0' },
  { key: 'AUTO_MIN_PRICE', section: 'auto', label: 'Preço mínimo (R$, vazio = sem limite)', type: 'number', min: 0, step: 0.01, default: '' },
  { key: 'AUTO_MAX_PRICE', section: 'auto', label: 'Preço máximo (R$, vazio = sem limite)', type: 'number', min: 0, step: 0.01, default: '' },
  { key: 'AUTO_BLOCKED_WORDS', section: 'auto', label: 'Palavras bloqueadas no título (uma por linha, ex.: capinha)', type: 'list', default: '' },
  { key: 'AUTO_REPEAT_DAYS', section: 'auto', label: 'Repostar o mesmo produto depois de (dias, 0 = nunca)', type: 'number', min: 0, max: 365, default: '0' },
  { key: 'AUTO_COUPONS_ENABLED', section: 'auto', label: 'Cupons automáticos: buscar e postar cupons e promoções reais da Shopee e do AliExpress', type: 'bool', default: 'false' },
  { key: 'AUTO_COUPONS_INTERVAL_H', section: 'auto', label: 'Cupons automáticos: buscar a cada (horas)', type: 'number', min: 1, max: 48, default: '6' },
  { key: 'AUTO_COUPONS_PER_RUN', section: 'auto', label: 'Cupons automáticos: quantos postar por busca', type: 'number', min: 1, max: 5, default: '1' },
  { key: 'AUTO_CANAL_ID', section: 'auto', label: 'Canal do Discord só para as automáticas (vazio = canal padrão)', type: 'text', pattern: /^\d{15,25}$/, default: '' },

  { key: 'POST_HEADER', section: 'mensagem', label: 'Texto acima da oferta', type: 'text', maxLength: 120, default: '🚨 PROMOÇÃO ENCONTRADA!' },
  { key: 'COUPON_HEADER', section: 'mensagem', label: 'Texto acima dos cupons', type: 'text', maxLength: 120, default: '🎟️ CUPOM DE DESCONTO!' },
  { key: 'POST_DISCORD', section: 'mensagem', label: 'Publicar no Discord', type: 'bool', default: 'true' },
  { key: 'POST_TELEGRAM', section: 'mensagem', label: 'Publicar no Telegram', type: 'bool', default: 'true' },

  { key: 'POST_WHATSAPP', section: 'whatsapp', label: 'Publicar ofertas e cupons no WhatsApp', type: 'bool', default: 'false' },
  { key: 'WHATSAPP_MODE', section: 'whatsapp', label: 'Como publicar', type: 'select',
    options: [['kit', 'Kit no privado do Telegram (você cola no canal; sem risco)'], ['web', 'Conectar por QR code e postar direto (não oficial; risco de banimento)']], default: 'kit' },

  { key: 'POST_INSTAGRAM', section: 'instagram', label: 'Publicar ofertas no Instagram', type: 'bool', default: 'false' },
  { key: 'INSTAGRAM_TOKEN', section: 'instagram', label: 'Token de acesso (longa duração, gerado no app da Meta)', type: 'secret', pattern: /^[\w.|-]{20,}$/, default: '' },
  { key: 'INSTAGRAM_MAX_PER_DAY', section: 'instagram', label: 'Máximo de posts no Instagram por dia (o resto vai só para os outros destinos)', type: 'number', min: 1, max: 50, default: '10' },
  { key: 'INSTAGRAM_KEYWORD', section: 'instagram', label: 'Palavra que a pessoa comenta para receber o link', type: 'text', maxLength: 30, default: 'QUERO' },
  { key: 'INSTAGRAM_COMMENT_REPLY', section: 'instagram', label: 'Mandar o link no direct de quem comentar a palavra', type: 'bool', default: 'true' },
  { key: 'INSTAGRAM_DM', section: 'instagram', label: 'Início da mensagem no direct (o bot completa com o produto, preço e link)', type: 'text', maxLength: 200, default: 'Oi! Aqui está o link da oferta 👇' },
  { key: 'INSTAGRAM_REPLY', section: 'instagram', label: 'Resposta pública no comentário (vazio = não responde)', type: 'text', maxLength: 150, default: 'Te mandei o link no direct! 📩' },
  { key: 'INSTAGRAM_HASHTAGS', section: 'instagram', label: 'Hashtags (uma por linha, sem #)', type: 'list', default: 'achadinhos,promoção,ofertas' },

  { key: 'DISCORD_TOKEN', section: 'discord', label: 'Token do bot', type: 'secret', default: '' },
  { key: 'DISCORD_CLIENT_ID', section: 'discord', label: 'Application ID', type: 'text', pattern: /^\d{15,25}$/, default: '' },
  { key: 'DISCORD_GUILD_ID', section: 'discord', label: 'ID do servidor (registra os comandos na hora)', type: 'text', pattern: /^\d{15,25}$/, default: '' },
  { key: 'CANAL_POSTAGEM_ID', section: 'discord', label: 'ID do canal de postagem', type: 'text', pattern: /^\d{15,25}$/, default: '' },

  { key: 'TELEGRAM_BOT_TOKEN', section: 'telegram', label: 'Token do bot', type: 'secret', pattern: /^\d+:[\w-]{20,}$/, default: '' },
  { key: 'TELEGRAM_CHAT_ID', section: 'telegram', label: 'Canal (@nome ou -100…)', type: 'text', pattern: /^(@\w{4,}|-?\d+)$/, default: '' },
  { key: 'TELEGRAM_OWNER_ID', section: 'telegram', label: 'Seu ID de usuário (dono): mande /id para o bot no privado para descobrir', type: 'text', pattern: /^\d{4,15}$/, default: '' },
  { key: 'TELEGRAM_ALERTS', section: 'telegram', label: 'Avisar no seu privado quando algo falhar', type: 'bool', default: 'true' },

  { key: 'STORE_SHOPEE', section: 'shopee', label: 'Divulgar produtos da Shopee', type: 'bool', default: 'true' },
  { key: 'SHOPEE_APP_ID', section: 'shopee', label: 'App ID', type: 'text', default: '' },
  { key: 'SHOPEE_APP_SECRET', section: 'shopee', label: 'App Secret', type: 'secret', default: '' },
  { key: 'SHOPEE_API_URL', section: 'shopee', label: 'URL da API', type: 'url', default: 'https://open-api.affiliate.shopee.com.br/graphql' },

  { key: 'STORE_ALIEXPRESS', section: 'aliexpress', label: 'Divulgar produtos do AliExpress', type: 'bool', default: 'true' },
  { key: 'ALIEXPRESS_APP_KEY', section: 'aliexpress', label: 'App Key', type: 'text', default: '' },
  { key: 'ALIEXPRESS_APP_SECRET', section: 'aliexpress', label: 'App Secret', type: 'secret', default: '' },
  { key: 'ALIEXPRESS_TRACKING_ID', section: 'aliexpress', label: 'Tracking ID', type: 'text', default: '' },
  { key: 'ALIEXPRESS_API_URL', section: 'aliexpress', label: 'URL da API', type: 'url', default: 'https://api-sg.aliexpress.com/sync' },
  { key: 'ALIEXPRESS_CURRENCY', section: 'aliexpress', label: 'Moeda', type: 'text', pattern: /^[A-Z]{3}$/, default: 'BRL' },
  { key: 'ALIEXPRESS_LANGUAGE', section: 'aliexpress', label: 'Idioma', type: 'text', pattern: /^[A-Z]{2}$/, default: 'PT' },
  { key: 'ALIEXPRESS_COUNTRY', section: 'aliexpress', label: 'País de entrega', type: 'text', pattern: /^[A-Z]{2}$/, default: 'BR' },

  { key: 'STORE_MERCADOLIVRE', section: 'mercadolivre', label: 'Divulgar produtos do Mercado Livre', type: 'bool', default: 'true' },
  { key: 'ML_CLIENT_ID', section: 'mercadolivre', label: 'Client ID', type: 'text', default: '' },
  { key: 'ML_CLIENT_SECRET', section: 'mercadolivre', label: 'Client Secret', type: 'secret', default: '' },
  { key: 'ML_LINK_MODE', section: 'mercadolivre', label: 'Como gerar o link de afiliado', type: 'select',
    options: [['parametros', 'Parâmetros matt_word/matt_tool (oficial, comissão não confirmada)'], ['linkbuilder', 'meli.la pelo Linkbuilder no navegador do bot (não oficial)']], default: 'parametros' },
  { key: 'ML_AFFILIATE_PARAMS', section: 'mercadolivre', label: 'Parâmetros de afiliado (ex.: matt_word=…&matt_tool=…)', type: 'text', default: '' },
  { key: 'ML_ETIQUETA', section: 'mercadolivre', label: 'Etiqueta em uso no Linkbuilder (modo meli.la)', type: 'text', pattern: /^[\w.-]{1,60}$/, default: '' },
  { key: 'ML_BROWSER_HEADLESS', section: 'mercadolivre', label: 'Navegador do modo meli.la sem janela (o Mercado Livre recusou em teste; deixe desligado)', type: 'bool', default: 'false' },
  { key: 'ML_BROWSER_OFFSCREEN', section: 'mercadolivre', label: 'Abrir a janela do navegador fora da tela (não aparece no monitor)', type: 'bool', default: 'true' },

  { key: 'TZ', section: 'geral', label: 'Fuso horário', type: 'text', pattern: /^[A-Za-z_]+(\/[A-Za-z_]+)*$/, default: 'America/Sao_Paulo' },
  { key: 'REQUEST_TIMEOUT_MS', section: 'geral', label: 'Tempo limite das APIs (ms)', type: 'number', min: 1000, max: 120000, default: '15000' }
];

const BY_KEY = new Map(FIELDS.map((field) => [field.key, field]));
const PREFIX = 'cfg:';
// Valores vindos do .env/Docker, para voltar a eles quando o painel limpa um campo.
const baseEnv = Object.fromEntries(FIELDS.map(({ key }) => [key, process.env[key]]));

function setEnv(key, value) {
  if (value === undefined || value === null) delete process.env[key];
  else process.env[key] = value;
}

/** Converte as configurações antigas do /auto e do /definir-afiliado-ml para o formato do painel. */
function migrateLegacy(store) {
  const legacy = {
    auto_enabled: ['AUTO_ENABLED', (value) => (value === '1' ? 'true' : 'false')],
    auto_keywords: ['AUTO_KEYWORDS', (value) => value],
    auto_interval_min: ['AUTO_INTERVAL_MIN', (value) => value],
    ml_affiliate_params: ['ML_AFFILIATE_PARAMS', (value) => value]
  };
  for (const [oldKey, [key, convert]] of Object.entries(legacy)) {
    const value = store.getSetting(oldKey);
    if (value === undefined) continue;
    if (store.getSetting(PREFIX + key) === undefined) store.setSetting(PREFIX + key, convert(value));
    store.deleteSetting(oldKey);
  }
}

/** Na inicialização: aplica em process.env tudo o que foi salvo pelo painel. */
export function applyStoredConfig(store) {
  migrateLegacy(store);
  for (const { key, value } of store.listSettings(PREFIX)) {
    const name = key.slice(PREFIX.length);
    if (BY_KEY.has(name)) setEnv(name, value);
  }
}

export function normalizeValue(field, raw) {
  let value = typeof raw === 'string' ? raw.trim() : raw;
  if (field.type === 'bool') return value === true || value === 'true' ? 'true' : 'false';
  if (value === '' || value === undefined || value === null) return '';
  if (field.type === 'multi') {
    const chosen = Array.isArray(value) ? value : String(value).split(',');
    const valid = new Set(field.options.map(([option]) => option));
    const invalid = chosen.map((item) => String(item).trim()).filter((item) => item && !valid.has(item));
    if (invalid.length) throw new Error(`${field.label}: opção inválida (${invalid.join(', ')}).`);
    return [...new Set(chosen.map((item) => String(item).trim()).filter(Boolean))].join(',');
  }
  if (field.type === 'list') {
    const items = (Array.isArray(value) ? value : String(value).split(/[\n,]/)).map((item) => String(item).trim()).filter(Boolean);
    return [...new Set(items)].join(',');
  }
  value = String(value);
  if (field.type === 'number' || field.type === 'percent') {
    const number = Number(value.replace(',', '.'));
    if (!Number.isFinite(number)) throw new Error(`${field.label}: informe um número.`);
    if (field.min !== undefined && number < field.min) throw new Error(`${field.label}: mínimo ${field.min}.`);
    if (field.max !== undefined && number > field.max) throw new Error(`${field.label}: máximo ${field.max}.`);
    // Porcentagem chega do painel como 3 (%) e é guardada como fração (0.03).
    return String(field.type === 'percent' ? number / 100 : number);
  }
  if (field.type === 'select' && !field.options.some(([option]) => option === value)) throw new Error(`${field.label}: opção inválida.`);
  if (field.type === 'url') {
    let url;
    try { url = new URL(value); } catch { throw new Error(`${field.label}: URL inválida.`); }
    if (url.protocol !== 'https:') throw new Error(`${field.label}: use https.`);
  }
  if (field.pattern && !field.pattern.test(value)) throw new Error(`${field.label}: formato inválido.`);
  if (field.maxLength && value.length > field.maxLength) throw new Error(`${field.label}: máximo de ${field.maxLength} caracteres.`);
  return value;
}

/**
 * Salva valores vindos do painel ou dos comandos. Segredos em branco são mantidos;
 * chaves em `clear` voltam ao valor do .env/padrão. Retorna as chaves que mudaram.
 */
export function setConfig(store, values = {}, { clear = [] } = {}) {
  const updates = [];
  for (const [key, raw] of Object.entries(values)) {
    const field = BY_KEY.get(key);
    if (!field) throw new Error(`Configuração desconhecida: ${key}`);
    if (field.type === 'secret' && (raw === '' || raw === undefined || raw === null)) continue;
    updates.push([key, normalizeValue(field, raw)]);
  }
  for (const key of clear) if (!BY_KEY.has(key)) throw new Error(`Configuração desconhecida: ${key}`);
  if (process.env.BOT_NO_BROWSER && updates.some(([key, value]) => key === 'ML_LINK_MODE' && value === 'linkbuilder')) {
    throw new Error('O modo meli.la precisa de um navegador e não funciona no Docker. Use o modo parâmetros.');
  }

  const changed = [];
  for (const [key, value] of updates) {
    if ((process.env[key] ?? '') !== value) changed.push(key);
    store.setSetting(PREFIX + key, value);
    setEnv(key, value);
  }
  for (const key of clear) {
    store.deleteSetting(PREFIX + key);
    if ((process.env[key] ?? '') !== (baseEnv[key] ?? '')) changed.push(key);
    setEnv(key, baseEnv[key]);
  }
  return changed;
}

/** Valores para o painel; segredos nunca saem, só se estão definidos e os 4 últimos caracteres. */
export function publicConfig(store, env = process.env) {
  return FIELDS.map((field) => {
    const value = env[field.key];
    const stored = store.getSetting(PREFIX + field.key) !== undefined;
    const source = stored ? 'painel' : value !== undefined && value !== '' ? '.env' : 'padrão';
    const base = {
      key: field.key, section: field.section, label: field.label, type: field.type, source,
      default: field.type === 'percent' && field.default ? String(Number(field.default) * 100) : field.default,
      ...(field.options ? { options: field.options } : {}),
      ...(field.min !== undefined ? { min: field.min } : {}), ...(field.max !== undefined ? { max: field.max } : {}), ...(field.step ? { step: field.step } : {})
    };
    if (field.type === 'secret') return { ...base, isSet: Boolean(value), hint: value ? `••••${value.slice(-4)}` : '' };
    if (field.type === 'percent') return { ...base, value: value === undefined || value === '' ? '' : String(Number((Number(value) * 100).toFixed(4))) };
    return { ...base, value: value ?? '' };
  });
}
