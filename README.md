# 工作台

面向电子元器件贸易的网页工作台：客户待办、询价闭环、型号/公司公开情报、主推池。

## 能做什么

- **客户待办**：手动录入或粘贴微信截图识别，到期提醒、过期顺延
- **询价闭环**：报价待办抽出「客户 × 型号」→ 待报价看板 → 查行情 → 入主推池
- **型号分析**：立创商品参数、原厂应用、华强挂货；完整型号档案（规格 / 应用 / 拓展）
- **公司分析**：华强供应商名片 + 商铺库存
- **记录入库**：待办、询价、型号池、查询报告都写入数据库

公开页能拿到立创价、挂货、原厂应用；**没有**烽火指数、贸易成交价（要登录，默认不做）。

## 本地运行

```bash
npm install
cp fetcher-config.example.json fetcher-config.json
# 把 apiKey 换成你的 Firecrawl Key
npm run dev
```

浏览器打开开发服务提示的地址。第一次会写入示例待办。

查行情需要 [Firecrawl](https://www.firecrawl.dev/) Key，放在本机 `fetcher-config.json`，这个文件已加入 `.gitignore`，不要提交。

### Agent Platform 环境变量

复制 `.env.example` 后只在本机或部署平台配置实际值，绝不提交密钥：

- `AGENT_API_URL`：可选，electronics-agent-platform 的地址，默认 `http://127.0.0.1:8787`。
- `ELECTRONICS_AGENT_PLATFORM_TOKEN`：Workbench **出站**调用 Platform 的 Bearer token；不能用于 Workbench API。
- `WORKBENCH_AGENT_API_TOKEN`：Workbench `/api/agent/*` **入站** API 与本地 Harness/MCP 的 Bearer token；不能用于 Platform。

Platform 是可选智能增强：不可用、超时或鉴权失败时，工作台会继续执行本地公开查询。事实、约束、写库和最终决定始终留在 Workbench 与人工手里。

## 发布上线

1. **GitHub**：本仓库就是源码。克隆后按上面本地运行即可。
2. **Vercel 等平台**：用本仓库导入，构建命令 `npm run build`。上线后需要配置 Postgres（`DATABASE_URL`），抓取 Key 用环境变量或部署平台的密钥，不要把 Key 写进仓库。

预览环境的库在服务重启后会空；正式库会一直留着。

## 技术

TanStack Start + React + Tailwind。数据库：有 `DATABASE_URL` 时用 Postgres，没有则用本机嵌入式库。
