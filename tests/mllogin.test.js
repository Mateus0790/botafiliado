import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLogin, finishLogin, loginStatus } from '../services/mlLogin.js';
import { createLinksInBrowser, containerArgs } from '../services/mlBrowser.js';

const KEYS = ['BOT_IN_DOCKER', 'ML_BROWSER_PATH', 'ML_BROWSER_PROFILE', 'DISPLAY'];
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const dir = mkdtempSync(join(tmpdir(), 'mllogin-'));
const fakeBrowser = join(dir, 'chromium');
writeFileSync(fakeBrowser, '');
afterEach(() => {
  finishLogin();
  for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
});
test.after(() => rmSync(dir, { recursive: true, force: true }));

function fakeSpawn() {
  const spawned = [];
  const spawnImpl = (command, args) => {
    const child = Object.assign(new EventEmitter(), { command, args, exitCode: null, killed: false, kill() { this.killed = true; this.exitCode = 0; } });
    spawned.push(child);
    return child;
  };
  return { spawned, spawnImpl };
}

test('no PC: abre só o navegador do bot, sem automação, com o perfil próprio', () => {
  Object.assign(process.env, { ML_BROWSER_PATH: fakeBrowser, ML_BROWSER_PROFILE: join(dir, 'perfil') });
  const { spawned, spawnImpl } = fakeSpawn();
  const result = startLogin({ spawnImpl });
  assert.deepEqual([result.open, result.remote, result.link], [true, false, undefined]);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, fakeBrowser);
  assert.ok(spawned[0].args.includes(`--user-data-dir=${join(dir, 'perfil')}`));
  assert.ok(spawned[0].args.at(-1).endsWith('/afiliados/linkbuilder'));
  spawned[0].emit('exit');
  assert.equal(loginStatus().open, false, 'fechar o navegador conclui o login');
});

test('no Docker: navegador na tela virtual + x11vnc com senha + noVNC; concluir desliga tudo', async () => {
  Object.assign(process.env, { BOT_IN_DOCKER: '1', ML_BROWSER_PATH: fakeBrowser, ML_BROWSER_PROFILE: join(dir, 'perfil2'), DISPLAY: ':99' });
  const { spawned, spawnImpl } = fakeSpawn();
  mkdirSync(join(dir, 'perfil2'), { recursive: true });
  writeFileSync(join(dir, 'perfil2', 'SingletonLock'), 'container-antigo-111');
  let killed = 0;
  const result = startLogin({ host: '192.168.0.10', spawnImpl, killStale: () => { killed += 1; } });
  assert.equal(killed, 1, 'encerra x11vnc/websockify que sobraram antes de abrir');
  assert.equal(existsSync(join(dir, 'perfil2', 'SingletonLock')), false, 'remove a trava de um container antigo');
  assert.equal(result.remote, true);
  assert.equal(result.link, 'http://192.168.0.10:6080/vnc.html?autoconnect=1&resize=scale');
  assert.match(result.password, /^[a-km-np-z2-9]{8}$/);
  assert.deepEqual(spawned.map((child) => child.command), [fakeBrowser, 'x11vnc', 'websockify']);
  assert.ok(spawned[0].args.includes('--no-sandbox'));
  assert.ok(spawned[1].args.includes('-localhost') && spawned[1].args.includes(result.password));
  assert.deepEqual(containerArgs(), ['--no-sandbox', '--disable-dev-shm-usage']);
  assert.equal(startLogin({ spawnImpl }).password, result.password, 'reabrir mostra o mesmo login');
  await assert.rejects(createLinksInBrowser(['x'], 'bot'), /login do Mercado Livre está aberto/);
  finishLogin();
  assert.ok(spawned.every((child) => child.killed));
  assert.equal(loginStatus().open, false);
});
