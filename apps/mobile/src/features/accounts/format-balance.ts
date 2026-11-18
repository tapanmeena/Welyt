export function displayBalance(currencyCode: string, balance: string): string {
  const grouping = currencyCode === 'INR' ? /\B(?=(?:\d{2})*\d{3}\.)/g : /\B(?=(?:\d{3})+\.)/g;
  return `${currencyCode} ${balance.replace(grouping, ',')}`;
}
