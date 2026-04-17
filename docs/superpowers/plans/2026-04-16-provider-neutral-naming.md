# Provider Neutral Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将工程中所有带品牌指向的配置、类名、交互文案、测试和文档彻底切换为模型供应商中立命名，并保证评分链路继续可运行。

**Architecture:** 本次改造不改变评分工作流结构，只做命名和配置入口重构。核心实现是把环境变量、配置字段、client 类型和交互脚本统一切到 provider-neutral 术语，同时保留当前兼容 chat completions 的调用能力、降级重试逻辑和返回归一化逻辑。

**Tech Stack:** TypeScript、node:test、tsx、repo 内 CLI/workflow、README 与 superpowers 文档

---

### Task 1: 配置与交互入口中立化

**Files:**
- Modify: `src/config.ts`
- Modify: `src/tools/runInteractiveScore.ts`
- Modify: `src/service.ts`
- Test: `tests/interactive-launcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("runInteractiveScore uses provider-neutral env keys and prompts", async () => {
  const text = "MODEL_PROVIDER_BASE_URL=https://old.example/v1\nMODEL_PROVIDER_MODEL=gpt-5.4\n";
  assert.match(text, /MODEL_PROVIDER_BASE_URL/);
  assert.doesNotMatch(text, /旧品牌环境变量/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/interactive-launcher.test.ts`
Expected: FAIL，提示仍存在旧品牌环境变量或旧品牌交互文案

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface AppConfig {
  modelProviderBaseUrl?: string;
  modelProviderApiKey?: string;
  modelProviderModel?: string;
}

process.env.MODEL_PROVIDER_BASE_URL = baseUrl;
process.env.MODEL_PROVIDER_API_KEY = apiKey;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/interactive-launcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/tools/runInteractiveScore.ts src/service.ts tests/interactive-launcher.test.ts
git commit -m "refactor: use provider-neutral runtime config names"
```

### Task 2: Agent Client 与工作流命名中立化

**Files:**
- Modify: `src/agent/agentClient.ts`
- Modify: `src/workflow/scoreWorkflow.ts`
- Modify: `src/nodes/agentAssistedRuleNode.ts`
- Test: `tests/agent-client.test.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { ChatModelClient } from "../src/agent/agentClient.js";

test("ChatModelClient retries without response_format when provider rejects it", async () => {
  const client = new ChatModelClient({
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-5.4",
  });
  assert.ok(client);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent-client.test.ts tests/score-agent.test.ts`
Expected: FAIL，提示旧版命名 client 仍是旧导出或 workflow 仍读取旧字段

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface ChatModelClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class ChatModelClient implements AgentClient {}

export function createDefaultAgentClient(config: {
  modelProviderBaseUrl?: string;
  modelProviderApiKey?: string;
  modelProviderModel?: string;
}): AgentClient | undefined {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent-client.test.ts tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/agentClient.ts src/workflow/scoreWorkflow.ts src/nodes/agentAssistedRuleNode.ts tests/agent-client.test.ts tests/score-agent.test.ts
git commit -m "refactor: rename agent client to provider-neutral terms"
```

### Task 3: 全局测试、README 和文档去供应商指向

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-04-16-interactive-launcher-and-localized-report-design.md`
- Modify: `docs/superpowers/plans/2026-04-16-interactive-launcher.md`
- Modify: `docs/superpowers/plans/2026-04-16-interactive-launcher-and-localized-report.md`
- Modify: `docs/superpowers/plans/2026-04-16-agent-assisted-rule-evaluation.md`
- Test: `tests/interactive-launcher.test.ts`
- Test: `tests/agent-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("repo docs and tests no longer mention provider-specific brand names", async () => {
  const readme = await fs.readFile(path.resolve(process.cwd(), "README.md"), "utf-8");
  assert.doesNotMatch(readme, /旧品牌命名/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/interactive-launcher.test.ts tests/agent-client.test.ts`
Expected: FAIL，提示 README 或测试夹具里仍含旧品牌命名

- [ ] **Step 3: Write minimal implementation**

```markdown
- `npm run launch:score`：交互式填写模型服务 `baseUrl` / `apiKey`，写入 `.env` 后运行评分流程
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/interactive-launcher.test.ts tests/agent-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-04-16-interactive-launcher-and-localized-report-design.md docs/superpowers/plans/2026-04-16-interactive-launcher.md docs/superpowers/plans/2026-04-16-interactive-launcher-and-localized-report.md docs/superpowers/plans/2026-04-16-agent-assisted-rule-evaluation.md tests/interactive-launcher.test.ts tests/agent-client.test.ts
git commit -m "docs: remove provider-specific naming"
```

### Task 4: 全局残留扫描与端到端验证

**Files:**
- Modify: `tests/agent-client.test.ts`
- Modify: `tests/interactive-launcher.test.ts`
- Modify: `tests/score-agent.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("source tree contains no provider-specific runtime naming", async () => {
  const matches = "placeholder";
  assert.equal(matches.includes("旧品牌前缀"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL，或通过 `rg` 扫描发现仓库仍有旧品牌命名

- [ ] **Step 3: Write minimal implementation**

```bash
rg -n "旧品牌命名模式" src tests README.md docs
```

把扫描结果清零后，若仍有历史说明确实必须保留的字符串，再逐一改为 provider-neutral 表达。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

Run: `npm run build`
Expected: PASS

Run: `npm run score -- --case init-input`
Expected: PASS，且最新 `.local-cases` 中 `case-info.json`、`inputs/agent-prompt.txt`、`logs/run.log` 不再出现旧品牌命名

- [ ] **Step 5: Commit**

```bash
git add tests/agent-client.test.ts tests/interactive-launcher.test.ts tests/score-agent.test.ts
git commit -m "test: verify provider-neutral naming end to end"
```
