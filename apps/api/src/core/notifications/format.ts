export function formatToman(amount: bigint): string {
  return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
