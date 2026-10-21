import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, applyStoredConfig, setConfig, publicConfig, normalizeValue } from '../utils/config.js';

const saved = Object.fromEntries(FIELDS.map(({ key }) => [key, process.env[key]]));
function memoryStore(initial = {}) {
  const settings = new Map(Object.entries(initial));
  return {
    settings,
    getSetting: (key) => settings.get(key), setSetting: (key, value) => settings.set(key, value), deleteSetting: (key) => settings.delete(key),
    listSettings: (prefix) => [...settings].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value }))
  };
}
beforeEach(() => { for (const { key } of FIELDS) delete process.env[key]; });
afterEach(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });

test('aplica o que foi salvo no painel e migra as configurações antigas do /auto', () => {
  const store = memoryStore({ 'cfg:SHOPEE_APP_ID': '123', auto_enabled: '1', auto_keywords: 'fone,relógio', ml_affiliate_params: 'matt_word=x', 'cfg:INVALIDA': 'y' });
  applyStoredConfig(store);
  assert.equal(process.env.SHOPEE_APP_ID, '123');
  assert.equal(process.env.AUTO_ENABLED, 'true');
  assert.equal(process.env.AUTO_KEYWORDS, 'fone,relógio');
  assert.equal(process.env.ML_AFFILIATE_PARAMS, 'matt_word=x');
  assert.equal(process.env.INVALIDA, undefined, 'só chaves conhecidas vão para o ambiente');
  assert.equal(store.getSetting('auto_enabled'), undefined, 'chave antiga removida');
});

test('normaliza e valida cada tipo de campo', () => {
  const field = (key) => FIELDS.find((item) => item.key === key);
  assert.equal(normalizeValue(field('AUTO_ENABLED'), true), 'true');
  assert.equal(normalizeValue(field('AUTO_KEYWORDS'), 'fone\n smartwatch ,fone,, air fryer'), 'fone,smartwatch,air fryer');
  assert.equal(normalizeValue(field('AUTO_MIN_COMMISSION'), '3'), '0.03', 'porcentagem vira fração');
  assert.equal(normalizeValue(field('AUTO_MIN_RATING'), '4,7'), '4.7', 'aceita vírgula decimal');
  assert.throws(() => normalizeValue(field('AUTO_INTERVAL_MIN'), '2'), /mínimo 5/);
  assert.throws(() => normalizeValue(field('AUTO_HORARIO'), '25-3'), /formato inválido/);
  assert.throws(() => normalizeValue(field('AUTO_SORT'), 'aleatorio'), /opção inválida/);
  assert.throws(() => normalizeValue(field('SHOPEE_API_URL'), 'http://exemplo.com'), /https/);
  assert.throws(() => normalizeValue(field('TELEGRAM_CHAT_ID'), 'meu canal'), /formato inválido/);
  assert.equal(normalizeValue(field('TELEGRAM_CHAT_ID'), '@meucanal'), '@meucanal');
});

test('salva no banco e no ambiente; segredo em branco é mantido; limpar volta ao .env', () => {
  const store = memoryStore();
  process.env.DISCORD_TOKEN = 'token-antigo';
  let changed = setConfig(store, { DISCORD_TOKEN: '', AUTO_INTERVAL_MIN: '30', POST_DISCORD: false });
  assert.deepEqual(changed, ['AUTO_INTERVAL_MIN', 'POST_DISCORD']);
  assert.equal(process.env.DISCORD_TOKEN, 'token-antigo');
  assert.equal(store.getSetting('cfg:AUTO_INTERVAL_MIN'), '30');
  assert.equal(process.env.POST_DISCORD, 'false');

  changed = setConfig(store, { DISCORD_TOKEN: 'token-novo' });
  assert.deepEqual(changed, ['DISCORD_TOKEN']);
  assert.equal(process.env.DISCORD_TOKEN, 'token-novo');

  changed = setConfig(store, {}, { clear: ['AUTO_INTERVAL_MIN'] });
  assert.deepEqual(changed, ['AUTO_INTERVAL_MIN']);
  assert.equal(store.getSetting('cfg:AUTO_INTERVAL_MIN'), undefined);
  assert.equal(process.env.AUTO_INTERVAL_MIN, undefined);

  assert.throws(() => setConfig(store, { NAO_EXISTE: '1' }), /desconhecida/);
  assert.throws(() => setConfig(store, { AUTO_MIN_RATING: '9' }), /máximo 5/);
});

test('o painel nunca recebe o valor de um segredo', () => {
  const store = memoryStore({ 'cfg:TELEGRAM_BOT_TOKEN': 'x' });
  process.env.TELEGRAM_BOT_TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  process.env.AUTO_MIN_COMMISSION = '0.05';
  const fields = Object.fromEntries(publicConfig(store).map((field) => [field.key, field]));
  assert.equal(fields.TELEGRAM_BOT_TOKEN.value, undefined);
  assert.equal(fields.TELEGRAM_BOT_TOKEN.isSet, true);
  assert.equal(fields.TELEGRAM_BOT_TOKEN.hint, '••••WXYZ');
  assert.equal(fields.TELEGRAM_BOT_TOKEN.source, 'painel');
  assert.equal(fields.AUTO_MIN_COMMISSION.value, '5', 'fração aparece como %');
  assert.equal(fields.AUTO_MIN_COMMISSION.source, '.env');
  assert.equal(fields.DISCORD_TOKEN.isSet, false);
  assert.ok(!JSON.stringify(publicConfig(store)).includes('ABCDEFGHIJKLMNOP'));
});
