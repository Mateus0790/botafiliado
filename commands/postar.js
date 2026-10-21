import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { resolveProduct } from '../services/index.js';
import { publishOffer } from '../publishers/index.js';

export const data = new SlashCommandBuilder().setName('postar').setDescription('Publica uma oferta no canal configurado.')
  .addStringOption((option) => option.setName('link').setDescription('URL do produto').setRequired(true));

export async function execute(interaction, { cache }) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const product = await resolveProduct(interaction.options.getString('link', true), { store: cache });
  if (cache.wasPosted(product.platform, product.id)) throw new Error('Este produto já foi postado e foi bloqueado pelo anti-duplicidade.');
  const channelId = process.env.CANAL_POSTAGEM_ID;
  const { sent, errors } = await publishOffer(product, { client: interaction.client, discordChannelId: channelId, store: cache });
  cache.markPosted(product, channelId || 'telegram');
  const where = sent.map((name) => (name === 'Discord' ? `<#${channelId}>` : name)).join(' e ');
  await interaction.editReply(`Oferta publicada em ${where}.${errors.length ? `\n⚠️ ${errors.join('\n⚠️ ')}` : ''}`);
}
