export function invoiceTotal(items, discountCents = 0) {
  return Math.max(0, items.reduce((sum, item) => sum + item.priceCents * (item.qty ?? 1), 0) - discountCents);
}
