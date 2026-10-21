import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { findBrowser, profileDir, LINKBUILDER_URL } from './services/mlBrowser.js';

// Uso: node ml-login.js
// Abre o Chrome/Edge comum (sem automação) com o perfil do bot, separado do seu navegador.
// Faça login no Mercado Livre, confira que o Linkbuilder abre logado e FECHE a janela.
const browser = findBrowser();
const profile = profileDir();
mkdirSync(profile, { recursive: true });
console.log(`\nAbrindo ${browser.split(/[\\/]/).pop()} com o perfil do bot (${profile}).`);
console.log('1. Faça login no Mercado Livre (senha, código etc.).');
console.log('2. Confira que o Gerador de links (Linkbuilder) aparece logado.');
console.log('3. FECHE o navegador para terminar.\n');
const child = spawn(browser, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', LINKBUILDER_URL], { stdio: 'ignore' });
child.on('exit', () => console.log('✅ Perfil salvo. O bot usa essa sessão para gerar os links meli.la.'));
