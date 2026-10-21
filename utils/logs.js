import { format } from 'node:util';

const MAX_ENTRIES = 300;
const entries = [];

/** Guarda as últimas linhas do console para o painel, sem deixar de imprimir no terminal/Docker. */
export function captureConsole(target = console) {
  for (const level of ['log', 'warn', 'error']) {
    const original = target[level].bind(target);
    target[level] = (...args) => {
      entries.push({ at: new Date().toISOString(), level, text: format(...args) });
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      original(...args);
    };
  }
}

export const recentLogs = (limit = 200) => entries.slice(-limit);
