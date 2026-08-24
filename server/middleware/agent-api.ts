/**
 * Agent API 的 Nitro 生产中间件(hq.newmindchen.com 生产构建可用)。
 *
 * vite.config.ts 已设 `serverDir: "./server"` → Nitro v3 自动扫描
 * server/middleware/* 注册全局中间件(与 grok-pwa.ts 同机制)。
 *
 * 复用 src/lib/agent/api.server.ts 的纯 handler(dev 与 prod 同一实现),
 * 仅负责将 h3 事件桥接为 fetch Request/Response。
 */
import { defineEventHandler, type H3Event } from "h3";

type NodeLikeEvent = {
  node: {
    req: import("node:http").IncomingMessage & { url?: string };
    res: import("node:http").ServerResponse;
  };
};

function readBodyBuffer(req: NodeLikeEvent["node"]["req"]): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      chunks.push(c);
      const total = chunks.reduce((n, b) => n + b.length, 0);
      if (total > 1_048_576) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on("error", reject);
  });
}

export default defineEventHandler(async (event: H3Event) => {
  const node = event.node! as NodeLikeEvent["node"];
  const rawUrl = node.req.url ?? "/";
  const pathOnly = rawUrl.split("?", 1)[0] ?? "";
  if (!pathOnly.startsWith("/api/agent/")) {
    return; // 非 Agent API, 交给后续中间件/路由
  }
  try {
    const { handleAgentApiRequest } = await import("../../src/lib/agent/api.server");
    if (typeof handleAgentApiRequest !== "function") {
      node.res.statusCode = 500;
      node.res.end(JSON.stringify({ ok: false, error: "handler missing" }));
      return;
    }
    // 生产同样默认仅本机回环可访问, 需要公开访问时设 WORKBENCH_AGENT_API_TOKEN。
    // 这是 Workbench 入站凭据，不可复用出站 Platform 凭据。
    const token = String(process.env.WORKBENCH_AGENT_API_TOKEN || "").trim();
    if (!token) {
      const remote = node.req.socket?.remoteAddress ?? "";
      const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
      if (!loopback) {
        node.res.statusCode = 403;
        node.res.setHeader("content-type", "application/json; charset=utf-8");
        node.res.end(JSON.stringify({ ok: false, error: "forbidden: set WORKBENCH_AGENT_API_TOKEN" }));
        return;
      }
    }
    const proto = node.req.headers["x-forwarded-proto"] ?? "http";
    const host = node.req.headers["x-forwarded-host"] ?? node.req.headers.host ?? "localhost";
    const method = (node.req.method ?? "GET").toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : await readBodyBuffer(node.req);
    const req = new Request(`${proto}://${host}${rawUrl}`, {
      method: node.req.method ?? "GET",
      headers: new Headers(node.req.headers as Record<string, string>),
      body: body ? new Uint8Array(body) : undefined,
    });
    const res = await handleAgentApiRequest(req);
    if (!res) {
      node.res.statusCode = 200;
      node.res.end(JSON.stringify({ ok: true }));
      return;
    }
    node.res.statusCode = res.status;
    res.headers.forEach((v: string, k: string) => {
      if (k.toLowerCase() !== "set-cookie") node.res.setHeader(k, v);
    });
    node.res.end(Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    console.error("[agent-api:nitro]", err);
    if (!node.res.writableEnded) {
      node.res.statusCode = 500;
      node.res.end(JSON.stringify({ ok: false, error: "internal error" }));
    }
  }
});
