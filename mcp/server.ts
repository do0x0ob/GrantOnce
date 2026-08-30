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
    "search_purposes",
    {
      title: "搜尋目的目錄",
      description:
        "搜本部署登記過的目的目錄（育兒、冷氣、水災救助等）。不是外網搜尋。回傳 issuable；false 表示只能說明、不能 mint Grant、不能發明述詞。不讀金庫。",
      inputSchema: {
        query: z.string().describe("自然語言或關鍵字。空字串回傳全部登記項。"),
      },
    },
    async ({ query }) => runTool("search_purposes", { query }),
  );

  server.registerTool(
    "plan_applications",
    {
      title: "規劃申請",
      description:
        "用規則引擎比對委託人原話。只有目錄命中且資格成立才提案（G-甲 育兒津貼、G-乙 冷氣補助）。水災等參考項只回目錄、不發票。不讀金庫，也不能簽署。",
      inputSchema: {
        utterance: z
          .string()
          .describe("委託人原話。快樂路徑：我剛搬家，看我能申請什麼。水災只會搜到參考項。"),
      },
    },
    async ({ utterance }) => runTool("plan_applications", { utterance }),
  );

  server.registerTool(
    "get_grant_for_signature",
    {
      title: "取得待簽內容",
      description:
        "回傳一張匣的同意畫面文字與待簽 bytes。模型不能代簽——私鑰只存在委託人的認證器後面，簽署必須由委託人以生物辨識完成。",
      inputSchema: {
        grantId: z.string().describe("匣編號：G-甲 / G-jia 或 G-乙 / G-yi"),
      },
    },
    async ({ grantId }) => runTool("get_grant_for_signature", { grantId }),
  );

  server.registerTool(
    "redeem_grant",
    {
      title: "兌現授權匣",
      description:
        "機關以自己的金鑰兌現一張已簽署的匣。兩把鑰匙都要通過：委託人簽章，以及機關持有證明＋法定職務範圍。述詞值只進機關收件匣，不回傳給模型。",
      inputSchema: {
        grantId: z.string().describe("匣編號：G-甲 / G-jia 或 G-乙 / G-yi"),
        agency: z.string().describe("兌現的機關：jia / yi"),
      },
    },
    async ({ grantId, agency }) => runTool("redeem_grant", { grantId, agency }),
  );

  server.registerTool(
    "request_claims",
    {
      title: "機關索取述詞",
      description:
        "機關主動索取一組述詞。逾越該目的法定職務範圍、或涉及特種個資，在提案階段就攔截，委託人不會看到同意按鈕。",
      inputSchema: {
        agency: z.string().describe("jia / yi"),
        purpose: z.string().describe("childcare-allowance / aircon-subsidy"),
        claims: z.array(z.string()).describe("述詞 ID 清單"),
      },
    },
    async ({ agency, purpose, claims }) =>
      runTool("request_claims", { agency, purpose, claims }),
  );

  server.registerTool(
    "submit_application",
    {
      title: "送出申請",
      description: "以已兌現的述詞送件。",
      inputSchema: {
        grantId: z.string().describe("匣編號：G-甲 / G-jia 或 G-乙 / G-yi"),
      },
    },
    async ({ grantId }) => runTool("submit_application", { grantId }),
  );

  server.registerTool(
    "revoke_grant",
    {
      title: "撤銷授權匣",
      description: "撤銷尚未兌現的匣。已兌現的匣無法撤銷交付出去的資料。",
      inputSchema: {
        grantId: z.string().describe("匣編號：G-甲 / G-jia 或 G-乙 / G-yi"),
        reason: z.string().optional().describe("撤銷原因"),
      },
    },
    async ({ grantId, reason }) => runTool("revoke_grant", { grantId, reason }),
  );

  server.registerTool(
    "stop_delegation",
    {
      title: "停止委託",
      description:
        "委託人停止整個委託。未兌現的匣全部作廢，之後任何兌現都會被擋。這是唯一一定有效的撤銷。",
      inputSchema: {
        reason: z.string().optional().describe("停止原因"),
      },
    },
    async ({ reason }) => runTool("stop_delegation", { reason }),
  );

  server.registerTool(
    "get_audit",
    {
      title: "讀取稽核",
      description:
        "回傳設定／發證／簽署／兌現／送件／撤銷／拒絕／推送的時間線，以及從未被使用過的金庫欄位。不含金庫值，也不含述詞的值。",
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
