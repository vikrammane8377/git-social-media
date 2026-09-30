import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getAccessToken } from "./oauth.js";

/** Higgsfield's hosted MCP endpoint (from its protected-resource metadata). */
export const HIGGSFIELD_MCP_URL = "https://mcp.higgsfield.ai/mcp";

/**
 * Connect an MCP client to Higgsfield's hosted server, authenticated with a
 * bearer access token we obtained via the device-code flow. We manage the token
 * ourselves (refreshing silently) and pass it as an Authorization header, so we
 * do not use the SDK's interactive redirect-based auth provider.
 */
export async function connect(): Promise<{
  client: Client;
  transport: StreamableHTTPClientTransport;
}> {
  const accessToken = await getAccessToken();
  const transport = new StreamableHTTPClientTransport(new URL(HIGGSFIELD_MCP_URL), {
    requestInit: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
  const client = new Client(
    { name: "bix-social-console", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return { client, transport };
}

/** Connect, list the server's tools, and disconnect. */
export async function listTools(): Promise<unknown> {
  const { client, transport } = await connect();
  try {
    return await client.listTools();
  } finally {
    await transport.close();
  }
}

/** Connect, call one tool by name with arguments, and disconnect. */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { client, transport } = await connect();
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await transport.close();
  }
}
