export type Item = { name: string; price: number };

export const TAX = 0.1;
export const FREE_SHIPPING_OVER = 50;

/** The cart total with tax, rounded to cents. */
export function total(items: Item[]): number {
  const sum = items.reduce((s, i) => s + i.price, 0);
  return Math.round(sum * (1 + TAX) * 100) / 100;
}

export const freeShipping = (amount: number): boolean => amount > FREE_SHIPPING_OVER;

/** Called by no test on purpose: per-test coverage must credit it to nobody. */
export function formatReceipt(items: Item[]): string {
  return items.map((i) => `${i.name}: ${i.price}`).join("\n");
}
