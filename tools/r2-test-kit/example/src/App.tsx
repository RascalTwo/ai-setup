import { useState } from "react";
import { type Item, total } from "./cart.ts";

const SHOP: Item[] = [
  { name: "mug", price: 12 },
  { name: "lamp", price: 40 },
];

export function App() {
  const [items, setItems] = useState<Item[]>([]);
  const amount = total(items);
  return (
    <main>
      <h1>Cart</h1>
      {SHOP.map((item) => (
        <button key={item.name} type="button" onClick={() => setItems([...items, item])}>
          Add {item.name}
        </button>
      ))}
      <p>Total: {amount}</p>
      {amount > 50 && <p>Free shipping</p>}
      <a href={`/checkout.html?total=${amount}`}>Check out</a>
    </main>
  );
}
