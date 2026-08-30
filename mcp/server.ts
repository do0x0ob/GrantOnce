import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { runAgentTick, TICK_MS } from "../lib/agent";
import type { Notification } from "../lib/types";
import { callTool, getNotifications, type ToolName } from "./tools";

/** The agent's outbox, readable as a resource as well as through a tool. */
const NOTIFICATIONS_URI = "grantonce://notifications";

/** Which resources each server's client actually asked to hear about. */
const SUBSCRIPTIONS = new WeakMap<McpServer, Set<string>>();

const HTTP_PORT = Number(process.env.GRANTONCE_MCP_PORT ?? 43128);
const HTTP_HOST = process.env.GRANTONCE_MCP_HOST ?? "127.0.0.1";

function jsonResult(data: unknown, isError: boolean) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
    isError,
  };
}

async function runTool(name: ToolName, args: Record<string, unknown>) {
  try {
    const { data, isError } = await callTool(name, args);
    return jsonResult(data, isError);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResult({ ok: false, error: message }, true);
  }
}

/** Official MCP server. Tool payloads never include vault values. */
export function createGrantOnceServer(): McpServer {
  const server = new McpServer(
    {
      name: "grantonce",
      version: "0.1.0",
    },
    {
      // Declared so the watch loop has somewhere to push to. Polling
      // `get_notifications` is not proactive; this is the channel that lets a
      // client hear about a change it never asked for.
      capabilities: {
        logging: {},
        resources: { subscribe: true, listChanged: true },
      },
    },
  );

  // `McpServer` does not answer resources/subscribe on its own, and declaring a
  // capability we do not implement would be a lie told in the handshake.
  const subscribed = new Set<string>();
  SUBSCRIPTIONS.set(server, subscribed);
  server.server.setRequestHandler(SubscribeRequestSchema, (request) => {
    subscribed.add(request.params.uri);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, (request) => {
    subscribed.delete(request.params.uri);
    return {};
  });

  server.registerResource(
    "notifications",
    NOTIFICATIONS_URI,
    {
      title: "主動推播",
      description:
        "代理人巡檢後推出的通知。與 get_notifications 回傳同一份內容：只有摘要，不含金庫值，也不含述詞的值。",
      mimeType: "application/json",
    },
    async () => {
      const payload = getNotifications();
      return {
        contents: [
          {
            uri: NOTIFICATIONS_URI,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "search_purposes",
    {
      title: "搜尋補助（公開資料＋可發票子集）",
      description:
        "公開搜尋真實世界的補助／救助（維基、*.gov.tw 連結），並標出本 runtime 目前能 mint Grant 的子集。登記表不是全世界。宿主若已有網搜，仍應先搜；不要因為 issuable 只有幾筆就拒絕說明其他補助。issuable=false 不能 mint、不能發明述詞。不讀金庫。",
      inputSchema: {
        query: z.string().describe("自然語言。空字串只回可發票 profile，仍可再搜。"),
      },
    },
    async ({ query }) => runTool("search_purposes", { query }),
  );

  server.registerTool(
    "plan_applications",
    {
      title: "規劃申請",
      description:
        "搜尋已登記服務並用規則引擎比對，只回名單與理由。這一步不建立服務需求、也不建立 Grant——要向某個機關提出辦理申請請改用 request_service。搜尋結果不等於授權；不能發明述詞、不讀金庫、不能簽署。",
      inputSchema: {
        utterance: z.string().describe("委託人原話。任何補助問題都可以問；發票仍只在有綁定時發生。"),
      },
    },
    async ({ utterance }) => runTool("plan_applications", { utterance }),
  );

  server.registerTool(
    "request_service",
    {
      title: "向某個機關提出辦理申請",
      description:
        "代委託人向一個已登記服務提出辦理申請，並取回該機關本次索取的最小資料。這一步只建立服務需求，不建立 Grant。沒有工具可以代替本人確認這份需求——確認與簽署都必須由本人完成。",
      inputSchema: {
        purpose: z.string().describe("已登記的目的 ID，例如 childcare-allowance"),
      },
    },
    async ({ purpose }) => runTool("request_service", { purpose }),
  );

  server.registerTool(
    "get_grant_for_signature",
    {
      title: "取得待簽內容",
      description:
        "回傳一張 Grant 的服務需求、請求機關、資料來源、最小資料範圍、個資告知文字與待簽 bytes。模型不能代簽；簽署必須由使用者在認證器完成。",
      inputSchema: {
        grantId: z.string().describe("匣編號：G-甲 / G-jia、G-乙 / G-yi 或 G-丙 / G-bing"),
      },
    },
    async ({ grantId }) => runTool("get_grant_for_signature", { grantId }),
  );

  server.registerTool(
    "redeem_grant",
    {
      title: "兌現授權匣",
      description:
        "請求機關以自己的金鑰向資料來源機關兌現已簽署 Grant。資料來源驗證使用者簽章、機關持有證明與法定目的後，把最小述詞直接交付請求機關；不回傳給語言模型。",
      inputSchema: {
        grantId: z.string().describe("匣編號：G-甲 / G-jia、G-乙 / G-yi 或 G-丙 / G-bing"),
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
        "機關主動索取一組述詞。逾越該目的法定職務範圍、或逾越必要範圍的原始欄位，在提案階段就攔截，委託人不會看到同意按鈕。",
      inputSchema: {
        agency: z.string().describe("jia / yi"),
        purpose: z
          .string()
          .describe("childcare-allowance / childcare-service-subsidy / aircon-subsidy"),
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
      description: "請求機關使用資料來源直接交付的述詞開始處理服務。",
      inputSchema: {
        grantId: z.string().describe("匣編號：G-甲 / G-jia、G-乙 / G-yi 或 G-丙 / G-bing"),
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
        grantId: z.string().describe("匣編號：G-甲 / G-jia、G-乙 / G-yi 或 G-丙 / G-bing"),
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
        "回傳設定／發證／簽署／兌現／送件／撤銷／拒絕／推送／簽收的時間線，以及從未被使用過的金庫欄位。不含金庫值，也不含述詞的值。帶 since 可以只取增量，回傳的 cursor 下次直接帶回來。",
      inputSchema: {
        since: z.string().optional().describe("稽核編號或 ISO 時間，只回這之後的紀錄"),
      },
    },
    async ({ since }) => runTool("get_audit", { since }),
  );

  server.registerTool(
    "get_notifications",
    {
      title: "讀取主動推播",
      description:
        "先跑一次巡檢再回傳代理人推出的通知。只給模型看摘要，不給人類版本的本文——推播描述發生了什麼，不含金庫值，也不含述詞的值。",
      inputSchema: {
        unacknowledgedOnly: z.boolean().optional().describe("只回尚未簽收的"),
        since: z.string().optional().describe("ISO 時間，只回這之後推出的"),
      },
    },
    async ({ unacknowledgedOnly, since }) =>
      runTool("get_notifications", { unacknowledgedOnly, since }),
  );

  server.registerTool(
    "acknowledge_notification",
    {
      title: "簽收推播",
      description:
        "把一則推播標記為已簽收，並記一筆稽核。簽收只表示看過了，不會授權任何事。",
      inputSchema: {
        id: z.string().describe("推播 id"),
      },
    },
    async ({ id }) => runTool("acknowledge_notification", { id }),
  );

  server.registerTool(
    "get_pending_actions",
    {
      title: "現在卡在哪裡",
      description:
        "回傳目前卡住的每一件事、卡在哪一方（委託人／機關／發證機構／代理人），以及下一步該呼叫哪個工具。建議的下一步永遠不是簽署——工具清單裡沒有簽署工具。",
      inputSchema: {},
    },
    async () => runTool("get_pending_actions", {}),
  );

  return server;
}

/**
 * Tells a connected client about the notices a watch pass just pushed.
 *
 * Best effort by design: a client that declared no logging level, or that has
 * gone away, must not be able to take the ticker down with it.
 */
export async function announce(server: McpServer, pushed: Notification[]) {
  for (const n of pushed) {
    try {
      await server.sendLoggingMessage({
        level: "info",
        logger: "grantonce/watch",
        data: {
          key: n.key,
          kind: n.kind,
          severity: n.severity,
          title: n.title,
          summaryForAgent: n.summaryForAgent,
        },
      });
    } catch (error) {
      console.error("[grantonce] logging notification failed", error);
    }
  }
  if (!SUBSCRIPTIONS.get(server)?.has(NOTIFICATIONS_URI)) return;
  try {
    await server.server.sendResourceUpdated({ uri: NOTIFICATIONS_URI });
  } catch (error) {
    console.error("[grantonce] resource update failed", error);
  }
}

/**
 * The watch loop itself. This is the piece that makes the agent proactive: it
 * runs whether or not anyone calls a tool, so a change in entitlement is noticed
 * by the thing that is supposed to be watching.
 */
export function startWatchLoop(server: McpServer): NodeJS.Timeout {
  const timer = setInterval(() => {
    let pushed: Notification[] = [];
    try {
      pushed = runAgentTick();
    } catch (error) {
      console.error("[grantonce] watch pass failed", error);
      return;
    }
    if (pushed.length) void announce(server, pushed);
  }, TICK_MS);
  // Never the reason the process stays alive.
  timer.unref();
  return timer;
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
  startWatchLoop(server);
}

async function startHttp() {
  // One watch loop for the process, not one per request: the HTTP transport
  // builds a fresh server per call, and a ticker per request would multiply.
  const watcher = createGrantOnceServer();
  startWatchLoop(watcher);

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
