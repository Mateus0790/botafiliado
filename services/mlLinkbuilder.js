/**
 * Links meli.la pelo Linkbuilder do portal de afiliados do Mercado Livre.
 *
 * NÃO é uma API pública: é a chamada que a página do Linkbuilder faz. O firewall do Mercado Livre
 * recusa requisições que não venham de um navegador, então ela é feita de dentro do Chrome/Edge
 * do bot, logado pelo dono da conta (services/mlBrowser.js). Se a sessão expirar ou o Mercado Livre
 * recusar, o erro é repassado (e o dono é avisado), em vez de postar links que não contam comissão.
 */
import { createLinksInBrowser } from './mlBrowser.js';

const BATCH_SIZE = 10;

// No Docker não há navegador (BOT_NO_BROWSER=1): o modo meli.la vira o modo parâmetros.
export const linkbuilderEnabled = (env = process.env) => env.ML_LINK_MODE === 'linkbuilder' && !env.BOT_NO_BROWSER;

export class SessionError extends Error {}

// Os testes trocam o navegador por uma função falsa.
let defaultBrowser = createLinksInBrowser;
export const setLinkbuilderBrowser = (browser) => { defaultBrowser = browser ?? createLinksInBrowser; };

/** Gera um meli.la para cada URL (na mesma ordem), em lotes de 10. */
export async function createMeliLinks(urls, { env = process.env, browser = defaultBrowser } = {}) {
  if (!env.ML_ETIQUETA) throw new SessionError('Modo meli.la ligado, mas falta a etiqueta do Linkbuilder (painel → Mercado Livre).');
  const links = [];
  for (let start = 0; start < urls.length; start += BATCH_SIZE) {
    const batch = urls.slice(start, start + BATCH_SIZE);
    let created;
    try {
      created = await browser(batch, env.ML_ETIQUETA);
    } catch (error) {
      throw error.session ? new SessionError(error.message) : new Error(`Linkbuilder do Mercado Livre: ${error.message}`);
    }
    if (created.length !== batch.length || created.some((link) => !String(link).startsWith('https://meli.la/'))) {
      throw new Error(`Linkbuilder devolveu ${created.filter(Boolean).length} link(s) para ${batch.length} URL(s).`);
    }
    links.push(...created);
  }
  return links;
}

export async function createMeliLink(url, options) {
  const [link] = await createMeliLinks([url], options);
  return link;
}
