// Bolts this page's content to the shared exchange runtime (kept out of index.html: Oxlint does not read HTML).
import { mount } from "@viz/kit/exchange.js";
import content from "./content.js";

mount(content);
