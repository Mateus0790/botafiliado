import 'dotenv/config';
import { checkTelegram, telegramConfigured } from './publishers/telegram.js';

// Uso: node testar-telegram.js — confere token e acesso ao canal sem postar nada.
if (!telegramConfigured()) {
  console.error('❌ Preencha TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env.');
  process.exit(1);
}
try {
  const result = await checkTelegram();
  console.log(`Bot: ${result.bot}\nChat: ${result.chat} (${result.chatType})\nPapel do bot: ${result.status}`);
  console.log(result.canPost ? '✅ O bot pode postar nesse chat.' : '❌ O bot não pode postar: adicione-o como administrador com permissão de publicar mensagens.');
  if (!result.canPost) process.exitCode = 1;
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
}
