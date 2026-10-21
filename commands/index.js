import { REST, Routes } from 'discord.js';
import * as afiliado from './afiliado.js';
import * as postar from './postar.js';
import * as definirMl from './definir-afiliado-ml.js';
import * as auto from './auto.js';

export const COMMANDS = [afiliado, postar, definirMl, auto];

/** Registra os comandos de barra no servidor (DISCORD_GUILD_ID) ou globalmente. */
export async function registerCommands(env = process.env) {
  const { DISCORD_TOKEN: token, DISCORD_CLIENT_ID: clientId, DISCORD_GUILD_ID: guildId } = env;
  if (!token || !clientId) throw new Error('Token do bot e Application ID do Discord são obrigatórios para registrar os comandos.');
  const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  await new REST({ version: '10' }).setToken(token).put(route, { body: COMMANDS.map((command) => command.data.toJSON()) });
  return guildId ? 'no servidor' : 'globalmente (pode levar até 1 h para aparecer)';
}
