import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCache } from '../utils/cache.js';
import { createPanel } from '../web/server.js';

const dir = mkdtempSync(join(tmpdir(), 'painel-'));
const store = createCache(join(dir, 'teste.sqlite'));
const logs = [];
const calls = { restart: 0, reschedule: 0 };
const bot = { status: () => ({ state: 'parado', detail: 'Token do Discord não configurado.' }), getClient: () => null, restart: async () => { calls.restart += 1; } };
const autopost = { state: () => ({ enabled: false, keywords: [], intervalMin: 60 }), reschedule: () => { calls.reschedule += 1; }, runNow: async () => ({ posted: [], reason: 'Nenhuma palavra-chave configurada.' }) };
const panel = createPanel({ store, bot, autopost, logger: { log: (line) => logs.push(line), error: (line) => logs.push(line) } });
let base;
let cookie = '';

async function call(path, body, { headers = {} } = {}) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: response.status, data: await response.json().catch(() => null), headers: response.headers };
}

before(async () => { base = `http://127.0.0.1:${await panel.listen(0, '127.0.0.1')}`; });
after(async () => { await panel.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });

test('serve a página com cabeçalhos de segurança', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Painel do Bot Afiliado/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
});

test('primeiro acesso exige o código do log e cria a senha', async () => {
  assert.deepEqual((await call('/api/session')).data, { authenticated: false, setupRequired: true });
  assert.equal((await call('/api/state')).status, 401);
  const code = logs.join('\n').match(/código ([0-9A-F]{8})/)[1];
  assert.equal((await call('/api/setup', { code: 'ERRADO00', password: 'senha-forte' })).status, 403);
  assert.equal((await call('/api/setup', { code, password: 'curta' })).status, 400);
  const ok = await call('/api/setup', { code, password: 'senha-forte' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await call('/api/setup', { code, password: 'outra-senha' })).status, 409);
});

test('login, estado e logout', async () => {
  cookie = '';
  assert.equal((await call('/api/login', { password: 'errada' })).status, 401);
  assert.equal((await call('/api/login', { password: 'senha-forte' })).status, 200);
  const { status, data } = await call('/api/state');
  assert.equal(status, 200);
  assert.ok(data.fields.some((field) => field.key === 'SHOPEE_APP_SECRET' && field.type === 'secret'));
  assert.equal(data.status.discord.state, 'parado');
  await call('/api/logout', {});
  assert.equal((await call('/api/state')).status, 401);
  await call('/api/login', { password: 'senha-forte' });
});

test('salvar configuração aplica efeitos colaterais e valida', async () => {
  const saved = await call('/api/config', { values: { AUTO_INTERVAL_MIN: '30', AUTO_KEYWORDS: 'fone\nrelógio', DISCORD_TOKEN: 'abc' } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.changed.sort(), ['AUTO_INTERVAL_MIN', 'AUTO_KEYWORDS', 'DISCORD_TOKEN']);
  assert.equal(calls.reschedule, 1);
  assert.equal(calls.restart, 1);
  assert.equal(store.getSetting('cfg:AUTO_KEYWORDS'), 'fone,relógio');
  const token = saved.data.state.fields.find((field) => field.key === 'DISCORD_TOKEN');
  assert.deepEqual([token.isSet, token.value], [true, undefined]);

  const invalid = await call('/api/config', { values: { AUTO_HORARIO: '99-1' } });
  assert.equal(invalid.status, 400);
  assert.match(invalid.data.error, /formato inválido/);
});

test('bloqueia POST de outra origem e corpo que não é JSON', async () => {
  assert.equal((await call('/api/config', { values: {} }, { headers: { origin: 'https://site-malicioso.com' } })).status, 403);
  const response = await fetch(`${base}/api/config`, { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(response.status, 415);
});

test('ações devolvem ok/mensagem sem derrubar o painel', async () => {
  const run = await call('/api/actions/run-now', {});
  assert.deepEqual([run.status, run.data.ok, run.data.message], [200, true, 'Nenhuma palavra-chave configurada.']);
  const discord = await call('/api/actions/test-discord', {});
  assert.deepEqual([discord.data.ok, discord.data.message], [false, 'Token do Discord não configurado.']);
  const link = await call('/api/actions/test-link', { url: 'https://example.com/x' });
  assert.equal(link.data.ok, false);
  assert.match(link.data.message, /não suportada/);
  assert.equal((await call('/api/actions/nao-existe', {})).status, 404);
});

test('histórico lista e libera produtos', async () => {
  store.markPosted({ platform: 'shopee', id: '42', affiliateUrl: 'https://s.shopee.com.br/x', title: 'Fone' }, 'canal');
  const { data } = await call('/api/history');
  assert.equal(data.total, 1);
  assert.equal(data.items[0].title, 'Fone');
  assert.equal((await call('/api/history/delete', { platform: 'shopee', id: '42' })).data.ok, true);
  assert.equal(store.wasPosted('shopee', '42'), false);
});

test('sessão continua válida depois de reiniciar o bot, e o banco não guarda o token', async () => {
  const { createAuth } = await import('../web/auth.js');
  const token = cookie.split('=')[1];
  assert.equal(createAuth(store).isValid(token), true);
  assert.ok(!store.getSetting('panel_sessions').includes(token));
});

test('cupons: cadastrar, listar, pausar, postar e excluir', async () => {
  const saved = await call('/api/coupons/save', { title: 'Cupom ML', code: 'ML10', url: 'https://meli.la/Exemplo1', repeatHours: 6, postNow: true });
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.data.coupon.platform, saved.data.coupon.affiliateUrl, saved.data.coupon.status], ['mercadolivre', 'https://meli.la/Exemplo1', 'ativo']);
  assert.match(saved.data.posted.errors[0], /Nenhum destino ativo/, 'sem destinos, salva e explica por que não postou');
  const { id } = saved.data.coupon;
  assert.equal((await call('/api/coupons')).data.items.length, 1);
  assert.equal((await call('/api/coupons/toggle', { id, active: false })).data.ok, true);
  assert.equal((await call('/api/coupons')).data.items[0].status, 'pausado');
  const post = await call('/api/coupons/post', { id });
  assert.equal(post.data.ok, false);
  assert.equal((await call('/api/coupons/save', { title: '', url: 'https://meli.la/x' })).status, 400);
  assert.equal((await call('/api/coupons/delete', { id })).data.ok, true);
  assert.equal((await call('/api/coupons/post', { id })).status, 404);
});

test('troca de senha exige a atual', async () => {
  assert.equal((await call('/api/password', { current: 'errada', next: 'nova-senha-1' })).status, 403);
  assert.equal((await call('/api/password', { current: 'senha-forte', next: 'nova-senha-1' })).status, 200);
  cookie = '';
  assert.equal((await call('/api/login', { password: 'senha-forte' })).status, 401);
  assert.equal((await call('/api/login', { password: 'nova-senha-1' })).status, 200);
});
