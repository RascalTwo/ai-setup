// A downstream MCP server for host.test.ts: one tool with a ui:// view, one without.
import { Server } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

const VIEW = "ui://fixture/view.html";
const s = new Server({ name: "fixture", version: "0" }, { capabilities: { tools: {}, resources: {} } });
s.setRequestHandler("tools/list", () => ({
  tools: [
    { name: "hello", inputSchema: { type: "object" }, _meta: { ui: { resourceUri: VIEW } } },
    { name: "plain", inputSchema: { type: "object" } },
  ],
}));
s.setRequestHandler("tools/call", ({ params }) => ({ content: [{ type: "text", text: `${params.name}:${JSON.stringify(params.arguments)}` }] }));
s.setRequestHandler("resources/list", () => ({ resources: [{ uri: VIEW, name: "view" }] }));
s.setRequestHandler("resources/read", () => ({
  contents: [{ uri: VIEW, mimeType: "text/html;profile=mcp-app", text: "<p>fixture view</p>", _meta: { ui: { csp: { resourceDomains: ["https://cdn.example"] } } } }],
}));
await s.connect(new StdioServerTransport());
