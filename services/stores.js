import { searchShopeeOffers, SHOPEE_SORT } from './shopee.js';
import { searchAliExpressOffers } from './aliexpress.js';
import { searchMercadoLivreOffers } from './mercadolivre.js';

/**
 * Lojas suportadas. `enabledKey` é o liga/desliga do painel; `search` existe só nas lojas cuja
 * API permite buscar ofertas por palavra-chave com preço, vendas e avaliação (postagem automática).
 */
export const STORES = {
  shopee: {
    label: 'Shopee', enabledKey: 'STORE_SHOPEE',
    configured: (env) => Boolean(env.SHOPEE_APP_ID && env.SHOPEE_APP_SECRET),
    search: (keyword, { sort, page, limit }) => searchShopeeOffers(keyword, { sortType: SHOPEE_SORT[sort] ?? SHOPEE_SORT['mais-vendidos'], page, limit })
  },
  aliexpress: {
    label: 'AliExpress', enabledKey: 'STORE_ALIEXPRESS',
    configured: (env) => Boolean(env.ALIEXPRESS_APP_KEY && env.ALIEXPRESS_APP_SECRET && env.ALIEXPRESS_TRACKING_ID),
    search: searchAliExpressOffers
  },
  amazon: {
    label: 'Amazon', enabledKey: 'STORE_AMAZON',
    // Sem a API de produtos (liberada só após 3 vendas), não há busca: só link manual com a sua tag.
    configured: (env) => Boolean(env.AMAZON_TAG)
  },
  mercadolivre: {
    label: 'Mercado Livre', enabledKey: 'STORE_MERCADOLIVRE',
    configured: (env) => Boolean(env.ML_CLIENT_ID && env.ML_CLIENT_SECRET),
    // Mais vendidos da categoria da palavra-chave; a API não informa nota, vendas nem comissão.
    search: (keyword, { sort, page, category }) => searchMercadoLivreOffers(keyword, { sort, page, category })
  }
};

export const storeEnabled = (id, env = process.env) => env[STORES[id].enabledKey] !== 'false';

/** Lojas que entram no rodízio da postagem automática: ativas, com credenciais e com busca. */
export const autoStores = (env = process.env) =>
  Object.keys(STORES).filter((id) => STORES[id].search && storeEnabled(id, env) && STORES[id].configured(env));

export function storesStatus(env = process.env) {
  return Object.entries(STORES).map(([id, store]) => ({
    id, label: store.label, key: store.enabledKey, enabled: storeEnabled(id, env), configured: store.configured(env),
    supportsAuto: Boolean(store.search), inAuto: autoStores(env).includes(id)
  }));
}
