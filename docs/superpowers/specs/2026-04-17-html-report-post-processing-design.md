# HTML Report Post-Processing Design

## 背景

当前评分链路会在合并打分后生成 `result.json`，并同步产出 `report.html`。现有 HTML 只是将 `result.json` 直接包进 `<pre>` 中，本地浏览体验较差，无法支持快速扫读总分、结论、待复核项和规则审计结果。

本次改造目标是在不改变标准评分结果协议的前提下，为每个用例自动生成一份适合本地人工快速浏览的单文件 HTML 报告，并将该生成动作接入 LangGraph 后处理阶段。

## 目标

- 保持 `result.json` 作为 agent 评分链路的唯一标准输出。
- 为每个用例自动生成简约、清晰、适合本地快速浏览的 `report.html`。
- 在工作流中引入通用后处理节点，为未来扩展人工复核表等衍生产物预留命名与结构空间。
- 保持远端上传协议不变，仍只上传 `result.json`。

## 非目标

- 不修改 `result.json` schema 的对外语义。
- 不引入前端框架、图表库或远程静态资源。
- 不展示原始 JSON。
- 不实现复杂搜索、排序、分页等重交互。

## 用户确认的产品约束

- 主要使用场景：本地人工快速浏览。
- 允许少量前端交互。
- 首屏优先展示总分与结论摘要。
- 维度得分需要完整展示，不做收起。
- 原始 `result.json` 不在页面中展示。
- 后处理节点命名应具备后续扩展空间，不应被 HTML 报告能力绑定。

## 方案概览

采用三层结构：

1. `reportGenerationNode`
   只负责组装和校验标准 `resultJson`。
2. `artifactPostProcessNode`
   基于 `resultJson` 生成本地衍生产物，第一阶段只生成 `htmlReport`。
3. `persistAndUploadNode`
   统一落盘 `result.json` 与 `report.html`，上传仍只以上传 `result.json` 为准。

工作流调整为：

`scoringOrchestrationNode -> reportGenerationNode -> artifactPostProcessNode -> persistAndUploadNode`

## 命名设计

新增节点命名为 `artifactPostProcessNode`。

命名理由：

- 它表达的是“评分结果的后处理产物生成”，而不是“仅生成 HTML 报告”。
- 后续若增加人工复核表、检查清单、摘要卡片等衍生产物，无需再修改工作流节点命名。
- 相比 `reportRenderNode` 或 `htmlReportNode`，该命名对未来扩展更稳定。

## 数据边界

### 标准结果

`resultJson` 继续作为唯一标准结果对象：

- 由 `reportGenerationNode` 生成
- 通过 schema 校验
- 作为上传内容
- 作为所有后处理产物的数据源

### 衍生产物

后处理节点生成的内容属于展示或运营辅助产物，不影响评分协议：

- `htmlReport`
- 后续可扩展：
  - `reviewSheetHtml`
  - `reviewChecklistJson`
  - `summaryCardHtml`

## 页面信息架构

页面按“先结论，后证据”的顺序组织。

### 1. 顶部摘要区

首屏需在尽量少滚动的情况下提供关键结论，包含：

- 总分
- 是否触发硬门禁
- 总体结论摘要
- 用例名
- 任务类型
- 生成时间

摘要区下方包含三个辅助概览：

- 维度得分概览
- 待处理提醒
- 建议动作

其中：

- `维度得分概览` 展示所有维度，不折叠
- `待处理提醒` 汇总人工复核数量、风险数量、规则不满足数量
- `建议动作` 来自 `final_recommendation`

### 2. 维度得分区

完整展示所有维度得分，不做收起。

每个维度包含：

- 维度名称
- 得分 / 满分
- 百分比或进度条
- 维度说明
- 维度评语
- 该维度下的 item 明细

`item` 明细展示：

- 指标名
- 权重
- 得分
- 命中的评分档位
- 置信度
- 是否需要人工复核
- 理由
- 证据

### 3. 待人工复核区

用于集中查看 `human_review_items`。

交互设计：

- 默认展示所有待复核项标题与当前判断
- 可展开查看：
  - 当前判断
  - 不确定原因
  - 建议关注点

如果无待复核项，展示明确空状态，而不是隐藏整个分区。

### 4. 规则审计区

用于展示 `rule_audit_results`。

交互设计：

- 提供状态筛选按钮：
  - `不满足`
  - `待人工复核`
  - `满足`
  - `不涉及`
- 默认优先展示风险更高的状态，可按状态筛选浏览
- 每条规则至少展示：
  - 规则 ID
  - 规则来源
  - 结果状态
  - 结论说明

### 5. 风险与问题区

集中展示：

- `risks`
- `main_issues`

页面需要将高风险项和主要问题与其他普通信息视觉区分，方便快速定位。

### 6. 亮点与建议区

集中展示：

- `strengths`
- `final_recommendation`

作用是帮助阅览者快速理解正向结果和下一步行动建议。

## 视觉与交互原则

### 视觉方向

- 单文件 HTML
- 不依赖外部资源
- 以浅色背景和白色卡片为主
- 一种主色配合状态色，避免视觉噪声
- 强调数字、标签、进度条和留白
- 中文排版优先，风格简约、规整、信息层级清晰

### 交互范围

仅保留轻量交互：

- 顶部锚点导航
- 待人工复核项展开/收起
- 规则审计状态筛选

明确不做：

- 原始 JSON 查看入口
- 图表库
- 复杂表格交互
- 多页结构

## 模块拆分设计

建议新增独立报告渲染模块，位于 `src/report/renderer/` 或等价目录。

### 1. View Model 层

负责将 `resultJson` 转为页面友好的展示模型，并补充页面需要的统计数据，例如：

- 规则状态计数
- 人工复核数量
- 维度百分比
- 顶部摘要标签数据

该层不关心 HTML 细节，只负责整理展示所需数据。

### 2. HTML 渲染层

负责将展示模型渲染为单文件 HTML：

- 内嵌 CSS
- 内嵌少量原生 JS
- 输出完整 HTML 字符串

这样后续新增其他展示型产物时，可复用 view model 或共享部分转换逻辑。

## 工作流改造

### `reportGenerationNode`

保留职责：

- 组装 `resultJson`
- 执行 schema 校验

移除职责：

- 生成 `htmlReport`

### `artifactPostProcessNode`

新增职责：

- 读取 `state.resultJson`
- 调用报告渲染器生成 `htmlReport`
- 为未来其他衍生产物预留统一扩展入口

### `persistAndUploadNode`

保持职责不变：

- 落盘所有中间产物和输出产物
- 上传 `result.json`

## 测试策略

### 现有保障继续保留

- `result.json` schema 校验测试继续保留
- 工作流端到端测试继续确认 `result.json` 合法且可落盘

### 新增测试

#### 报告渲染测试

至少覆盖以下场景：

- 生成的 HTML 包含关键中文标题与摘要字段
- 所有维度都被展示，不因折叠逻辑被隐藏
- 规则状态筛选按钮存在
- 待人工复核项在有数据时正确渲染
- 待人工复核为空时展示空状态
- 生成 HTML 不再是将 `resultJson` 直接包进 `<pre>`

#### 工作流测试更新

需要确认：

- `reportGenerationNode` 仅生成合法 `resultJson`
- `artifactPostProcessNode` 生成 `htmlReport`
- `persistAndUploadNode` 正确写入新的 `outputs/report.html`

## 风险与缓解

### 风险 1：页面渲染和评分协议耦合

缓解：

- 保持 `resultJson` 为唯一标准结果
- 使用独立 view model 和渲染层，不将页面字段反向污染 schema

### 风险 2：页面逻辑过重导致后续难扩展

缓解：

- 控制交互范围在轻量原生 JS
- 将后处理入口抽象为 `artifactPostProcessNode`

### 风险 3：页面对缺省数据处理不佳

缓解：

- 在 view model 层统一处理空数组、缺字段、空状态文本
- 为“无待复核项”“无风险项”“无规则命中”提供明确空状态

## 实施结果判定

完成后应满足以下标准：

- 每个用例执行后都能自动产出 `outputs/result.json` 与 `outputs/report.html`
- `result.json` schema 校验仍通过
- `report.html` 可直接本地打开并清晰展示分层信息
- 报告首屏优先体现总分与结论摘要
- 维度得分完整展示
- 规则区具备状态筛选
- 待人工复核区具备展开查看能力
- 页面不展示原始 JSON
