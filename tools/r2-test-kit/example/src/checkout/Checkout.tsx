import { freeShipping } from "../cart.ts";

/** Reached only by the browser journey: its coverage comes from the page's counters alone. */
export function Checkout({ amount }: { amount: number }) {
  return (
    <main>
      <h1>Checkout</h1>
      <p>You pay {amount}</p>
      <p>{freeShipping(amount) ? "Shipping is free" : "Shipping costs 5"}</p>
    </main>
  );
}
