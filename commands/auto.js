import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { autoConfig } from '../jobs/autopost.js';
import { telegramConfigured } from '../publishers/telegram.js';
import { setConfig } from '../utils/config.js';
import { storesStatus } from '../services/stores.js';
import { NICHOS } from '../services/nichos.js';

export const data = new SlashCommandBuilder().setName('auto').setDescription('Controla a postagem automática de ofertas.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName('status').setDescription('Mostra a configuração atual.'))
  .addSubcommand((sub) => sub.setName('ligar').setDescription('Liga a postagem automática.'))
  .addSubcommand((sub) => sub.setName('desligar').setDescription('Desliga a postagem automática.'))
  .addSubcommand((sub) => sub.setName('agora').setDescription('Faz uma rodada agora (ignora o horário).'))
  .addSubcommand((sub) => sub.setName('palavras').setDescription('Define as palavras-chave buscadas, em rodízio.')
    .addStringOption((option) => option.setName('lista').setDescription('Separadas por vírgula. Ex.: fone bluetooth, smartwatch, air fryer').setRequired(true)))
  .addSubcommand((sub) => sub.setName('intervalo').setDescription('Define o intervalo entre rodadas.')
    .addIntegerOption((option) => option.setName('minutos').setDescription('Mínimo 5').setMinValue(5).setRequired(true)));

function statusText(config) {
  const sortName = { relevancia: 'relevância', 'mais-vendidos': 'mais vendidos', 'maior-preco': 'maior preço', 'menor-preco': 'menor preço', 'maior-comissao': 'maior comissão' }[config.sort];
  const stores = storesStatus().map((store) => `${store.label} ${!store.enabled ? '⚪ desativada' : !store.configured ? '🟡 sem credenciais' : store.inAuto ? '🟢 automática' : '🔵 só manual'}`);
  return [
    `**Postagem automática:** ${config.enabled ? '🟢 ligada' : '🔴 desligada'}`,
    `**Lojas:** ${stores.join(' · ')}`,
    `**Nichos:** ${config.nichos.length ? config.nichos.map((id) => NICHOS[id]?.nome ?? id).join(', ') : '_nenhum_'}`,
    `**Palavras-chave extras:** ${config.keywords.length ? config.keywords.join(', ') : '_nenhuma_'}`,
    `**Intervalo:** a cada ${config.intervalMin} min · ${config.postsPerRun} oferta(s) por rodada`,
    `**Horário:** ${config.startHour}h às ${config.endHour}h`,
    `**Discord:** ${config.channelId ? `<#${config.channelId}>` : '_não configurado_'} · **Telegram:** ${telegramConfigured() ? `\`${process.env.TELEGRAM_CHAT_ID}\`` : '_não configurado_'}`,
    `**Filtros:** nota ≥ ${config.minRating}, vendas ≥ ${config.minSales}, comissão ≥ ${(config.minCommission * 100).toFixed(0)}%`
      + `${config.minDiscount ? `, desconto ≥ ${config.minDiscount}%` : ''}${config.minPrice ? `, preço ≥ R$ ${config.minPrice}` : ''}`
      + `${Number.isFinite(config.maxPrice) ? `, preço ≤ R$ ${config.maxPrice}` : ''}${config.blockedWords.length ? `, sem: ${config.blockedWords.join(', ')}` : ''} · ordem: ${sortName}`,
    `**Repetição:** ${config.repeatDays ? `mesmo produto de novo após ${config.repeatDays} dia(s)` : 'nunca reposta o mesmo produto'}`
  ].join('\n');
}

export async function execute(interaction, { cache, autopost }) {
  const sub = interaction.options.getSubcommand();
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  if (sub === 'ligar' || sub === 'desligar') {
    setConfig(cache, { AUTO_ENABLED: sub === 'ligar' ? 'true' : 'false' });
    return reply(statusText(autoConfig()));
  }
  if (sub === 'palavras') {
    const list = interaction.options.getString('lista', true).split(',').map((word) => word.trim()).filter(Boolean);
    if (!list.length) throw new Error('Informe ao menos uma palavra-chave.');
    setConfig(cache, { AUTO_KEYWORDS: list.join(',') });
    cache.setSetting('auto_keyword_index', '0');
    return reply(statusText(autoConfig()));
  }
  if (sub === 'intervalo') {
    setConfig(cache, { AUTO_INTERVAL_MIN: String(interaction.options.getInteger('minutos', true)) });
    autopost.reschedule();
    return reply(statusText(autoConfig()));
  }
  if (sub === 'agora') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await autopost.runNow();
    return interaction.editReply(result.posted.length
      ? `✅ Postei ${result.posted.length} oferta(s) de "${result.keyword}" (${result.store}) em ${result.sentTo.join(' e ')}: ${result.posted.map((product) => product.title.slice(0, 60)).join(' · ')}${result.errors.length ? `\n⚠️ ${result.errors.join('\n⚠️ ')}` : ''}`
      : `ℹ️ ${result.reason}`);
  }
  return reply(statusText(autoConfig()));
}
