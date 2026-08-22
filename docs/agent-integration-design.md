# 华强北 Workbench × DeepSeek Harness — 方案 B 集成设计

版本:2026-08-22 · 状态:实施中 · 目标:goal-fdc8c273

## 1. 第一性原理拆解

终局场景:**"我手里有 3000pcs TPS54560DDAR,现在怎么卖?" → AI 多步研究 → 可信、可追溯的结论落库。**

把这个终局拆到不可再分的四个要素:

| 要素 | 不可再分的问题 | 本项目的回答 |
|---|---|---|
| **能力**(查得到) | 事实从哪来? | `runLookupStep()` 六步(立创/ST/华强/供应商/商铺/AnySearch)+ 内部历史查询 |
| **方法**(判得稳) | 同样的输入为何得出同样质量的判断? | Skill 固化 SOP 与反直觉规则("供应商多≠热门") |
| **记忆**(可追溯) | 结论凭什么信? | evidence_items / market_snapshots / agent_tasks / agent_events / research_reports 五表 |
| **边界**(不越权) | AI 不能碰什么? | 凭据不出进程、数据库单点写入、登录墙结构化降级 |

**推论**:模型只做「解释与决策」;一切事实获取与写入都走受控接口。Harness 的价值 = 把这四要素串成自主循环,而不是替代其中任何一个。

## 2. 硬约束(全部实测得出,非假设)

- **C1 内存数据库**:本地 PGLite 是进程内内存实例(`db.ts`,重启即清空)→ 外部 Tool 进程**无法直连 DB**,必须经 Workbench HTTP API 单点读写。
- **C2 凭据驻留**:`FIRECRAWL_API_KEY` / `XAI_API_KEY` 只在 Workbench 服务端解析(fetcher-config.json / env)→ MCP 工具层**零凭据**,天然满足安全准则 M3。
- **C3 项目惯例**:schema 只进 `migrations/*.sql`(自动应用);text 主键、text ISO 时间戳;新表已照搬(0004_agent_research.sql,双遍幂等已验证)。
- **C4 平台契约**(AGENTS.md):不动 `server/`、`vite.config.ts`、`startup.sh`、`public/__grok/`;新增服务端点走 `src/routes/api/`。
- **C5 dsh 成熟度**:DeepSeek Harness 处于 developer preview(仓库创建于 2026-08-13,官方明示将有破坏性变更)→ 集成面必须最小化,dsh 侧只允许一个薄壳。

## 3. 架构定案(方案 B)

```
dsh 会话(agent + part-intelligence skill)
        │  MCP 工具调用
        ▼
harness-tools(MCP 薄壳: schema 校验 + 转发,无状态、零凭据)
        │  HTTP (127.0.0.1)
        ▼
Workbench Agent API(src/routes/api/agent/*,zod 校验)
        │  复用现有模块
        ├─ runLookupStep() → 六步市场数据
        ├─ buildDossier()/extraKnowledge() → 型号档案
        └─ getSql() → agent_* / evidence_* / market_snapshots / research_reports
```

**关键决策:所有业务 Tool 都经 Workbench HTTP API,MCP 层是纯转发。**

理由(对照约束):
- 抓取逻辑、md 解析、key 管理、静态知识库只在 Workbench 存在一份 —— 单一事实源(M1 零侵入自动成立);
- MCP 壳不含任何业务逻辑与凭据(C2/M3 自动成立);
- dsh preview 变化时只需重做薄壳,C5 风险被压缩到最小面积;
- 数据写入仍单点经过 Workbench 进程,C1 不被破坏。

## 4. Tool 清单 v1

| Tool | 入参 | 出参 | 后端 |
|---|---|---|---|
| `task.create` | type, input(mpn/goal/holder_qty/cost) | task_id | POST → agent_tasks |
| `part.research.run` | task_id, query | LookupRecord 结构(steps/offers/identity/dossier) | runLookupStep 六步 + 快照落库 |
| `part.dossier.get` | mpn | 档案(规格/应用/替代/贸易知识) | parts 表 + buildDossier |
| `internal.history.search` | mpn | 询价/报价/型号池/历史报告 | quote_lines/parts/search_reports |
| `evidence.save`(批量) | task_id, items[] | evidence_ids | evidence_items |
| `snapshot.save` | mpn, metrics[] | snapshot_id | market_snapshots |
| `report.save` | task_id, verdict, report, evidence_ids | report_id(**硬校验**:evidence_ids 必须全部存在,否则 422) | research_reports |
| `task.finish` | task_id, status, error? | ok | agent_tasks 状态机 |

`web.search` / `web.fetch` 类通用能力用 dsh 自带工具,不自建。

## 5. 安全边界

1. API 仅监听 localhost(dev);可选 `AGENT_API_TOKEN` 共享密钥(env),MCP 壳透传。
2. 无任意 SQL:全部白名单端点,zod 校验入参;SQL 一律参数化(沿用 getSql 惯例)。
3. 报告入库硬校验:evidence_ids 引用不存在的证据 → 拒绝(M5 的程序级保证,而非靠 Skill 自觉)。
4. 登录墙/抓取失败:沿用 `LookupStepResult.status`(ok/empty/skipped/error)结构化返回,Skill 规定遇 error 记 degrade 事件并换源,不重试撞墙。
5. Skill 文本零凭据、零内网地址。

## 6. 对抗审查机制

- **审查人**:独立子代理,攻击者视角,拿本设计 + 实际代码逐条攻击;审查者不得是实现者本人视角的自我检查。
- **第 1 轮**(实现完成后):攻击面 = 注入(SQL/zod 绕过)、凭据泄漏路径、降级路径是否真的不崩、并发/幂等(task 重复触发)。
- **第 2 轮**(端到端后):对照方案文档附录 B 六条验收标准逐条核查 + 报告可复现性(同型号两次执行结构一致)。
- **止损**:任一 must 准则 rejected → 停止推进,修复后重审(verifier_track 账本裁决)。

## 7. dsh 挂载形态(已定案,依据官方文档实测)

**选型:MCP stdio 薄壳**(而非自写 Cordis 原生插件)。

理由:
- dsh 原生支持 MCP(`@deepseek-ai/dsh-mcp-client`,stdio + streamable-http 双 transport),工具以 `mcp__<serverName>__<name>` 命名空间进入模型;
- MCP 是标准协议 —— dsh 处于 developer preview(C5),破坏性变更被隔离在协议边界外;Cordis 插件 API 则直接暴露在变更面内;
- 薄壳零凭据、零业务逻辑(M3 自动成立)。

**组成**:
| 文件 | 作用 |
|---|---|
| `harness-tools/server.mjs` | MCP stdio server(@modelcontextprotocol/sdk),10 个工具 → HTTP API |
| `harness-tools/cordis.patch.yml` | `- insert:` 一行挂载 mcp-client(StdioConfig) |
| `.dsh/skills/part-intelligence.md` | 项目级 Skill(dsh rank-100 目录,Chokidar 热加载) |

**验证方式**(不污染全局配置):
```sh
# 合成检查
dsh --profile headless --patch ./harness-tools/cordis.patch.yml --dump-config
# 端到端(注意:--patch 必须在任务文本之前,否则被当作 app 参数)
dsh --profile headless --patch ./harness-tools/cordis.patch.yml "<研究任务>"
```

**已核实的 StdioConfig 键名**(来源:dsh docs/config-catalog.md §mcp-client):
transport / serverName / command / args / env / cwd / toolCallTimeoutMs / failOnStartupError / reconnect。

**投产注意**:锁版本(preview 期破坏性变更);多 server 时每行一个 mcp-client 实例(serverName 全局唯一)。

### 7.1 实测发现的部署坑(2026-08-22)

1. **参数顺序**:`--patch` 必须放在任务文本**之前**;否则被当作传给 headless app 的参数报 `unknown option '--patch'`。
2. **凭据文件格式分裂**:DSH Desktop 写的 `~/.dsh/.credentials.yaml` 是 `version` + `refs:` 嵌套结构;而 CLI(`dsh-credentials-local`)要求**平铺 `ref → 字符串` 严格映射**(源码 parseCredentialsDocument:非字符串值一律拒绝),且文件权限必须 600(assertOwnerOnly)。二者不兼容 → 本方案采用独立 `DSH_HOME=~/.dsh-hqb-e2e`(内含 chmod 600 的平铺版 .credentials.yaml),**完全不改动桌面版的文件**(已做过一次加引号实验后从备份还原)。CLI 与桌面版格式统一前,这是最安全的并存方式。
3. MCP server 被 dsh spawn 成功时会输出 `[hqb-harness-tools] ready -> …`,可作为挂载成功的标志。

## 8. 里程碑

- [x] M0 代码侦察 + migration 0004(已验证幂等)
- [x] M1 Workbench Agent API 路由(11 端点,zod + 参数化 SQL)
- [x] M2 MCP 薄壳 harness-tools(12 工具,fail-fast 挂载)
- [x] M3 part-intelligence Skill(verdict.score 引擎化约束)
- [x] M4 端到端真实型号研究 × 3(NE555P rep-0791/rep-bed7/rep-20d2)
- [x] M5 对抗审查 #1(blocker+6medium 全修)/#2(必改2项全修+攻击重放)

## 9. 数据源与分析扩展(goal-114242c1, 2026-08-23)

- [x] Findchips 数据源:findchips.server.ts 解析器(99 行样本→82 授权/
      17 exact offers,变体零泄漏)+ lookup step + currency=USD 标注
- [x] market.analyze 确定性评分引擎:热门(需求侧70%权重,内建
      "供应商多≠热门")/缺货(库存50%+环比30%)/涨价(序列60%+溢价40%);
      computedAt 取数据基准时间,同输入同输出;T1-T8 单测全过;
      回归 v2 中模型 verdict.score=49 直接引用引擎涨价分(rep-20d2)
- [x] snapshot-cron 定时静默采集(dry-run 默认,max≤50,steps 白名单)
- [x] company_profiles 表(0006)+ company-intelligence Skill
- [x] IC交易网登录会话 Tool 骨架(icnet step,auth_required 降级,
      开源调研零现成实现,移动端为混淆加密 SPA)
- [x] Mouser/DigiKey API 预留适配点(key 待申请)
- 条件项待用户输入:IC交易网会员 cookie;Mouser/DigiKey API key
