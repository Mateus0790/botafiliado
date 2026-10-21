/**
 * Nichos prontos para a postagem automática. Cada um traz palavras-chave (usadas na busca da
 * Shopee e do AliExpress) e a categoria do Mercado Livre cujos mais vendidos são usados direto,
 * sem depender da adivinhação de categoria pela palavra. Categorias conferidas na API em 10/2026.
 */
export const NICHOS = {
  tecnologia: { nome: '💻 Tecnologia', ml: 'MLB1000', keywords: ['fone bluetooth', 'smartwatch', 'caixa de som bluetooth', 'carregador turbo'] },
  informatica: { nome: '🖥️ Informática', ml: 'MLB1648', keywords: ['mouse gamer', 'teclado mecânico', 'ssd', 'monitor'] },
  celulares: { nome: '📱 Celulares e acessórios', ml: 'MLB1051', keywords: ['capa celular', 'power bank', 'película', 'smartphone'] },
  games: { nome: '🎮 Games', ml: 'MLB1144', keywords: ['controle', 'headset gamer', 'cadeira gamer'] },
  casa: { nome: '🏠 Casa e decoração', ml: 'MLB1574', keywords: ['organizador', 'panela', 'luminária', 'utensílios de cozinha'] },
  eletrodomesticos: { nome: '🔌 Eletrodomésticos', ml: 'MLB5726', keywords: ['air fryer', 'liquidificador', 'aspirador de pó', 'cafeteira'] },
  moda: { nome: '👗 Moda', ml: 'MLB1430', keywords: ['tênis', 'camiseta', 'relógio', 'mochila'] },
  beleza: { nome: '💄 Beleza', ml: 'MLB1246', keywords: ['perfume', 'maquiagem', 'skincare', 'secador de cabelo'] },
  esporte: { nome: '💪 Esporte e fitness', ml: 'MLB1276', keywords: ['roupa academia', 'garrafa térmica', 'halter'] },
  saude: { nome: '🩺 Saúde', ml: 'MLB264586', keywords: ['creatina', 'whey protein', 'vitamina', 'massageador'] },
  brinquedos: { nome: '🧸 Brinquedos', ml: 'MLB1132', keywords: ['brinquedo', 'lego', 'boneca'] },
  bebes: { nome: '🍼 Bebês', ml: 'MLB1384', keywords: ['fralda', 'carrinho de bebê', 'mamadeira'] },
  pet: { nome: '🐶 Pet', ml: 'MLB1071', keywords: ['ração', 'brinquedo pet', 'coleira', 'cama pet'] },
  automotivo: { nome: '🚗 Automotivo', ml: 'MLB5672', keywords: ['suporte veicular', 'aspirador automotivo', 'acessório carro'] },
  livros: { nome: '📚 Livros', ml: 'MLB1196', keywords: ['livro'] }
};

export const NICHO_OPTIONS = Object.entries(NICHOS).map(([id, nicho]) => [id, nicho.nome]);

/**
 * Termos de busca da automática: as palavras-chave livres e as dos nichos escolhidos.
 * Termos de nicho levam a categoria do Mercado Livre (`mlCategory`).
 */
export function searchTerms(keywords, nichoIds) {
  const terms = new Map(keywords.map((keyword) => [keyword.toLowerCase(), { keyword }]));
  for (const id of nichoIds) {
    const nicho = NICHOS[id];
    if (!nicho) continue;
    for (const keyword of nicho.keywords) {
      if (!terms.has(keyword)) terms.set(keyword, { keyword, mlCategory: nicho.ml, nicho: nicho.nome });
    }
  }
  return [...terms.values()];
}
