/**
 * agent-api-plugin — 方案B 的 dev 挂载点。
 *
 * 在 TanStack Start / SPA fallback 之前拦截 /api/agent/*,交给
 * src/lib/agent/api.server.ts 处理(经 ssrLoadModule,共享 dev server 进程内
 * 的 PGLite 实例与全部现有模块)。生产部署可后续以 nitro middleware 复用同一
 * handler(docs/agent-integration-design.md §3)。
 *
 * 先例:authPopupPlugin(vite.config.ts)——同款 Request/Response 桥接模式。
 */
export function agentApiPlugin() {
  return {
    name: "workbench:agent-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? "";
        const pathOnly = rawUrl.split("?", 1)[0] ?? "";
        if (!pathOnly.startsWith("/api/agent/")) {
          next();
          return;
        }
        // 对抗审查 C(blocker): dev server 绑定 0.0.0.0(平台契约), 未设
        // AGENT_API_TOKEN 时仅允许本机回环访问 —— 局域网主机不得读取内部
        // 询价/报价等商业数据。设了 token 则交给 handler 内 Bearer 校验。
        const tokenConfigured = Boolean(String(process.env.AGENT_API_TOKEN || "").trim());
        if (!tokenConfigured) {
          const remote = String(req.socket?.remoteAddress || "");
          const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
          if (!loopback) {
            res.statusCode = 403;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: "forbidden: non-loopback client without AGENT_API_TOKEN" }));
            return;
          }
        }
        // 对抗审查 B(medium): 请求体上限, 防巨型 jsonb 写入内存库。
        const MAX_BODY = 1024 * 1024; // 1MB
        try {
          const mod = await server.ssrLoadModule("/src/lib/agent/api.server.ts");
          const handleAgentApiRequest = mod.handleAgentApiRequest;
          if (typeof handleAgentApiRequest !== "function") {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: "handler missing" }));
            return;
          }

          // Node req -> fetch Request(含 body)
          const chunks = [];
          let total = 0;
          for await (const chunk of req) {
            total += chunk.length;
            if (total > MAX_BODY) {
              res.statusCode = 413;
              res.setHeader("content-type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: `body too large (>${MAX_BODY} bytes)` }));
              return;
            }
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks);
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) headers.append(key, String(v));
            } else {
              headers.set(key, String(value));
            }
          }
          const request = new Request(`http://127.0.0.1:8080${rawUrl}`, {
            method: req.method || "GET",
            headers,
            body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
          });

          const response = await handleAgentApiRequest(request);
          if (!response) {
            next(); // 非 /api/agent/*(理论不可达,防御性)
            return;
          }

          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === "set-cookie") return;
            res.setHeader(key, value);
          });
          const out = Buffer.from(await response.arrayBuffer());
          res.end(out);
        } catch (err) {
          console.error("[agent-api-plugin]", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: err?.message || "agent api failed" }));
          }
        }
      });
    },
  };
}
