import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createCache } from './utils/cache.js';
import { FIELDS, applyStoredConfig } from './utils/config.js';

// Uso: node exportar-config.js
// Junta a configuração deste PC (.env + o que foi salvo no painel) num arquivo .env para o Docker.
// O arquivo contém tokens e segredos: copie direto para o mini PC e apague daqui depois.
const OUTPUT = 'config-exportada.env';
// Só faz sentido neste PC (janela fora da tela) ou é definido pelo próprio Docker.
const SKIP = new Set(['ML_BROWSER_OFFSCREEN', 'TZ']);

const cache = createCache();
applyStoredConfig(cache);
cache.close();

// Aspas simples são lidas ao pé da letra pelo dotenv e pelo Docker Compose.
const quote = (value) => {
  if (!/[\s#"'$`\\]/.test(value)) return value;
  if (value.includes("'")) throw new Error(`Valor com aspas simples não pode ser exportado com segurança: ajuste no painel antes (${value.slice(0, 20)}…).`);
  return `'${value}'`;
};
const lines = ['# Gerado por exportar-config.js. Contém segredos: não compartilhe nem envie ao Git.'];
let count = 0;
for (const { key } of FIELDS) {
  const value = process.env[key];
  if (SKIP.has(key) || value === undefined || value === '') continue;
  lines.push(`${key}=${quote(value)}`);
  count += 1;
}
if (process.env.ML_LINK_MODE === 'linkbuilder') {
  console.log('ℹ️ Modo meli.la: o login do Mercado Livre não vai junto (o perfil do navegador deste PC não funciona no Docker).');
  console.log('   No painel do Docker: Lojas e APIs → Mercado Livre → "Fazer login do Mercado Livre".');
}
writeFileSync(OUTPUT, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`✅ ${count} configurações exportadas para ${OUTPUT}.`);
console.log('   No mini PC: copie para a pasta do bot como ".env" e rode "docker compose up -d --build".');
console.log('   A senha do painel e o histórico não vão junto (o Docker cria a senha no primeiro acesso).');
console.log('   ⚠️ O arquivo tem tokens e segredos: apague-o deste PC depois de copiar.');
