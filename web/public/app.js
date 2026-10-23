// Painel do Bot Afiliado: SPA simples, sem dependências. Todo texto vindo da API entra via textContent.

const PAGES = [
  { id: 'inicio', title: 'Início', icon: '🏠', description: 'Visão geral do bot.' },
  { id: 'auto', title: 'Postagem automática', icon: '⏱️', group: 'Configuração', sections: ['auto'], actions: ['run-now', 'urgent-now', 'coupons-now'] },
  { id: 'mensagem', title: 'Mensagem', icon: '💬', sections: ['mensagem'] },
  { id: 'discord', title: 'Discord', icon: '🎮', sections: ['discord'], actions: ['test-discord', 'register-commands'] },
  { id: 'telegram', title: 'Telegram', icon: '✈️', sections: ['telegram'], actions: ['test-telegram'] },
  { id: 'whatsapp', title: 'WhatsApp', icon: '📲', sections: ['whatsapp'], actions: ['test-whatsapp'] },
  { id: 'instagram', title: 'Instagram', icon: '📸', sections: ['instagram'], actions: ['test-instagram'] },
  { id: 'lojas', title: 'Lojas e APIs', icon: '🛍️', sections: ['shopee', 'aliexpress', 'mercadolivre'], description: 'Credenciais das plataformas de afiliados.' },
  { id: 'postar', title: 'Postar link', icon: '📣', group: 'Ferramentas', description: 'Pré-visualize ou publique um produto de qualquer loja.' },
  { id: 'cupons', title: 'Cupons', icon: '🎟️', description: 'Cadastre cupons com o link da página da loja: o bot gera o link de afiliado e publica no Discord e no Telegram.' },
  { id: 'historico', title: 'Histórico', icon: '🗂️', description: 'Produtos já postados. Liberar um item permite postá-lo de novo.' },
  { id: 'logs', title: 'Logs', icon: '📜', description: 'Últimas mensagens do bot (atualiza sozinho).' },
  { id: 'sistema', title: 'Sistema', icon: '⚙️', sections: ['geral'], description: 'Fuso horário, rede e senha do painel.' }
];

const ACTION_LABELS = {
  'run-now': 'Rodar agora', 'coupons-now': 'Buscar cupons agora', 'urgent-now': 'Procurar oferta urgente agora', 'test-discord': 'Testar conexão', 'register-commands': 'Registrar comandos',
  'test-telegram': 'Testar canal', 'test-whatsapp': 'Mandar exemplo no meu privado', 'test-instagram': 'Testar conta', 'test-shopee': 'Testar API', 'test-ml-session': 'Testar sessão meli.la',
  'ml-login-start': 'Fazer login do Mercado Livre', 'ml-login-stop': 'Concluir login'
};
const SECTION_ACTIONS = { shopee: ['test-shopee'], mercadolivre: ['ml-login-start', 'ml-login-stop', 'test-ml-session'] };
const LINK_TEST_SECTIONS = new Set(['aliexpress', 'mercadolivre']);

let state = null;
let refreshTimer = null;

// ---------- utilidades ----------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : String(child));
  return el;
}

function toast(message, type = 'ok') {
  const el = h('div', { class: `toast ${type}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 5000);
}

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/setup')) { showAuth(); throw new Error(data.error || 'Faça login.'); }
  if (!response.ok) throw new Error(data.error || `Erro ${response.status}`);
  return data;
}

async function withBusy(button, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Aguarde…';
  try { return await task(); } finally { button.disabled = false; button.textContent = label; }
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const relative = (iso) => {
  if (!iso) return '—';
  const minutes = Math.round((new Date(iso) - Date.now()) / 60000);
  if (Math.abs(minutes) < 1) return 'agora';
  return minutes > 0 ? `em ${minutes} min` : `há ${-minutes} min`;
};

// ---------- autenticação ----------
async function boot() {
  const session = await api('/api/session');
  if (!session.authenticated) return showAuth(session.setupRequired);
  await loadState();
  document.getElementById('auth').hidden = true;
  document.getElementById('app').hidden = false;
  route();
}

function showAuth(setupRequired = false) {
  clearInterval(refreshTimer);
  document.getElementById('app').hidden = true;
  document.getElementById('auth').hidden = false;
  const form = document.getElementById('auth-form');
  form.dataset.mode = setupRequired ? 'setup' : 'login';
  document.getElementById('auth-title').textContent = setupRequired ? 'Criar senha do painel' : 'Entrar no painel';
  document.getElementById('auth-help').textContent = setupRequired
    ? 'Primeiro acesso: copie o código que aparece no log do bot (docker compose logs) e crie uma senha com pelo menos 8 caracteres.'
    : '';
  document.getElementById('code-field').hidden = !setupRequired;
  document.getElementById('confirm-field').hidden = !setupRequired;
  document.getElementById('auth-submit').textContent = setupRequired ? 'Criar senha e entrar' : 'Entrar';
  form.password.autocomplete = setupRequired ? 'new-password' : 'current-password';
  form.password.focus();
}

document.getElementById('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.getElementById('auth-error');
  error.textContent = '';
  try {
    if (form.dataset.mode === 'setup') {
      if (form.password.value !== form.confirm.value) throw new Error('As senhas não conferem.');
      await api('/api/setup', { code: form.code.value, password: form.password.value });
    } else {
      await api('/api/login', { password: form.password.value });
    }
    form.reset();
    await boot();
  } catch (err) { error.textContent = err.message; }
});

document.getElementById('logout').addEventListener('click', async () => {
  await api('/api/logout', {}).catch(() => {});
  showAuth(false);
});

// ---------- navegação ----------
async function loadState() { state = await api('/api/state'); }

function renderNav(active) {
  const nav = document.getElementById('nav');
  nav.replaceChildren();
  for (const page of PAGES) {
    if (page.group) nav.append(h('div', { class: 'nav-group' }, page.group));
    nav.append(h('a', { class: `nav-link${page.id === active ? ' active' : ''}`, href: `#${page.id}` }, h('span', { 'aria-hidden': 'true' }, page.icon), page.title));
  }
}

function route() {
  clearInterval(refreshTimer);
  const page = PAGES.find((item) => item.id === location.hash.slice(1)) ?? PAGES[0];
  renderNav(page.id);
  document.getElementById('page-title').textContent = page.title;
  const description = page.description ?? (page.sections?.length === 1 ? state.sections.find((s) => s.id === page.sections[0])?.description : '');
  document.getElementById('page-description').textContent = description ?? '';
  const container = document.getElementById('page');
  container.replaceChildren();
  window.scrollTo(0, 0);
  const renderers = { inicio: renderHome, whatsapp: renderWhatsapp, postar: renderPost, cupons: renderCoupons, historico: renderHistory, logs: renderLogs };
  (renderers[page.id] ?? renderSettings)(container, page);
}
window.addEventListener('hashchange', route);

// ---------- início ----------
function statusPill(text, kind) { return h('span', { class: `pill ${kind}` }, text); }

function renderHome(container) {
  const draw = () => {
    const { discord, telegram, autopost, destinations, totalPosts } = state.status;
    const discordKind = { online: 'ok', conectando: 'warn', erro: 'danger' }[discord.state] ?? 'off';
    const toggle = h('button', { class: 'btn', onclick: async (event) => {
      await withBusy(event.currentTarget, () => saveConfig({ AUTO_ENABLED: autopost.enabled ? 'false' : 'true' }));
      draw();
    } }, autopost.enabled ? 'Desligar' : 'Ligar');
    const runNow = h('button', { class: 'btn primary', onclick: (event) => runAction('run-now', {}, event.currentTarget, result) }, 'Rodar agora');
    const result = h('div', { class: 'result' });
    const last = autopost.lastRun;

    container.replaceChildren(
      h('div', { class: 'grid' },
        h('div', { class: 'card' }, h('div', { class: 'stat-label' }, 'Discord'),
          h('div', { class: 'stat-value' }, statusPill(discord.state, discordKind)), h('div', { class: 'stat-detail' }, discord.detail)),
        h('div', { class: 'card' }, h('div', { class: 'stat-label' }, 'Telegram'),
          h('div', { class: 'stat-value' }, statusPill(!telegram.configured ? 'não configurado' : telegram.enabled ? 'ativo' : 'desligado', telegram.configured && telegram.enabled ? 'ok' : 'off')),
          h('div', { class: 'stat-detail' }, `Destinos ativos: ${destinations.join(' e ') || 'nenhum'}`)),
        h('div', { class: 'card' }, h('div', { class: 'stat-label' }, 'Postagem automática'),
          h('div', { class: 'stat-value' }, statusPill(autopost.enabled ? 'ligada' : 'desligada', autopost.enabled ? 'ok' : 'off')),
          h('div', { class: 'stat-detail' }, autopost.enabled ? `Próxima rodada ${relative(autopost.nextRunAt)} · a cada ${autopost.intervalMin} min` : `A cada ${autopost.intervalMin} min quando ligada`)),
        h('div', { class: 'card' }, h('div', { class: 'stat-label' }, 'Ofertas postadas'),
          h('div', { class: 'stat-value' }, String(totalPosts)), h('div', { class: 'stat-detail' },
            autopost.terms?.length ? `${autopost.terms.length} termos de busca · ${autopost.nichos.length} nicho(s) · ${autopost.keywords.length} palavra(s) extra(s)` : 'Nenhuma palavra-chave ou nicho'))
      ),
      storesCard(draw),
      h('div', { class: 'card mt' },
        h('h2', {}, 'Última rodada automática'),
        h('p', { class: 'muted' }, last
          ? `${fmtDate(last.at)}${last.keyword ? ` · "${last.keyword}"` : ''}${last.store ? ` no ${last.store}` : ''} — ${last.posted.length ? `postou: ${last.posted.join(' · ')}` : last.reason}`
          : 'Nenhuma rodada desde que o bot iniciou.'),
        h('div', { class: 'actions' }, runNow, toggle, h('a', { class: 'btn ghost', href: '#auto' }, 'Configurar')),
        result)
    );
  };
  draw();
  refreshTimer = setInterval(async () => { await loadState().catch(() => {}); if (location.hash.slice(1) === 'inicio' || !location.hash) draw(); }, 15000);
}

/** Liga/desliga de cada loja, com o que ela faz no momento. `onChange` redesenha a página. */
function storesCard(onChange) {
  const describe = (store) => {
    if (!store.enabled) return ['desativada', 'off', 'Não divulga links desta loja.'];
    if (!store.configured) return ['sem credenciais', 'warn', 'Preencha as credenciais em Lojas e APIs.'];
    if (store.id === 'mercadolivre' && store.inAuto && state.status.mlPausedUntil) {
      return ['pausada na automática', 'warn', `O Linkbuilder recusou o navegador; volta a tentar ${fmtDate(state.status.mlPausedUntil)} (ou ao mudar algo do Mercado Livre).`];
    }
    if (store.inAuto) return ['automática + manual', 'ok', 'Entra no rodízio da postagem automática.'];
    return ['só manual', 'ok', store.supportsAuto ? '' : 'A API não permite busca automática; use Postar link ou /postar.'];
  };
  const rows = state.status.stores.map((store) => {
    const [text, kind, detail] = describe(store);
    const toggle = h('input', { type: 'checkbox', checked: store.enabled, 'aria-label': `Divulgar ${store.label}`, onchange: async (event) => {
      event.currentTarget.disabled = true;
      try { await saveConfig({ [store.key]: event.currentTarget.checked ? 'true' : 'false' }); } catch (error) { toast(error.message, 'error'); }
      onChange();
    } });
    return h('div', { class: 'store-row' },
      h('label', { class: 'switch' }, toggle, store.label),
      h('div', {}, statusPill(text, kind), detail ? h('div', { class: 'stat-detail' }, detail) : null));
  });
  return h('div', { class: 'card mt' }, h('h2', {}, 'Lojas'), h('p', { class: 'muted' }, 'Escolha de quais lojas o bot divulga links.'), h('div', { class: 'store-list' }, rows));
}

// ---------- configurações ----------
async function saveConfig(values, clear = []) {
  const { changed, state: next } = await api('/api/config', { values, clear });
  state = next;
  toast(changed.length ? 'Configurações salvas.' : 'Nada mudou.');
  return changed;
}

function fieldInput(field) {
  const id = `f-${field.key}`;
  const common = { id, name: field.key };
  switch (field.type) {
    case 'bool':
      return h('label', { class: 'switch' }, h('input', { ...common, type: 'checkbox', checked: field.value === 'true' }), field.label);
    case 'list':
      return h('textarea', { ...common, placeholder: field.key === 'AUTO_BLOCKED_WORDS' ? 'capinha\npelícula\nusado' : 'fone bluetooth\nsmartwatch\nair fryer' },
        (field.value || '').split(',').filter(Boolean).join('\n'));
    case 'multi': {
      const chosen = new Set((field.value || '').split(',').filter(Boolean));
      return h('div', { class: 'checks', id }, field.options.map(([value, label]) =>
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: field.key, value, checked: chosen.has(value) }), label)));
    }
    case 'select':
      return h('select', common, field.options.map(([value, label]) => h('option', { value, selected: (field.value || field.default) === value }, label)));
    case 'secret':
      return h('input', { ...common, type: 'password', autocomplete: 'new-password',
        placeholder: field.isSet ? `Definido (${field.hint}) — deixe em branco para manter` : 'Não definido' });
    case 'number':
    case 'percent':
      return h('input', { ...common, type: 'number', value: field.value, placeholder: field.default ? `Padrão: ${field.default}` : '', min: field.min, max: field.max, step: field.step ?? 'any' });
    default:
      return h('input', { ...common, type: field.type === 'url' ? 'url' : 'text', value: field.value, placeholder: field.default ? `Padrão: ${field.default}` : '', autocomplete: 'off' });
  }
}

function readValue(form, field) {
  if (field.type === 'multi') {
    return [...form.querySelectorAll(`input[name="${field.key}"]:checked`)].map((input) => input.value).join(',');
  }
  const input = form.elements[field.key];
  if (field.type === 'bool') return input.checked ? 'true' : 'false';
  if (field.type === 'list') return input.value.split('\n').map((line) => line.trim()).filter(Boolean).join(',');
  return input.value.trim();
}

function originalValue(field) {
  if (field.type === 'bool') return field.value === 'true' ? 'true' : 'false';
  if (field.type === 'secret') return '';
  // O select já mostra o padrão selecionado quando não há valor salvo.
  if (field.type === 'select') return field.value || field.default;
  return field.value ?? '';
}

function renderSection(section, { showHeader = true } = {}) {
  // O liga/desliga das lojas fica no cartão "Lojas", não repetido em cada formulário.
  const fields = state.fields.filter((field) => field.section === section.id && !field.key.startsWith('STORE_'));
  const form = h('form', { class: 'fields' });
  const grid = h('div', { class: 'fields-grid' });
  for (const field of fields) {
    const sourceBadge = h('span', { class: `badge ${field.source}` }, field.source === 'painel' ? 'salvo no painel' : field.source === '.env' ? 'do .env/Docker' : 'padrão');
    const reset = field.source === 'painel'
      ? h('button', { type: 'button', class: 'link-btn', title: 'Volta ao valor do .env/Docker ou ao padrão', onclick: async () => { await saveConfig({}, [field.key]); route(); } }, 'restaurar')
      : null;
    const wide = ['list', 'bool', 'url', 'multi'].includes(field.type);
    grid.append(field.type === 'bool'
      ? h('div', { class: 'field wide' }, h('div', { class: 'field-head' }, fieldInput(field), h('span', {}, sourceBadge, ' ', reset)))
      : h('div', { class: `field${wide ? ' wide' : ''}` },
        h('div', { class: 'field-head' }, h('label', { for: `f-${field.key}` }, field.label), h('span', {}, sourceBadge, ' ', reset)),
        fieldInput(field)));
  }
  const result = h('div', { class: 'result' });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Salvar');
  const extra = (SECTION_ACTIONS[section.id] ?? []).map((action) =>
    h('button', { type: 'button', class: 'btn', onclick: (event) => runAction(action, {}, event.currentTarget, result) }, ACTION_LABELS[action]));
  form.append(grid, h('div', { class: 'actions' }, save, ...extra));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = {};
    for (const field of fields) {
      const value = readValue(form, field);
      if (field.type === 'secret' ? value !== '' : value !== originalValue(field)) values[field.key] = value;
    }
    if (!Object.keys(values).length) return toast('Nada mudou.');
    try {
      await withBusy(save, () => saveConfig(values));
      route();
    } catch (error) { toast(error.message, 'error'); }
  });

  // Em páginas de uma seção só, o título e a descrição já estão no cabeçalho da página.
  const card = h('section', { class: 'card' }, showHeader && h('h2', {}, section.title), showHeader && h('p', { class: 'muted' }, section.description), form);
  if (LINK_TEST_SECTIONS.has(section.id)) card.append(linkTester(`Cole um link de produto do ${section.title} para testar`));
  card.append(result);
  return card;
}

function renderSettings(container, page) {
  const cards = page.sections.map((id) => renderSection(state.sections.find((section) => section.id === id), { showHeader: page.sections.length > 1 }));
  if (page.actions?.length) {
    const result = h('div', { class: 'result' });
    cards.unshift(h('section', { class: 'card' }, h('h2', {}, 'Ações'),
      h('div', { class: 'actions' }, page.actions.map((action) =>
        h('button', { class: 'btn', onclick: (event) => runAction(action, {}, event.currentTarget, result) }, ACTION_LABELS[action]))),
      result));
  }
  if (page.id === 'sistema') cards.push(passwordCard());
  if (page.id === 'lojas') cards.unshift(storesCard(() => route()));
  container.replaceChildren(h('div', { class: 'stack' }, cards));
}

// ---------- WhatsApp por QR code ----------
const WA_STATES = { conectado: ['conectado', 'ok'], 'aguardando-qr': ['aguardando QR code', 'warn'], conectando: ['conectando', 'warn'], desconectado: ['desconectado', 'off'] };

function renderWhatsapp(container, page) {
  renderSettings(container, page);
  const mode = state.fields.find((field) => field.key === 'WHATSAPP_MODE');
  if ((mode.value || mode.default) !== 'web') return;
  const stack = container.querySelector('.stack');
  const connection = h('section', { class: 'card' });
  const targetsCard = h('section', { class: 'card' });
  stack.append(connection, targetsCard);
  let last = null;

  const post = async (action, body = {}) => {
    const data = await api(`/api/whatsapp/${action}`, body);
    if (!data.ok) throw new Error(data.message);
    return data;
  };

  function drawConnection(wa) {
    const [text, kind] = WA_STATES[wa.state] ?? [wa.state, 'off'];
    const connect = h('button', { class: 'btn primary', onclick: async (event) => {
      try { drawConnection(await withBusy(event.currentTarget, () => post('connect'))); } catch (error) { toast(error.message, 'error'); }
    } }, 'Conectar por QR code');
    const disconnect = h('button', { class: 'btn', onclick: async (event) => {
      try { drawConnection(await withBusy(event.currentTarget, () => post('disconnect'))); } catch (error) { toast(error.message, 'error'); }
    } }, 'Desconectar');
    const logout = h('button', { class: 'btn ghost', onclick: async (event) => {
      if (!confirm('Apagar a sessão? Será preciso escanear o QR code de novo.')) return;
      try { drawConnection(await withBusy(event.currentTarget, () => post('disconnect', { logout: true }))); } catch (error) { toast(error.message, 'error'); }
    } }, 'Sair e apagar sessão');
    const busy = wa.state === 'conectado' || wa.state === 'aguardando-qr' || wa.state === 'conectando';
    connection.replaceChildren(...[
      h('h2', {}, 'Conexão'),
      h('div', { class: 'stat-value' }, statusPill(text, kind)),
      h('p', { class: 'muted' }, wa.detail),
      wa.qr ? h('img', { class: 'qr', src: wa.qr, alt: 'QR code para conectar o WhatsApp' }) : null,
      wa.qr ? h('p', { class: 'muted' }, 'No celular: WhatsApp → ⋮ (ou Configurações) → Aparelhos conectados → Conectar aparelho. O QR code muda a cada ~20 s.') : null,
      h('div', { class: 'actions' }, busy ? disconnect : connect, logout)].filter(Boolean));
    if (wa.state === 'conectado' && last !== 'conectado') loadTargets(wa.targets);
    if (wa.state !== 'conectado') drawTargets(wa.targets, null);
    last = wa.state;
  }

  function drawTargets(saved, available, error) {
    const chosen = new Map(saved.map((target) => [target.id, target]));
    const items = [...(available ?? [])];
    for (const target of saved) if (!items.some((item) => item.id === target.id)) items.push(target);
    const list = items.length
      ? h('div', { class: 'checks wa-targets' }, items.map((item) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', value: item.id, checked: chosen.has(item.id), 'data-name': item.name, 'data-type': item.type }),
        `${item.type === 'grupo' ? '👥' : '📢'} ${item.name}`)))
      : h('p', { class: 'muted' }, available ? 'Nenhum canal ou grupo encontrado. Cole o link do canal abaixo.' : 'Conecte o WhatsApp para ver seus canais e grupos.');
    const link = h('input', { type: 'url', placeholder: 'https://whatsapp.com/channel/…' });
    const add = h('button', { class: 'btn', type: 'button', onclick: async (event) => {
      try {
        const { item } = await withBusy(event.currentTarget, () => post('find-channel', { link: link.value }));
        drawTargets([...currentChoice(), item], [...(available ?? []).filter((other) => other.id !== item.id), item]);
        toast(`Canal "${item.name}" adicionado. Clique em Salvar.`);
      } catch (err) { toast(err.message, 'error'); }
    } }, 'Adicionar canal');
    const save = h('button', { class: 'btn primary', type: 'button', onclick: async (event) => {
      try {
        const { targets } = await withBusy(event.currentTarget, () => post('targets', { targets: currentChoice() }));
        toast(targets.length ? `Vai postar em: ${targets.map((target) => target.name).join(', ')}.` : 'Nenhum destino escolhido.');
      } catch (err) { toast(err.message, 'error'); }
    } }, 'Salvar');
    const reload = h('button', { class: 'btn ghost', type: 'button', onclick: () => loadTargets(currentChoice()) }, 'Atualizar lista');
    targetsCard.replaceChildren(...[
      h('h2', {}, 'Onde postar'),
      h('p', { class: 'muted' }, 'Marque os canais (📢, só os que você é dono ou administrador) e grupos (👥) que recebem as ofertas. Canal que não aparecer: cole o link dele.'),
      error ? h('div', { class: 'notice error' }, error) : null,
      list,
      h('div', { class: 'inline mt' }, link, add),
      h('div', { class: 'actions' }, save, available ? reload : null)].filter(Boolean));
  }

  const currentChoice = () => [...targetsCard.querySelectorAll('.wa-targets input:checked')]
    .map((input) => ({ id: input.value, name: input.dataset.name, type: input.dataset.type }));

  async function loadTargets(saved) {
    targetsCard.replaceChildren(h('h2', {}, 'Onde postar'), h('p', { class: 'muted' }, 'Carregando canais e grupos…'));
    try { drawTargets(saved, (await post('available')).items); } catch (error) { drawTargets(saved, [], error.message); }
  }

  const refresh = async () => {
    try {
      const wa = await api('/api/whatsapp');
      if (wa.state !== last || wa.qr) drawConnection(wa);
    } catch { /* tenta de novo no próximo ciclo */ }
  };
  refresh();
  refreshTimer = setInterval(refresh, 3000);
}

// ---------- ações e produtos ----------
function productCard(product) {
  const meta = [product.platformLabel];
  if (product.discount) meta.push(`${product.discount}% OFF`);
  if (product.rating) meta.push(`⭐ ${Number(product.rating).toFixed(1)} · ${Number(product.sales).toLocaleString('pt-BR')} vendidos`);
  if (product.commissionRate) meta.push(`comissão ${(product.commissionRate * 100).toFixed(0)}%`);
  if (product.freeShipping) meta.push('frete grátis');
  return h('div', { class: 'product' },
    product.image ? h('img', { src: product.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('div', {}),
    h('div', {}, h('h3', {}, product.title),
      h('div', { class: 'price' },
        product.originalPrice ? h('s', { class: 'muted' }, new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(product.originalPrice)) : null,
        product.originalPrice ? ' → ' : null, product.price),
      h('div', { class: 'meta' }, meta.join(' · ')),
      h('a', { href: product.affiliateUrl, target: '_blank', rel: 'noopener noreferrer', class: 'meta' }, product.affiliateUrl)));
}

async function runAction(action, body, button, target) {
  try {
    const data = await withBusy(button, () => api(`/api/actions/${action}`, body));
    target.replaceChildren(...[h('div', { class: `notice ${data.ok ? 'ok' : 'error'}` }, data.message),
      data.link ? h('a', { class: 'btn primary', href: data.link, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir tela do navegador') : null,
      ...(data.errors ?? []).map((error) => h('div', { class: 'notice error' }, error)),
      ...(data.posted ?? []).map(productCard)].filter(Boolean));
    if (data.ok && action === 'run-now') loadState().catch(() => {});
    return data;
  } catch (error) {
    target.replaceChildren(h('div', { class: 'notice error' }, error.message));
  }
}

function linkTester(placeholder) {
  const input = h('input', { type: 'url', placeholder });
  const result = h('div', { class: 'result' });
  const button = h('button', { class: 'btn', type: 'button', onclick: () => runAction('test-link', { url: input.value }, button, result) }, 'Testar link');
  return h('div', { class: 'stack mt' }, h('div', { class: 'inline' }, input, button), result);
}

function renderPost(container) {
  const input = h('input', { type: 'url', placeholder: 'https://shopee.com.br/... ou link curto' });
  const force = h('input', { type: 'checkbox' });
  const result = h('div', { class: 'result' });
  const previewBtn = h('button', { class: 'btn', onclick: () => runAction('test-link', { url: input.value }, previewBtn, result) }, 'Pré-visualizar');
  const postBtn = h('button', { class: 'btn primary', onclick: async () => {
    const data = await runAction('post-link', { url: input.value, force: force.checked }, postBtn, result);
    if (data?.ok) { input.value = ''; force.checked = false; }
  } }, 'Publicar');
  container.replaceChildren(h('section', { class: 'card' },
    h('h2', {}, 'Link do produto'),
    h('p', { class: 'muted' }, `Publica em: ${state.status.destinations.join(' e ') || 'nenhum destino ativo'}.`),
    h('div', { class: 'inline' }, input, previewBtn, postBtn),
    h('label', { class: 'switch mt' }, force, 'Postar mesmo se já foi postado'),
    result));
}

// ---------- cupons ----------
const REPEAT_OPTIONS = [[0, 'Não repetir'], [2, 'A cada 2 horas'], [4, 'A cada 4 horas'], [6, 'A cada 6 horas'], [12, 'A cada 12 horas'], [24, 'Uma vez por dia'], [48, 'A cada 2 dias']];
const STORE_NAMES = { shopee: 'Shopee', aliexpress: 'AliExpress', mercadolivre: 'Mercado Livre' };
const STATUS_KIND = { ativo: 'ok', pausado: 'off', expirado: 'danger' };

// datetime-local trabalha no fuso do navegador; o servidor guarda em ISO (UTC).
const toLocalInput = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

async function renderCoupons(container) {
  const list = h('div', { class: 'stack' });
  const formResult = h('div', { class: 'result' });
  const form = h('form', { class: 'fields' },
    h('input', { type: 'hidden', name: 'id' }),
    h('div', { class: 'fields-grid' },
      h('label', {}, 'Título *', h('input', { name: 'title', required: true, maxlength: '80', placeholder: 'Ex.: R$ 20 OFF em eletrônicos' })),
      h('label', {}, 'Código do cupom', h('input', { name: 'code', maxlength: '40', placeholder: 'Ex.: SHOPEE20 (vazio se for só link)', autocomplete: 'off' })),
      h('label', { class: 'field wide' }, 'Link da página do cupom, campanha ou loja *',
        h('input', { name: 'url', type: 'url', required: true, placeholder: 'https://shopee.com.br/… ou meli.la/…' })),
      h('label', { class: 'field wide' }, 'Descrição', h('textarea', { name: 'description', maxlength: '300', class: 'short', placeholder: 'Ex.: Desconto de R$ 20 em compras acima de R$ 99. Limitado.' })),
      h('label', {}, 'Válido até', h('input', { name: 'expiresAt', type: 'datetime-local' })),
      h('label', {}, 'Repetir a postagem', h('select', { name: 'repeatHours' }, REPEAT_OPTIONS.map(([value, label]) => h('option', { value }, label))))),
    h('label', { class: 'switch' }, h('input', { name: 'postNow', type: 'checkbox', checked: true }), 'Postar agora ao salvar'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'submit', name: 'save' }, 'Salvar cupom'),
      h('button', { class: 'btn ghost', type: 'button', name: 'cancel', hidden: true, onclick: () => resetForm() }, 'Cancelar edição')),
    formResult);

  const resetForm = () => {
    form.reset();
    form.elements.id.value = '';
    form.elements.postNow.checked = true;
    form.elements.cancel.hidden = true;
    form.elements.save.textContent = 'Salvar cupom';
  };
  const editCoupon = (coupon) => {
    form.elements.id.value = coupon.id;
    for (const key of ['title', 'code', 'url', 'description']) form.elements[key].value = coupon[key] ?? '';
    form.elements.expiresAt.value = toLocalInput(coupon.expiresAt);
    form.elements.repeatHours.value = String(coupon.repeatHours);
    form.elements.postNow.checked = false;
    form.elements.cancel.hidden = false;
    form.elements.save.textContent = 'Salvar alterações';
    form.scrollIntoView({ behavior: 'smooth' });
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(['id', 'title', 'code', 'url', 'description'].map((key) => [key, form.elements[key].value]));
    const expires = form.elements.expiresAt.value;
    const body = { ...values, id: values.id || undefined, expiresAt: expires ? new Date(expires).toISOString() : null,
      repeatHours: Number(form.elements.repeatHours.value), postNow: form.elements.postNow.checked };
    try {
      const data = await withBusy(form.elements.save, () => api('/api/coupons/save', body));
      const notices = [h('div', { class: 'notice ok' }, `Cupom salvo. Link de afiliado: ${data.coupon.affiliateUrl}`)];
      if (data.posted) {
        if (data.posted.sent?.length) notices.push(h('div', { class: 'notice ok' }, `Publicado em ${data.posted.sent.join(' e ')}.`));
        for (const error of data.posted.errors ?? []) notices.push(h('div', { class: 'notice error' }, error));
      }
      resetForm();
      formResult.replaceChildren(...notices);
      await drawList();
    } catch (error) { formResult.replaceChildren(h('div', { class: 'notice error' }, error.message)); }
  });

  async function drawList() {
    const { items } = await api('/api/coupons');
    if (!items.length) return list.replaceChildren(h('p', { class: 'muted' }, 'Nenhum cupom cadastrado ainda.'));
    list.replaceChildren(...items.map((coupon) => {
      const result = h('div', { class: 'result' });
      const meta = [STORE_NAMES[coupon.platform] ?? coupon.platform,
        coupon.expiresAt ? `válido até ${fmtDate(coupon.expiresAt)}` : 'sem validade',
        REPEAT_OPTIONS.find(([value]) => value === coupon.repeatHours)?.[1] ?? `a cada ${coupon.repeatHours} h`,
        coupon.postCount ? `postado ${coupon.postCount}× · último ${fmtDate(coupon.lastPostedAt)}` : 'ainda não postado'];
      const action = (label, task, kind = '') => h('button', { class: `btn ${kind}`, onclick: async (event) => {
        try { await withBusy(event.currentTarget, task); } catch (error) { result.replaceChildren(h('div', { class: 'notice error' }, error.message)); }
      } }, label);
      return h('div', { class: 'coupon' },
        h('div', { class: 'coupon-head' }, h('h3', {}, coupon.title), statusPill(coupon.status, STATUS_KIND[coupon.status] ?? 'off')),
        coupon.code ? h('div', { class: 'coupon-code' }, coupon.code) : null,
        coupon.description ? h('p', { class: 'muted' }, coupon.description) : null,
        h('div', { class: 'meta' }, meta.join(' · ')),
        h('a', { href: coupon.affiliateUrl, target: '_blank', rel: 'noopener noreferrer', class: 'meta' }, coupon.affiliateUrl),
        h('div', { class: 'actions' },
          coupon.status !== 'expirado' ? action('Postar agora', async () => {
            const data = await api('/api/coupons/post', { id: coupon.id });
            result.replaceChildren(h('div', { class: `notice ${data.ok ? 'ok' : 'error'}` }, data.message), ...(data.errors ?? []).map((error) => h('div', { class: 'notice error' }, error)));
            if (data.ok) setTimeout(drawList, 1500);
          }, 'primary') : null,
          coupon.status !== 'expirado' ? action(coupon.active ? 'Pausar' : 'Ativar', async () => { await api('/api/coupons/toggle', { id: coupon.id, active: !coupon.active }); await drawList(); }) : null,
          action('Editar', async () => editCoupon(coupon)),
          action('Excluir', async () => {
            if (!confirm(`Excluir o cupom "${coupon.title}"?`)) return;
            await api('/api/coupons/delete', { id: coupon.id });
            toast('Cupom excluído.');
            await drawList();
          }, 'danger')),
        result);
    }));
  }

  container.replaceChildren(h('div', { class: 'stack' },
    h('section', { class: 'card' }, h('h2', {}, 'Novo cupom'),
      h('p', { class: 'muted' }, 'Cole o link da página do cupom, da campanha ou da loja: o bot troca pelo seu link de afiliado (Shopee e AliExpress pela API; Mercado Livre com o seu matt_word, ou mantém o seu meli.la). Cupons com repetição são repostados no horário de postagem até a validade.'),
      form),
    h('section', { class: 'card' }, h('h2', {}, 'Cupons cadastrados'), list)));
  await drawList();
}

// ---------- histórico ----------
async function renderHistory(container) {
  const { total, items } = await api('/api/history');
  const rows = items.map((item) => h('tr', {},
    h('td', {}, fmtDate(item.postedAt)),
    h('td', {}, item.platform),
    h('td', { class: 'title' }, item.title ? h('a', { href: item.affiliateUrl, target: '_blank', rel: 'noopener noreferrer' }, item.title) : h('a', { href: item.affiliateUrl, target: '_blank', rel: 'noopener noreferrer' }, item.affiliateUrl)),
    h('td', {}, h('button', { class: 'link-btn', onclick: async (event) => {
      await api('/api/history/delete', { platform: item.platform, id: item.id });
      event.currentTarget.closest('tr').remove();
      toast('Produto liberado para postar de novo.');
    } }, 'liberar'))));
  container.replaceChildren(h('section', { class: 'card' },
    h('h2', {}, `${total} oferta(s) postada(s)`), h('p', { class: 'muted' }, 'Mostrando as 100 mais recentes.'),
    items.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Quando'), h('th', {}, 'Loja'), h('th', {}, 'Produto'), h('th', {}, ''))), h('tbody', {}, rows)))
      : h('p', { class: 'muted' }, 'Nada postado ainda.')));
}

// ---------- logs ----------
function renderLogs(container) {
  const box = h('div', { class: 'logs' });
  const draw = async () => {
    const { items } = await api('/api/logs');
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
    box.replaceChildren(...items.map((entry) => h('div', { class: entry.level },
      h('time', {}, new Date(entry.at).toLocaleTimeString('pt-BR')), ' ', entry.text)));
    if (atBottom) box.scrollTop = box.scrollHeight;
  };
  container.replaceChildren(h('section', { class: 'card' }, box));
  draw().then(() => { box.scrollTop = box.scrollHeight; });
  refreshTimer = setInterval(() => draw().catch(() => {}), 5000);
}

// ---------- senha ----------
function passwordCard() {
  if (state.passwordFromEnv) {
    return h('section', { class: 'card' }, h('h2', {}, 'Senha do painel'), h('p', { class: 'muted' }, 'Definida pela variável PAINEL_SENHA do Docker. Para trocar, altere o docker-compose e reinicie.'));
  }
  const form = h('form', { class: 'fields' },
    h('div', { class: 'fields-grid' },
      h('label', {}, 'Senha atual', h('input', { name: 'current', type: 'password', autocomplete: 'current-password', required: true })),
      h('label', {}, 'Nova senha (mín. 8)', h('input', { name: 'next', type: 'password', autocomplete: 'new-password', minlength: '8', required: true }))),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Trocar senha')));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/password', { current: form.current.value, next: form.next.value });
      form.reset();
      toast('Senha alterada.');
    } catch (error) { toast(error.message, 'error'); }
  });
  return h('section', { class: 'card' }, h('h2', {}, 'Senha do painel'), form);
}

boot().catch((error) => toast(error.message, 'error'));
