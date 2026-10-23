import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

/**
 * Navegador para o Linkbuilder do Mercado Livre (modo meli.la). Usa o Chrome ou o Edge instalado
 * com um perfil próprio do bot (data/ml_profile), onde o dono faz login uma vez pelo ml-login.js.
 * Por padrão o Playwright abre o navegador (com a marca de automação). Com ML_BROWSER_PLAIN=true,
 * o navegador abre como no login, sem flags de automação, e o Playwright só se conecta a ele pela
 * porta de depuração; o User-Agent e o resto não são alterados. É opcional: o Mercado Livre não
 * autoriza automação no Linkbuilder e pode bloquear de qualquer jeito.
 */
export const LINKBUILDER_URL = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';
const CREATE_LINK_URL = 'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink';

export const profileDir = () => resolve(process.env.ML_BROWSER_PROFILE || join(process.env.DATABASE_PATH ? join(process.env.DATABASE_PATH, '..') : './data', 'ml_profile'));
export const hasProfile = () => existsSync(profileDir()) && readdirSync(profileDir()).length > 0;

/** Chrome ou Edge instalado (Windows, macOS e Linux); ML_BROWSER_PATH tem prioridade (Chromium do Docker). */
export function findBrowser() {
  if (process.env.ML_BROWSER_PATH && existsSync(process.env.ML_BROWSER_PATH)) return process.env.ML_BROWSER_PATH;
  const candidates = process.platform === 'win32'
    ? [
      [process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'], [process.env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'],
      [process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'],
      [process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'], [process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe']
    ].filter(([base]) => base).map(([base, path]) => join(base, path))
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('Nenhum Google Chrome ou Microsoft Edge encontrado neste computador.');
  return found;
}

/**
 * Opções do Chromium dentro do container: sem o sandbox do Chrome (o Docker já isola o processo
 * e o sandbox exige permissões que o container não tem) e sem depender do /dev/shm pequeno.
 */
export const containerArgs = () => (process.env.BOT_IN_DOCKER ? ['--no-sandbox', '--disable-dev-shm-usage'] : []);

/**
 * O Chromium trava o perfil com o nome da máquina; cada container novo tem outro nome e o perfil
 * parece "em uso em outro computador". No Docker só o bot abre o perfil (um por vez, pela fila),
 * então a trava que sobrou é sempre de um container antigo e pode ser removida.
 */
export function clearProfileLock() {
  if (!process.env.BOT_IN_DOCKER) return;
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) rmSync(join(profileDir(), name), { force: true });
}

/**
 * Diferencia os dois motivos de recusa: a API do Linkbuilder responde JSON quando a sessão não
 * vale (não logado ou expirada); o firewall responde uma página HTML de bloqueio.
 */
export function refusalMessage(result, { title = '' } = {}) {
  const detail = result.body ? (result.body.message || result.body.error || '') : '';
  if (result.body) {
    return `O Mercado Livre recusou o pedido (HTTP ${result.status}${detail ? `: ${String(detail).slice(0, 120)}` : ''}). `
      + 'A sessão do navegador do bot não está logada ou expirou: faça o login de novo (painel → Mercado Livre → Fazer login do Mercado Livre) e confira se o Gerador de links abre logado.';
  }
  return `O firewall do Mercado Livre bloqueou o navegador do bot (HTTP ${result.status}${title ? `, página "${title.slice(0, 60)}"` : ''}). `
    + 'O login pode estar certo: o site recusou o navegador automatizado. Use o modo parâmetros (matt_word/matt_tool) ou tente mais tarde.';
}

// O perfil só pode ser aberto por um navegador por vez: as gerações de link e o login entram numa fila.
let queue = Promise.resolve();
let loginOpen = false;
export const setLoginOpen = (open) => { loginOpen = open; };

const freePort = () => new Promise((done, fail) => {
  const server = createServer();
  server.once('error', fail);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => done(port)); });
});

/** Abre o navegador comum (como no login) com a porta de depuração só em 127.0.0.1 e conecta o Playwright. */
async function openPlainBrowser(chromium, { offscreen }) {
  const port = await freePort();
  const child = spawn(findBrowser(), [
    `--user-data-dir=${profileDir()}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', ...containerArgs(),
    ...(offscreen ? ['--window-position=-32000,-32000', '--window-size=1280,800'] : ['--window-size=1280,800']), 'about:blank'
  ], { stdio: 'ignore' });
  const kill = () => { if (child.exitCode === null) child.kill(); };
  try {
    let browser = null;
    for (let attempt = 0; attempt < 40 && !browser; attempt += 1) {
      if (child.exitCode !== null) throw new Error('o navegador fechou ao abrir (o perfil pode estar em uso pelo login)');
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 }).catch(() => null);
      if (!browser) await new Promise((done) => setTimeout(done, 250));
    }
    if (!browser) throw new Error('não consegui conectar ao navegador');
    const context = browser.contexts()[0] ?? await browser.newContext();
    return { context, close: async () => { await browser.close().catch(() => {}); kill(); } };
  } catch (error) { kill(); throw error; }
}

/** Abre o perfil logado, vai ao Linkbuilder e chama o createLink de dentro da página. */
export function createLinksInBrowser(urls, tag, { headless = process.env.ML_BROWSER_HEADLESS === 'true' } = {}) {
  const run = async () => {
    if (loginOpen) throw new Error('O login do Mercado Livre está aberto no painel; termine o login antes.');
    if (!hasProfile()) throw Object.assign(new Error('Faça o login do Mercado Livre no navegador do bot primeiro (painel → Mercado Livre → Fazer login).'), { session: true });
    const { chromium } = await import('playwright-core');
    mkdirSync(profileDir(), { recursive: true });
    clearProfileLock();
    // Com janela, ela abre fora da área visível do monitor (ML_BROWSER_OFFSCREEN=false mostra na tela).
    // Para o site continua sendo um navegador comum com janela; só muda onde ela fica no seu monitor.
    // No Docker a janela já fica na tela virtual, invisível.
    const offscreen = !headless && !process.env.BOT_IN_DOCKER && process.env.ML_BROWSER_OFFSCREEN !== 'false';
    const plain = process.env.ML_BROWSER_PLAIN === 'true';
    const opened = plain
      ? await openPlainBrowser(chromium, { offscreen: !process.env.BOT_IN_DOCKER && process.env.ML_BROWSER_OFFSCREEN !== 'false' })
      : await chromium.launchPersistentContext(profileDir(), {
        executablePath: findBrowser(), headless, locale: 'pt-BR',
        args: [...containerArgs(), ...(offscreen ? ['--window-position=-32000,-32000', '--window-size=1280,800'] : [])]
      }).then((persistent) => ({ context: persistent, close: () => persistent.close() }));
    const { context } = opened;
    try {
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(LINKBUILDER_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (/login|registration|jms\/mlb\/lgz/.test(page.url())) {
        throw Object.assign(new Error('A sessão do Mercado Livre no navegador do bot expirou. Rode de novo: node ml-login.js'), { session: true });
      }
      await page.waitForTimeout(1500);
      const result = await page.evaluate(async ({ api, urls: list, tag: label }) => {
        const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ urls: list, tag: label }) });
        const text = await response.text();
        try { return { status: response.status, body: JSON.parse(text) }; } catch { return { status: response.status, text: text.slice(0, 200) }; }
      }, { api: CREATE_LINK_URL, urls, tag });
      if (result.status === 401 || result.status === 403) {
        throw Object.assign(new Error(refusalMessage(result, { title: await page.title().catch(() => '') })), { session: true });
      }
      if (result.status !== 200 || !result.body) throw new Error(`Linkbuilder respondeu HTTP ${result.status}: ${result.text ?? ''}`);
      return (result.body.urls ?? []).map((item) => item?.short_url ?? '');
    } finally {
      await opened.close();
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}
