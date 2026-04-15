# 评分核心链路 V1 设计

## 1. 背景

当前工程已经具备 LangGraph 工作流骨架、输入加载、本地产物落盘、规则文件读取、结果输出和上传预留能力，但评分核心链路仍处于占位实现阶段，主要问题如下：

- `ruleAuditNode` 仅按规则顺序输出全量台账，结果固定为 `不涉及`
- `scoringOrchestrationNode` 未读取 `rubric.yaml`，总分为硬编码占位值
- `reportGenerationNode` 未对 `result.json` 做真实 schema 校验
- 当前输出可以跑通流程，但不能提供可解释、可验证、可演进的评分结果

本设计定义“评分核心链路 V1”的实现边界：先交付一个能够快速落地、支持 TDD、并为后续 AST 规则判定保留扩展点的可用首版。

## 2. 目标

本轮实现目标如下：

1. 基于 `rubric.yaml` 为 `full_generation`、`continuation`、`bug_fix` 三类任务计算真实评分结果。
2. 基于 `arkts_internal_rules.yaml` 生成真实的规则台账与违规摘要，不再固定输出 `不涉及`。
3. 接入硬门槛、人工复核和风险项生成逻辑。
4. 在 `reportGenerationNode` 落盘前对 `result.json` 做严格 schema 校验。
5. 保持现有工作流节点结构稳定，仅替换节点内部实现。
6. 全过程遵循 TDD，小步交付、可验证、可回归。

## 3. 非目标

本轮明确不做以下事项：

- 不做 ArkTS AST 真解析和 AST 级规则判定
- 不引入 LLM 参与评分
- 不扩展远程下载链路
- 不尝试对 `arkts_internal_rules.yaml` 中所有规则做高精度自动判定
- 不增强 `report.html` 的视觉呈现，仅保留结果镜像展示

## 4. 设计原则

### 4.1 快速落地优先

首版优先交付可运行、可测、可解释的版本，不为“理想形态”牺牲交付节奏。

### 4.2 AST-ready

虽然首版使用文本/文件级静态证据，但从接口层面保留 `text` 与 `ast` 两类规则执行引擎的扩展能力。下一轮引入 AST 时，不重写评分主链。

### 4.3 主评分与规则修正分离

评分主结构由 `rubric.yaml` 决定。规则结果作为修正项、风险项、硬门槛和人工复核触发条件，不形成第二套独立总分体系。

### 4.4 强输出契约

`result.json` 是对外核心产物，必须在落盘前通过 schema 校验。未通过校验时，本次执行视为失败，不允许继续上传。

## 5. 总体方案

本轮保留现有 LangGraph 节点顺序不变，仅替换 3 个节点的内部实现，并新增 4 类支撑模块。

### 5.1 保持不变的工作流结构

- `taskUnderstandingNode`
- `inputClassificationNode`
- `featureExtractionNode`
- `ruleAuditNode`
- `scoringOrchestrationNode`
- `reportGenerationNode`
- `persistAndUploadNode`

### 5.2 节点职责调整

#### `ruleAuditNode`

从“读取规则并全部标记为 `不涉及`”改为调用 `RuleEngine`：

- 加载规则定义
- 收集工程级证据
- 执行规则判定
- 输出 `rule_audit_results`
- 输出 `rule_violations`

#### `scoringOrchestrationNode`

从“按任务类型返回占位总分”改为调用 `RubricLoader + ScoringEngine`：

- 读取任务类型对应的 rubric 维度和子指标
- 根据规则结果修正各子指标分数
- 汇总维度分、总分
- 生成硬门槛、风险项和人工复核项

#### `reportGenerationNode`

从“组装结果对象”改为：

- 组装 `result.json`
- 调用 `SchemaValidator`
- 校验通过后生成 `htmlReport`
- 校验失败直接抛错

## 6. 新增模块设计

### 6.1 `src/rules/evidenceCollector.ts`

职责：

- 收集 `workspace` 工程文件列表
- 收集 `original` 与 `workspace` 的相对路径结构差异
- 读取 patch 文本
- 读取单文件文本内容
- 产出统一证据对象，供规则执行器复用

输入：

- `CaseInput`

输出：

- `CollectedEvidence`

建议结构：

```ts
export interface CollectedEvidence {
  workspaceFiles: Array<{ relativePath: string; content: string }>;
  originalFiles: string[];
  patchText?: string;
  changedFiles: string[];
  summary: {
    workspaceFileCount: number;
    originalFileCount: number;
    changedFileCount: number;
  };
}
```

### 6.2 `src/rules/textRuleEvaluator.ts`

职责：

- 执行 `engine = text` 的规则
- 基于文件内容、路径、patch 和简单模式匹配给出结论

接口：

```ts
export interface RuleEvaluationContext {
  evidence: CollectedEvidence;
  taskType: TaskType;
}

export interface EvaluatedRule {
  rule_id: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  result: "满足" | "不满足" | "不涉及";
  conclusion: string;
  supported: boolean;
  matchedFiles: string[];
}
```

说明：

- `supported = false` 表示当前版本尚未实现该规则判定器
- 对 `supported = false` 的规则，`result = 不涉及`，并在 `conclusion` 中明确说明“当前版本未接入对应判定器”

### 6.3 `src/rules/ruleMapping.ts`

职责：

- 将规则 ID 或规则元信息映射到评分维度与子指标
- 声明规则执行引擎类型
- 声明规则严重度与风险类别

建议结构：

```ts
export interface RuleMapping {
  engine: "text" | "ast";
  affects: Array<{
    dimensionName: string;
    metricName: string;
    penaltyLevel: "low" | "medium" | "high";
  }>;
  contributesToHardGates: Array<"G1" | "G2" | "G3" | "G4">;
  riskLevel?: "low" | "medium" | "high";
}
```

### 6.4 `src/rules/ruleEngine.ts`

职责：

- 加载 `arkts_internal_rules.yaml`
- 遍历全量规则并保持原顺序
- 为每条规则选择执行引擎
- 输出 `ruleAuditResults` 和 `ruleViolations`

接口：

```ts
export interface RuleEngineOutput {
  ruleAuditResults: RuleAuditResult[];
  ruleViolations: RuleViolation[];
}
```

### 6.5 `src/scoring/rubricLoader.ts`

职责：

- 解析 `rubric.yaml`
- 为指定 `taskType` 输出结构化评分配置
- 暴露硬门槛和人工复核配置

接口：

```ts
export interface LoadedRubric {
  taskType: TaskType;
  evaluationMode: string;
  dimensions: Array<{
    name: string;
    weight: number;
    items: Array<{
      name: string;
      weight: number;
    }>;
  }>;
  hardGates: Array<{
    id: "G1" | "G2" | "G3" | "G4";
    scoreCap: number;
  }>;
  reviewRules: {
    scoreBands: Array<{ min: number; max: number }>;
  };
}
```

### 6.6 `src/scoring/scoringEngine.ts`

职责：

- 按 rubric 初始化所有子指标满分
- 根据规则判定结果执行扣分修正
- 生成子指标详情、一级维度分、总分
- 识别硬门槛
- 生成 `risks` 与 `human_review_items`

输入：

- `taskType`
- `constraintSummary`
- `featureExtraction`
- `ruleAuditResults`
- `ruleViolations`
- `LoadedRubric`
- `CollectedEvidence`

输出：

- `dimension_scores`
- `submetric_details`
- `overall_conclusion`
- `risks`
- `human_review_items`
- `strengths`
- `main_issues`
- `final_recommendation`

### 6.7 `src/report/schemaValidator.ts`

职责：

- 读取 `report_result_schema.json`
- 使用 AJV 执行严格校验
- 输出结构化校验结果或直接抛错

接口：

```ts
export function validateReportResult(
  resultJson: Record<string, unknown>,
  schemaPath: string,
): void
```

## 7. 规则首版支持策略

### 7.1 规则覆盖策略

本轮依然要求对 `arkts_internal_rules.yaml` 全量规则输出台账，保持顺序不变。但自动判定能力分为两类：

- `supported`
  - 当前版本支持文本/文件级静态证据判定
- `fallback`
  - 当前版本尚不支持可靠判定，输出 `不涉及`

### 7.2 首批支持的高价值规则类型

优先支持以下规则：

1. 明确语法/语言禁用项
   - `var`
   - `any`
   - `unknown`
   - `#private`

2. 明确平台风格/导入风险模式
   - 明显 Web / React / Vue 风格导入或关键字
   - 明显不符合 ArkTS/HarmonyOS 的文件使用模式

3. 明显工程风险模式
   - 敏感信息硬编码
   - 高风险关键字模式

4. `bug_fix` / `continuation` 的改动范围风险
   - patch 过大
   - 改动文件数异常
   - 明显无关改动

### 7.3 规则结果输出原则

- 明确命中时输出 `不满足`
- 明确未命中且可判定时输出 `满足`
- 当前版本不支持该规则时输出 `不涉及`
- 任一 `不满足` 的规则必须同步写入 `rule_violations`

## 8. 评分算法

### 8.1 子指标初始化

对当前 `taskType`：

- 加载对应一级维度
- 为每个子指标建立初始状态
- 子指标初始分数等于该子指标满分

### 8.2 扣分规则

首版采用固定扣分档，避免复杂公式：

- `must_rule` 命中
  - 扣减对应子指标满分的 `20% - 40%`
  - `confidence` 至少降为 `medium`

- `forbidden_pattern` 命中
  - 扣减对应子指标满分的 `30% - 60%`
  - `review_required = true`
  - 写入 `risks`

- `should_rule` 命中
  - 扣减对应子指标满分的 `10% - 20%`
  - 或仅降低 `confidence`

### 8.3 分数保护

- 子指标分数最低为 `0`
- 单子指标累计扣分不超过其满分的 `80%`

### 8.4 汇总方式

1. 计算各子指标最终分数
2. 汇总得到一级维度分
3. 汇总得到 `raw_total_score`
4. 检查硬门槛，必要时执行总分封顶

## 9. 硬门槛策略

### 9.1 G1 高密度静态错误

触发条件：

- 命中多个高严重度 `must_rule`
- 或同类型类型安全规则密集出现

处理：

- 总分封顶 `69`

### 9.2 G2 明显不符合 HarmonyOS / ArkTS 基本规范

触发条件：

- 命中多个平台禁用模式
- 或多条 ArkTS 约束规则同时不满足

处理：

- 总分封顶 `69`

### 9.3 G3 严重工程风险

触发条件：

- 命中高风险 `forbidden_pattern`
- 或命中敏感信息 / 生命周期 / 资源释放风险组合

处理：

- 总分封顶 `79`

### 9.4 G4 Bug 修复任务中的误修或过修

仅适用于 `bug_fix`：

- patch 文件过大
- 修改文件数异常
- 存在明显无关改动

处理：

- 总分封顶 `59`

## 10. 人工复核与置信度

### 10.1 人工复核触发条件

首版按以下确定性逻辑触发：

- 任一子指标 `confidence = low`
- 命中任意硬门槛
- `continuation` / `bug_fix` 缺少 patch 或上下文不足
- 某条高价值规则当前版本不支持可靠判定
- 总分落入临界带：
  - `68 - 71`
  - `78 - 81`
  - `88 - 91`

### 10.2 置信度规则

- `high`
  - 证据直接、定位清晰、规则命中明确

- `medium`
  - 有较强文本证据，但非结构化 AST 证据

- `low`
  - 弱模式推断、上下文缺失或规则暂未完全支持

### 10.3 人工复核项结构

每条人工复核项必须填满以下字段：

- `item`
- `current_assessment`
- `uncertainty_reason`
- `suggested_focus`

## 11. 输出契约

`reportGenerationNode` 在组装完成 `result.json` 后，必须立即执行 schema 校验。

要求：

- 校验成功后才能写入 `outputs/result.json`
- 校验失败时，当前执行失败并返回明确错误
- 禁止上传未通过 schema 校验的结果

## 12. 建议代码结构

```text
src/
  rules/
    evidenceCollector.ts
    textRuleEvaluator.ts
    ruleMapping.ts
    ruleEngine.ts
  scoring/
    rubricLoader.ts
    scoringEngine.ts
  report/
    schemaValidator.ts
```

## 13. TDD 实施顺序

### 13.1 第一步：SchemaValidator

先写测试：

- 合法 `result.json` 可通过
- 非法 `result.json` 被拒绝

再实现最小校验器。

### 13.2 第二步：RubricLoader

先写测试：

- 能按 `taskType` 读取对应维度
- 能读取硬门槛配置
- 能读取人工复核规则

再实现 YAML 解析。

### 13.3 第三步：RuleEngine 首版

先写测试：

- `var` / `any` / `unknown` / `#private` 能命中
- 未支持规则输出 `不涉及`
- 台账顺序与源 YAML 一致
- `不满足` 规则进入 `rule_violations`

再实现 `EvidenceCollector + TextRuleEvaluator + RuleEngine`。

### 13.4 第四步：ScoringEngine

先写测试：

- 子指标初始为满分
- `must/should/forbidden` 命中后的扣分
- `confidence` 与 `review_required` 更新
- 硬门槛封顶
- 人工复核项生成

再实现纯计算逻辑。

### 13.5 第五步：Workflow 集成

最后写集成测试：

- 工作流输出动态规则台账
- `dimension_scores` / `submetric_details` 非空
- `result.json` 通过 schema 校验
- 命中硬门槛时总分被封顶
- 需要人工复核时正确输出 `human_review_items`

## 14. 风险与缓解

### 14.1 文本级判定误报/漏报

风险：

- 简单匹配规则可能误判

缓解：

- 首版仅支持证据清晰的规则
- 对低置信度场景降级为 `medium/low`
- 通过 `human_review_items` 显式暴露不确定性

### 14.2 规则映射不稳定

风险：

- 某些规则难以直接映射到固定子指标

缓解：

- 映射放入 `ruleMapping.ts`
- 未完成映射的规则不直接参与扣分，仅进入复核或风险项

### 14.3 首版范围膨胀

风险：

- 试图一次性做全量高精度规则

缓解：

- 严格限制首版支持规则范围
- 先保证闭环，再逐批扩展

## 15. 后续 AST 演进路径

下一轮引入 AST 规则判定时，按以下方式演进：

1. 在 `ruleMapping.ts` 中将部分规则的 `engine` 切换为 `ast`
2. 新增 AST 证据收集与 AST 判定器
3. 保持 `RuleEngine` 对外输出结构不变
4. 保持 `ScoringEngine`、`SchemaValidator`、工作流节点签名不变

这样可以实现“规则执行能力升级”，而不是“整条评分链路重写”。

## 16. 验收标准

本轮完成后，应满足以下标准：

1. `ruleAuditNode` 输出的台账不再全部固定为 `不涉及`
2. `rule_violations` 与命中的 `不满足` 规则一致
3. `scoringOrchestrationNode` 能输出非空的维度分和子指标详情
4. 总分来自 rubric 汇总，而非硬编码常量
5. 命中 G1/G2/G3/G4 时正确封顶
6. `human_review_items` 能根据规则稳定生成
7. `result.json` 在落盘前通过 schema 校验
8. 集成测试能够验证上述链路
