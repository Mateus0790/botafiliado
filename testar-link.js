import 'dotenv/config';
import { resolveProduct } from './services/index.js';
import { createCache } from './utils/cache.js';
import { applyStoredConfig } from './utils/config.js';

// Uso: npm run testar -- <url do produto>
const url = process.argv[2];
if (!url) throw new Error('Informe a URL do produto: npm run testar -- <url>');
const cache = createCache();
applyStoredConfig(cache);
try {
  console.log(await resolveProduct(url, { store: cache }));
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
} finally {
  cache.close();
}
