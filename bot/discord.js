import { Client, Collection, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { COMMANDS } from '../commands/index.js';

/**
 * Mantém o cliente do Discord. Sem token o bot fica parado (o painel continua no ar);
 * restart() reconecta depois que o token é trocado no painel.
 */
export function createDiscordBot({ store, getAutopost, logger = console }) {
  let client = null;
  let status = { state: 'parado', detail: 'Token do Discord não configurado.' };
  const commands = new Collection(COMMANDS.map((command) => [command.data.name, command]));

  async function start() {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      status = { state: 'parado', detail: 'Token do Discord não configurado.' };
      return;
    }
    const current = new Client({ intents: [GatewayIntentBits.Guilds] });
    client = current;
    status = { state: 'conectando', detail: 'Conectando ao Discord…' };
    current.once(Events.ClientReady, (ready) => {
      status = { state: 'online', detail: `Conectado como ${ready.user.tag}`, tag: ready.user.tag };
      logger.log(`Conectado como ${ready.user.tag}.`);
    });
    current.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      const command = commands.get(interaction.commandName);
      if (!command) return;
      try { await command.execute(interaction, { cache: store, autopost: getAutopost() }); }
      catch (error) {
        logger.error(`Falha em /${interaction.commandName}: ${error.message}`);
        const message = `❌ ${error.message || 'Erro inesperado ao processar o produto.'}`;
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message, embeds: [], components: [] }).catch(() => {});
        else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    });
    current.on(Events.Error, (error) => logger.error(`Discord: ${error.message}`));
    try {
      await current.login(token);
    } catch (error) {
      if (client === current) client = null;
      status = { state: 'erro', detail: error.code === 'TokenInvalid' ? 'Token do Discord inválido.' : `Falha ao conectar: ${error.message}` };
      logger.error(`Discord: ${status.detail}`);
      await Promise.resolve(current.destroy()).catch(() => {});
    }
  }

  async function stop() {
    const current = client;
    client = null;
    if (current) await current.destroy();
    status = { state: 'parado', detail: 'Desconectado.' };
  }

  return {
    start,
    stop,
    restart: async () => { await stop(); await start(); },
    getClient: () => (client?.isReady() ? client : null),
    status: () => status
  };
}
