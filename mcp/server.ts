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
        issuer: z
          .string()
          .optional()
          .describe("核准此匣的 principal id（人／法院／機構）。省略則用委託人 id，不得硬編姓名。"),
      },
    },
    async ({ utterance, issuer }) =>
      runTool("plan_applications", { utterance, issuer }),
  );

  server.registerTool(
    "approve_grant",
    {
      title: "核准授權匣",
      description:
        "委託人核准一張最小欄位授權匣。授權層會把白名單欄位寫入機關收件匣；回傳只含欄位 ID，不含金庫值。",
      inputSchema: {
        grantId: z.string().describe("匣編號：G-甲 / G-jia 或 G-乙 / G-yi"),
        issuer: z
          .string()
          .optional()
          .describe("實際核准的 principal id。執法故事可換成法院／搜索票，不是機關。"),
      },
    },
    async ({ grantId, issuer }) => runTool("approve_grant", { grantId, issuer }),
  );

  server.registerTool(
    "fetch_field",
    {
      title: "依匣擷取欄位",
      description:
        "用授權匣向假 MyData 擷取。actor 必須等於 grant.audience，否則 403 + 稽核。越權（例如機關乙要戶籍）fail closed。成功時欄位值只進機關收件匣，不回傳給模型。",
      inputSchema: {
        grantId: z.string().describe("匣編號：G-甲 / G-jia 或 G-乙 / G-yi"),
        fields: z
          .array(z.string())
          .optional()
          .describe("要擷取的欄位 ID。省略時預設戶籍欄位（乙匣會 403）。"),
        actor: z
          .string()
          .optional()
          .describe("呼叫端 id，必須等於該匣 audience（甲=agency-jia，乙=agency-yi）。省略或錯誤 → 403 + 稽核。不得自填 audience。"),
      },
    },
    async ({ grantId, fields, actor }) =>
      runTool("fetch_field", { grantId, fields, actor }),
  );

  server.registerTool(
    "submit_application",
    {
      title: "送出申請",
      description:
        "用有效匣送件。actor 必須等於 grant.audience，否則 403 + 稽核。送件後匣立即耗用；之後 fetch_field 重放會 403。",
      inputSchema: {
        grantId: z.string().describe("匣編號：G-甲 / G-jia 或 G-乙 / G-yi"),
        actor: z
          .string()
          .optional()
          .describe("呼叫端 id，必須等於該匣 audience。省略或錯誤 → 403 + 稽核。"),
      },
    },
    async ({ grantId, actor }) => runTool("submit_application", { grantId, actor }),
  );

  server.registerTool(
    "revoke_grant",
    {
      title: "撤銷授權匣",
      description: "委託人撤銷尚未耗用的匣。已耗用的匣不能再撤銷。",
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
        "回傳核准／擷取／送件／撤銷／拒絕時間線，並證明所得從未進入任何授權匣。不含金庫值。",
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
