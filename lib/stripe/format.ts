export function formatStripeAmount(amount: number, currency: string): string {
  const normalizedCurrency = currency.toUpperCase();
  const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency: normalizedCurrency });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amount / (10 ** fractionDigits));
}
