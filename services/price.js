export function formatPrice(value, currency = 'BRL') {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Preço indisponível';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(number);
}
