import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { startLogin, load, listTools, callTool, NeedsLoginError } from "@bix/higgsfield";

function printUsage(): void {
  console.log("Usage: bix higgsfield <subcommand>");
  console.log("");
  console.log("Subcommands:");
  console.log("  login              Sign in to Higgsfield (opens the browser to approve)");
  console.log("  status             Show whether we hold a token and when it expires");
  console.log("  tools              Connect to the MCP server and list its tools (schema)");
  console.log("  call <name> <json> Call one MCP tool by name with a JSON arguments object");
}

async function runLogin(): Promise<number> {
  const handle = await startLogin();
  console.log("");
  console.log("Opening your browser to sign in to Higgsfield. If it doesn't open,");
  console.log("paste this URL manually:");
  console.log("");
  console.log(`  ${handle.authUrl}`);
  console.log("");
  console.log("Waiting for approval...");

  // Best-effort: open the default browser (macOS `open`).
  spawn("open", [handle.authUrl], { stdio: "ignore", detached: true }).unref();

  const tokens = await handle.waitForTokens();
  const mins = Math.round((tokens.expiresAt - Date.now()) / 60000);
  console.log("");
  console.log("Signed in.");
  console.log(`Access token expires in ~${mins} min.`);
  console.log(`Refresh token: ${tokens.refreshToken ? "received (silent refresh enabled)" : "NOT received"}`);
  console.log(`Scope: ${tokens.scope ?? "(not reported)"}`);
  return 0;
}

async function runStatus(): Promise<number> {
  const tokens = await load();
  if (!tokens) {
    console.log("Not signed in. Run: npm run higgsfield -- login");
    return 0;
  }
  const mins = Math.round((tokens.expiresAt - Date.now()) / 60000);
  console.log(`Signed in (client ${tokens.clientId.slice(0, 12)}...).`);
  console.log(`Access token ${mins > 0 ? `valid for ~${mins} min` : "expired"}.`);
  console.log(`Refresh token: ${tokens.refreshToken ? "present" : "absent"}.`);
  console.log(`Scope: ${tokens.scope ?? "(not reported)"}`);
  return 0;
}

async function runTools(): Promise<number> {
  const tools = await listTools();
  console.log(JSON.stringify(tools, null, 2));
  return 0;
}

async function runCall(argv: string[]): Promise<number> {
  const name = argv[0];
  if (!name) {
    console.error("Usage: bix higgsfield call <toolName> <jsonArgs>");
    return 1;
  }
  const argSpec = argv[1] ?? "{}";
  // `@path` reads the JSON arguments from a file, avoiding shell-quoting issues.
  const rawArgs = argSpec.startsWith("@")
    ? readFileSync(argSpec.slice(1), "utf8")
    : argSpec;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs) as Record<string, unknown>;
  } catch (err) {
    console.error(`Invalid JSON arguments: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const result = await callTool(name, args);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

export async function runHiggsfield(argv: string[]): Promise<number> {
  const sub = argv[0];
  try {
    switch (sub) {
      case "login":
        return await runLogin();
      case "status":
        return await runStatus();
      case "tools":
        return await runTools();
      case "call":
        return await runCall(argv.slice(1));
      default:
        printUsage();
        return sub ? 1 : 0;
    }
  } catch (err) {
    if (err instanceof NeedsLoginError) {
      console.error(err.message);
      console.error("Run: npm run higgsfield -- login");
      return 1;
    }
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
