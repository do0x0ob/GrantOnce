import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { callTool, type ToolName } from "./tools";

const HTTP_PORT = Number(process.env.GRANTONCE_MCP_PORT ?? 43128);
const HTTP_HOST = process.env.GRANTONCE_MCP_HOST ?? "127.0.0.1";

function jsonResult(data: unknown, isError: boolean) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
    isError,
  };
}

function runTool(name: ToolName, args: Record<string, unknown>) {
  try {
    const { data, isError } = callTool(name, args);
    return jsonResult(data, isError);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResult({ ok: false, error: message }, true);
  }
}

/** Official MCP server. Tool payloads never include vault values. */
export function createGrantOnceServer(): McpServer {
  const server = new McpServer({
    name: "grantonce",
    version: "0.1.0",
  });

  server.registerTool(
    "plan_applications",
    {
      title: "規劃申請",
      description:
        "用規則引擎比對委託人原話，提出分匣申請（G-甲 育兒津貼、G-乙 冷氣補助）。不讀金庫，不授權欄位值。",
      inputSchema: {
        utterance: z
          .string()
          .describe("委託人原話。快樂路徑：我剛搬家，看我能申請什麼。"),
      },
    },
    async ({ utterance }) => runTool("plan_applications", { utterance }),
  );

  server.registerTool(
    "approve_grant",
    {
      title: "核准授權匣",
      description:
        "委託人核准一張最小欄位授權匣。runtime 發出 HMAC ticket（綁 issuer、audience、fields、exp）。回傳 ticket 與欄位 ID，不含金庫值。",
      inputSchema: {
        grantId: z.string().describe("匣編號：G-甲 / G-jia 或 G-乙 / G-yi"),
      },
    },
    async ({ grantId }) => runTool("approve_grant", { grantId }),
  );

  server.registerTool(
    "fetch_field",
    {
      title: "依 ticket 擷取欄位",
      description:
        "只用 HMAC ticket 向假 MyData 擷取。沒有 actor。匣號 G-jia／G-yi 不是憑證。越權 fail closed。成功時欄位值只進機關收件匣，不回傳給模型。",
      inputSchema: {
        ticket: z
          .string()
          .optional()
          .describe("approve_grant 回傳的 HMAC ticket（ticket id 或 grn_….<mac>）。匣號無效。"),
        fields: z
          .array(z.string())
          .optional()
          .describe("要擷取的欄位 ID。省略時預設戶籍欄位（乙匣 ticket 會 403）。"),
      },
    },
    async ({ ticket, fields }) => runTool("fetch_field", { ticket, fields }),
  );

  server.registerTool(
    "submit_application",
    {
      title: "送出申請",
      description:
        "用 HMAC ticket 送件。沒有 actor。送件後匣耗用、ticket 失效、收件匣改收據；重放 fetch_field 會 403。",
      inputSchema: {
        ticket: z
          .string()
          .optional()
          .describe("approve_grant 回傳的 HMAC ticket（ticket id 或 grn_….<mac>）。匣號無效。"),
      },
    },
    async ({ ticket }) => runTool("submit_application", { ticket }),
  );

  server.registerTool(
    "revoke_grant",
    {
      title: "撤銷授權匣",
      description:
        "撤銷尚未耗用的匣。issuer 固定為 runtime session principal，工具不能自報身分。",
      inputSchema: {
        grantId: z.string().describe("匣編號：G-甲 / G-jia 或 G-乙 / G-yi"),
        reason: z.string().optional().describe("撤銷原因"),
      },
    },
    async ({ grantId, reason }) => runTool("revoke_grant", { grantId, reason }),
  );

  server.registerTool(
    "get_audit",
    {
      title: "讀取稽核",
      description:
        "回傳核准／擷取／送件／收據／撤銷／拒絕時間線，並證明所得從未進入任何授權匣。送件後收件匣只留雜湊。不含金庫值。",
      inputSchema: {},
    },
    async () => runTool("get_audit", {}),
  );

  return server;
}

function allowedHost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? "").split(":")[0]?.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === HTTP_HOST;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw);
}

async function startStdio() {
  const server = createGrantOnceServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp() {
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (!allowedHost(req)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "forbidden host" }));
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, transport: "streamable-http" }));
      return;
    }

    if (req.url !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    const mcp = createGrantOnceServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      const body =
        req.method === "POST" ? await readJsonBody(req) : undefined;
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      console.error("MCP HTTP error", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }),
        );
      }
    } finally {
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(HTTP_PORT, HTTP_HOST, () => resolve());
    httpServer.on("error", reject);
  });

  console.error(
    `GrantOnce MCP HTTP listening on http://${HTTP_HOST}:${HTTP_PORT}/mcp`,
  );
}

async function main() {
  const http = process.argv.includes("--http");
  if (http) {
    await startHttp();
    return;
  }
  await startStdio();
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return entry.includes("mcp/server");
  }
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
