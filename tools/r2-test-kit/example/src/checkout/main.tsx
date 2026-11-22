import { createRoot } from "react-dom/client";
import { Checkout } from "./Checkout.tsx";

const amount = Number(new URLSearchParams(location.search).get("total") ?? 0);
createRoot(document.getElementById("root")!).render(<Checkout amount={amount} />);
