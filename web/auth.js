import crypto from 'node:crypto';

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Senha do painel: PAINEL_SENHA (variável do Docker) tem prioridade; senão, a senha criada
 * no primeiro acesso, guardada como hash scrypt no SQLite. Sessões ficam em memória.
 */
export function createAuth(store, env = process.env) {
  // Sessões sobrevivem a reinícios: o banco guarda só o SHA-256 do token e a validade.
  const digest = (token) => crypto.createHash('sha256').update(token).digest('hex');
  const loadSessions = () => { try { return new Map(Object.entries(JSON.parse(store.getSetting('panel_sessions') || '{}'))); } catch { return new Map(); } };
  const stored = loadSessions();
  const persist = () => {
    for (const [key, expires] of stored) if (expires < Date.now()) stored.delete(key);
    store.setSetting('panel_sessions', JSON.stringify(Object.fromEntries(stored)));
  };
  const sessions = {
    get: (token) => stored.get(digest(token)),
    set: (token, expires) => { stored.set(digest(token), expires); persist(); },
    delete: (token) => { stored.delete(digest(token)); persist(); },
    clear: () => { stored.clear(); persist(); }
  };
  const failures = new Map();

  const passwordFromEnv = () => Boolean(env.PAINEL_SENHA);
  const hasPassword = () => passwordFromEnv() || Boolean(store.getSetting('panel_password_hash'));

  function verify(password) {
    if (typeof password !== 'string' || !password) return false;
    if (passwordFromEnv()) return safeEqual(password, env.PAINEL_SENHA);
    const stored = store.getSetting('panel_password_hash');
    if (!stored) return false;
    const [salt] = stored.split(':');
    return safeEqual(hashPassword(password, salt), stored);
  }

  function setPassword(password) {
    if (passwordFromEnv()) throw new Error('A senha está definida pela variável PAINEL_SENHA; troque-a no Docker.');
    if (typeof password !== 'string' || password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
    store.setSetting('panel_password_hash', hashPassword(password));
    sessions.clear();
  }

  function checkRateLimit(ip) {
    const entry = failures.get(ip);
    if (entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILURES) {
      throw new Error('Muitas tentativas. Aguarde 15 minutos.');
    }
  }

  function recordFailure(ip) {
    const entry = failures.get(ip);
    if (!entry || entry.resetAt < Date.now()) failures.set(ip, { count: 1, resetAt: Date.now() + FAILURE_WINDOW_MS });
    else entry.count += 1;
  }

  function login(password, ip) {
    checkRateLimit(ip);
    if (!verify(password)) {
      recordFailure(ip);
      throw new Error('Senha incorreta.');
    }
    failures.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_MS);
    return token;
  }

  function isValid(token) {
    const expires = token && sessions.get(token);
    if (!expires) return false;
    if (expires < Date.now()) { sessions.delete(token); return false; }
    return true;
  }

  return { hasPassword, passwordFromEnv, verify, setPassword, login, isValid, logout: (token) => sessions.delete(token) };
}
