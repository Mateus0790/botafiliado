import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { LINKBUILDER_URL, clearProfileLock, containerArgs, findBrowser, profileDir, setLoginOpen } from './mlBrowser.js';

/**
 * Login do Mercado Livre no perfil do navegador do bot, iniciado pelo painel. O navegador abre
 * sem automação (como o ml-login.js), para o dono digitar a senha ele mesmo.
 * - No PC: abre a janela do Chrome/Edge na tela.
 * - No Docker: abre o Chromium na tela virtual e liga x11vnc + noVNC na porta ML_LOGIN_PORT (6080),
 *   com senha aleatória, só enquanto o login estiver aberto (fecha sozinho em 20 min).
 */
const LOGIN_TIMEOUT_MS = 20 * 60 * 1000;
const webPort = () => Number(process.env.ML_LOGIN_PORT || 6080);
let session = null;

const remote = () => Boolean(process.env.BOT_IN_DOCKER);
const PASSWORD_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';

function killStaleVnc() {
  for (const name of ['x11vnc', 'websockify']) spawnSync('pkill', ['-f', name], { stdio: 'ignore' });
}

export function loginStatus() {
  return session ? { open: true, remote: session.remote, expiresAt: session.expiresAt } : { open: false };
}

export function finishLogin() {
  if (!session) return;
  const current = session;
  session = null;
  clearTimeout(current.timer);
  for (const child of current.processes) if (child.exitCode === null) child.kill();
  setLoginOpen(false);
}

/** Abre o login. `host` é o endereço do painel usado pelo navegador do dono (para montar o link do noVNC). */
export function startLogin({ host = 'localhost', spawnImpl = spawn, killStale = killStaleVnc } = {}) {
  if (session) return { ...loginStatus(), ...(session.remote ? { link: session.link, password: session.password } : {}) };
  mkdirSync(profileDir(), { recursive: true });
  clearProfileLock();
  setLoginOpen(true);
  const processes = [];
  try {
    const browser = spawnImpl(findBrowser(), [
      `--user-data-dir=${profileDir()}`, '--no-first-run', '--no-default-browser-check', ...containerArgs(),
      ...(remote() ? ['--window-position=0,0', '--window-size=1366,900'] : []), LINKBUILDER_URL
    ], { stdio: 'ignore' });
    processes.push(browser);
    let link = null;
    let password = null;
    if (remote()) {
      // Um x11vnc/websockify que sobrou de um login anterior seguraria as portas com a senha antiga.
      killStale();
      // x11vnc aceita senhas de até 8 caracteres; só minúsculas e números sem os ambíguos (l, 1, o, 0).
      password = Array.from(crypto.randomBytes(8), (byte) => PASSWORD_CHARS[byte % PASSWORD_CHARS.length]).join('');
      processes.push(spawnImpl('x11vnc', ['-display', process.env.DISPLAY || ':99', '-rfbport', '5900', '-localhost', '-forever', '-shared', '-quiet', '-passwd', password], { stdio: 'ignore' }));
      processes.push(spawnImpl('websockify', ['--web', '/usr/share/novnc', String(webPort()), 'localhost:5900'], { stdio: 'ignore' }));
      link = `http://${host}:${webPort()}/vnc.html?autoconnect=1&resize=scale`;
    }
    session = { processes, remote: remote(), link, password, expiresAt: new Date(Date.now() + LOGIN_TIMEOUT_MS).toISOString(), timer: setTimeout(finishLogin, LOGIN_TIMEOUT_MS) };
    // Fechar o navegador encerra o login (e desliga o noVNC).
    browser.on('exit', finishLogin);
    browser.on('error', finishLogin);
    return { ...loginStatus(), ...(remote() ? { link, password } : {}) };
  } catch (error) {
    for (const child of processes) child.kill?.();
    setLoginOpen(false);
    throw error;
  }
}
