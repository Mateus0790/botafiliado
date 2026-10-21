import 'dotenv/config';
import { createCache } from './utils/cache.js';
import { applyStoredConfig } from './utils/config.js';
import { registerCommands } from './commands/index.js';

// Usa também o que foi salvo pelo painel.
const cache = createCache();
applyStoredConfig(cache);
cache.close();
console.log(`Comandos registrados ${await registerCommands()}.`);
