# 评分一致性分析管理页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `web/` 管理台实现“一致性分析”页面，支持粘贴远端任务 JSON、创建多个 10 次评分的一致性任务，并按多数结果稳定性展示一致性结论。

**Architecture:** 将可测试的业务逻辑拆到 `web/src/pages/scoreConsistencyAnalysis.ts`，页面组件 `ConsistencyAnalysis.vue` 只负责状态编排和展示。远端提交、批量状态刷新和完成结果读取封装在 `web/src/api/scoreConsistency.ts`，路由和侧边栏只做入口接入。

**Tech Stack:** Vue 3、Element Plus、Vue Router、TypeScript、node:test、Vite。

---

### Task 1: 纯工具函数与单元测试

**Files:**
- Create: `web/src/pages/scoreConsistencyAnalysis.ts`
- Create: `tests/score-consistency-analysis.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖 JSON 校验、任务 ID 生成、结果提取、Jaccard 相似度、多数基准、一致性百分比、规则报表和风险报表。

Run: `node --import tsx --test tests/score-consistency-analysis.test.ts`

Expected: FAIL，提示找不到 `web/src/pages/scoreConsistencyAnalysis.js` 或导出函数不存在。

- [ ] **Step 2: 写最小实现**

在 `web/src/pages/scoreConsistencyAnalysis.ts` 中导出以下函数和类型：

```ts
validateRemoteTaskJson(jsonText: string): RemoteTaskValidationResult;
generateSubmittedTaskIds(baseTaskId: number, taskSequence: number, runCount?: number): number[];
extractConsistencyRunSummary(runIndex: number, taskId: number, resultData: unknown): ConsistencyRunSummary;
jaccardSimilarity(left: string[], right: string[]): number;
analyzeConsistency(runs: ConsistencyRunSummary[]): ConsistencyAnalysisSummary;
buildRuleReport(runs: ConsistencyRunSummary[]): RuleConsistencyReportItem[];
buildRiskReport(runs: ConsistencyRunSummary[]): RiskConsistencyReportItem[];
```

- [ ] **Step 3: 验证测试通过**

Run: `node --import tsx --test tests/score-consistency-analysis.test.ts`

Expected: PASS。

### Task 2: 远端 API helper

**Files:**
- Create: `web/src/api/scoreConsistency.ts`

- [ ] **Step 1: 写实现**

新增：

```ts
normalizeServiceBaseUrl(baseUrl: string): string;
submitRemoteScoreTask(baseUrl: string, payload: unknown): Promise<SubmitRemoteScoreTaskResponse>;
fetchRemoteScoreResult(baseUrl: string, taskId: number): Promise<RemoteScoreResultResponse>;
fetchRemoteTaskStatuses(baseUrl: string, taskIds: number[]): Promise<RemoteTaskStatusesResponse>;
```

实现要求：

- 去掉 `baseUrl` 末尾 `/`。
- POST `${baseUrl}/score/run-remote-task`。
- GET `${baseUrl}/score/remote-tasks/${taskId}/result`。
- GET `${baseUrl}/score/remote-tasks/status?taskIds=...`。
- 非 2xx 响应抛出带响应文本的 `Error`。

- [ ] **Step 2: 类型检查**

Run: `npm run build:dashboard`

Expected: PASS。

### Task 3: 一致性分析页面

**Files:**
- Create: `web/src/pages/ConsistencyAnalysis.vue`
- Modify: `web/src/styles/base.css`

- [ ] **Step 1: 实现页面结构**

页面包含：

- 顶部指标和 `创建一致性任务` 按钮。
- 创建任务抽屉。
- 任务列表，默认每页 10 条。
- 任务详情区域。
- 运行对比、规则不满足报表、风险项报表三个 tab。
- 原始结果抽屉。

- [ ] **Step 2: 实现执行编排**

创建任务后：

- 校验 JSON。
- 根据原始 `taskId` 和页面任务序号生成 10 个递增 `taskId`。
- 顺序提交 10 次远端评分。
- 不做自动轮询。
- 点击“刷新状态”时批量读取 10 条任务状态。
- 已完成任务再读取结果并提取摘要。
- 失败运行最多自动重新提交 1 次。

- [ ] **Step 3: 实现后端任务表持久化**

新增后端一致性任务表接口，浏览器通过 `GET/PUT /score/consistency-tasks` 读取和保存任务集合，文件与 `remote-task-index.json` 同级。

### Task 4: 路由、菜单和开发代理

**Files:**
- Modify: `web/src/router/index.ts`
- Modify: `web/src/App.vue`
- Modify: `web/vite.config.ts`

- [ ] **Step 1: 接入路由**

新增 `/consistency` 路由并加载 `ConsistencyAnalysis.vue`。

- [ ] **Step 2: 接入侧边栏和标题**

侧边栏新增 `一致性分析` 菜单项。标题为 `一致性分析`，副标题为 `重复评分、规则波动和风险项稳定性分析`。

- [ ] **Step 3: 接入开发代理**

在 Vite 代理中补充 `/score/run-remote-task`，方便本地用相对路径调试。

### Task 5: 验证

**Files:**
- No code changes.

- [ ] **Step 1: 单元测试**

Run: `node --import tsx --test tests/score-consistency-analysis.test.ts`

Expected: PASS。

- [ ] **Step 2: 前端构建**

Run: `npm run build:dashboard`

Expected: PASS。

- [ ] **Step 3: 工作区检查**

Run: `git status --short`

Expected: 只包含本功能相关文件修改。
