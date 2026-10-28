/**
 * Account mode for stdio clients: forwards tools/list and tools/call to the
 * hosted focal MCP endpoint with the user's session token, so local clients get
 * exactly the hosted tools (read and write, same save rules, attributed and
 * undoable) without OAuth support of their own.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export const DEFAULT_MCP_URL = "http://localhost:3000/mcp";

export async function runBridge(opts: { url: string; token: string }): Promise<void> {
  const remote = new Client({ name: "focal-stdio-bridge", version: "0.1.0" });
  await remote.connect(
    new StreamableHTTPClientTransport(new URL(opts.url), { requestInit: { headers: { Authorization: `Bearer ${opts.token}` } } }),
  );
  const server = new Server(
    { name: "focal", version: "0.1.0" },
    { capabilities: { tools: {} }, ...(remote.getInstructions() ? { instructions: remote.getInstructions() } : {}) },
  );
  server.setRequestHandler(ListToolsRequestSchema, (req) => remote.listTools(req.params));
  server.setRequestHandler(CallToolRequestSchema, (req) => remote.callTool(req.params));
  server.onclose = () => void remote.close();
  console.error(`[focal-mcp] account mode: forwarding to ${opts.url}`);
  await server.connect(new StdioServerTransport());
}
