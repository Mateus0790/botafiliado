import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { resolveProduct } from '../services/index.js';
import { productMessage } from '../utils/embed.js';

export const data = new SlashCommandBuilder().setName('afiliado').setDescription('Gera um link de afiliado para um produto.')
  .addStringOption((option) => option.setName('link').setDescription('URL do produto').setRequired(true));

export async function execute(interaction, { cache }) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const product = await resolveProduct(interaction.options.getString('link', true), { store: cache });
  await interaction.editReply(productMessage(product, { content: `Link de afiliado gerado: ${product.affiliateUrl}` }));
}
