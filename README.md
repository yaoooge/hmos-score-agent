# hmos-score-agent

基于 LangGraph + TypeScript 的 HarmonyOS 代码评分服务。服务接收原始工程、任务 prompt、生成工程和 patch，结合静态规则、opencode agent、官方 Code Linter 与 hvigor 校验生成结构化评分结果。

## 文档入口

| 文档 | 内容 |
| --- | --- |
| [docs/README.md](docs/README.md) | 文档总索引与建议阅读顺序 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 代码仓目录结构、主评分 workflow 与旁路人工流程 |
| [docs/apis/README.md](docs/apis/README.md) | 当前服务对外 HTTP 接口与 callback 契约 |
| [docs/agents/README.md](docs/agents/README.md) | opencode agents 索引与各 agent 说明 |

## 快速启动

```bash
npm install
cp .env.example .env
npm run score -- --case cases/simple_test
```

启动 API 服务：

```bash
npm run dev:api
curl http://localhost:3000/health
```

运行前需要确保 `opencode` CLI 可执行，并在 `.env` 中配置真实的 `HMOS_OPENCODE_*` 参数。

## 服务启动

- 本地 CLI 评分：`npm run score -- --case <case-path>`
- 本地 API 服务：`npm run dev:api`
- 生产构建后启动：`npm run build && npm start`

API 服务默认监听 `PORT`，未设置时为 `3000`。启动后可先访问 `GET /health` 确认进程可用，再调用评分接口。

## 可执行脚本

| 脚本 | 作用 |
| --- | --- |
| `npm run build` | TypeScript 编译检查并输出 `dist/`。 |
| `npm start` | 启动编译后的 API 服务。 |
| `npm run dev:api` | 以开发模式启动 HTTP 服务。 |
| `npm run score` | 直接运行本地单用例评分。 |
| `npm run rulepack:export` | 导出规则包 YAML。 |
| `npm test` | 运行全部 node:test 测试。 |
| `npm run lint` | 运行 ESLint。 |
| `npm run lint:fix` | 运行 ESLint 自动修复。 |
| `npm run format` | 运行 Prettier 格式化。 |
| `npm run format:fix` | 运行 Prettier 自动修复。 |

## Patch 生成

`cases/<caseId>/workspace` 是普通目录，不需要是独立 Git 仓库。评分流程会在运行期基于 `original/` 和 `workspace/` 的目录差异生成有效 patch，底层等价于：

```bash
git diff --no-index -- original workspace > diff/changes.patch
```

Patch 生成会分别读取 `original/.gitignore` 和 `workspace/.gitignore`。如果 `.gitignore` 缺失或不可读，会回退到内置保底忽略项。
