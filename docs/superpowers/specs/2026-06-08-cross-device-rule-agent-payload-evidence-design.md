# 一多规则 Agent Payload 证据质量优化设计

## 背景

最新一多规则评测的 `rule-assessment` prompt 已经只向 rule agent 传递 compact 后的 `bootstrap_payload`，不再包含 rubric 噪音。但全量 payload 中仍存在两类问题：

- 部分规则只有 `rule_id`、`why_uncertain` 和 `decision_criteria`，缺少文件、行号、组件、属性和值文本，agent 只能全项目搜索。
- 部分静态预检看似提供了证据，但 `target_file_count` 过大、`representative_files` 泛化，或把 `display`、`aspectRatio` 这类弱 token 当成强适用证据，容易误导 agent。

本设计目标是基于现有静态扫描能力做最小修正：优先修改 `references/rules/cross-device-adaptation.yaml` 和现有 ArkUI 扫描器，不引入复杂 payload 协议，不新增独立规则判定框架。

## 目标

- 进入 rule agent 的规则应有清晰的适用、通过、失败和复核边界。
- 对需要 agent 复核的 ArkUI 组件规则，payload 至少提供命中文件、行号和相关源码片段。
- 没有强证据时，不生成泛化 representative files，也不把弱 token 标成 `all_matched`。
- 保持现有 `decisionCriteria`、`targetChecks`、`review_evidence`、`static_precheck` 字段模型，不扩展复杂 schema。

## 非目标

- 不实现完整 ArkTS/ArkUI AST 语义分析。
- 不调整 ArkTS/性能规则的路由、过滤、判定策略或 payload 结构。
- 不增加新的 agent 输出契约。
- 不要求静态扫描器理解所有封装函数、样式系统和业务布局意图。
- 不把建议类规则强行静态终判。

## 当前扫描能力

现有 `arkui_static` 扫描器已经具备以下能力：

- 建立 `ArkuiComponentInstance` 索引，记录组件名、文件、行号、构造参数、链式属性和父子范围。
- 通过 `readPropertyValue()` 读取构造参数属性和链式属性。
- 通过 `buildPreliminaryData()` 输出 `inspectedComponents`，包含组件位置、属性名、属性行号、`valueText` 和断点表达式信号。
- 对部分封装表达式通过 `shouldDeferInstanceToAgent()` 转 agent。
- 对 review 实例已经能保留匹配位置和 snippets；后续应优先把源码片段传给 agent，而不是额外构造属性摘要。

当前主要缺口不是没有扫描能力，而是部分 manual 规则没有把已有组件证据传给 agent；部分 case constraint precheck 的强弱信号边界过宽。

## 总体方案

采用“小修 scanner + YAML 收敛”的方案。

### 1. Manual 规则输出源码片段

当前 `MANUAL_APPLICABILITY_CHECKS` 分支直接返回 `未接入判定器`，只带 `inspectedComponentCount`。应改为：

- 如果目标组件不存在，返回 `不涉及`，不进入 agent。
- 如果目标组件存在，返回 `未接入判定器`，并附带最多 5 个实例的文件、行号和源码片段。
- 源码片段直接取组件调用附近的小窗口，保留原始代码，不额外拼接属性摘要。

这能覆盖 `Flex`、`Row`、`Column`、`Navigation`、`Scroll`、`WaterFlow`、`GridCol` 等适用性依赖布局意图的规则。

### 2. 弱 token 不再当强命中

`display`、`aspectRatio` 等 token 只能作为阅读入口，不能单独证明规则适用或满足。

- `display` 单独命中时，不得把 Hover 规则标为 `all_matched`。
- `aspectRatio` 单独命中时，只能证明存在已设置比例的组件，不能证明所有需要比例的视觉容器都满足。
- `none_matched` 时不输出泛化 `representative_files`。

### 3. Web 和 Hover 规则收紧入口

Web 和 Hover 规则只有在命中强相关入口时才进入 agent：

- Hover 强入口：`FolderStack`、`FoldSplitContainer`、`foldStatus`、`HALF_FOLDED`、crease/rect/top/height 等折痕区域使用。
- Web 强入口：`Web(`、`runJavaScript`、Web controller、`javaScriptProxy`、本地 Web 资源路径。

只有 `display` 或全项目 ETS 文件，不应触发强候选。

### 4. YAML 判定口径证据化

继续沿用 `decisionCriteria`，但把仍在复述规则名的 pass/fail 改成证据化条件。尤其对已能提供源码片段的规则，criteria 应告诉 agent 如何阅读这些源码片段。

## 规则修改清单

| 规则 | 当前问题 | YAML 修改 | 扫描器修改 |
|---|---|---|---|
| `OM-FLEX-MUST-01` | criteria 已清楚，但无 Flex 命中位置；`llmPrompt` 声称有中间态证据但未给证据 | 补 `kit: ArkUI: Flex / flexGrow / flexShrink`；`targetChecks.llmPrompt` 改为优先检查源码片段中 Flex 子组件职责，无源码时判 review | manual 分支输出 Flex 实例的文件、行号和组件源码片段 |
| `OM-WATERFLOW-SHOULD-02` | 无 WaterFlow 命中，agent 不知道查哪个 `itemConstraintSize` | 补不适用条件：WaterFlow 内容尺寸由父容器或固定等比卡片约束且无瀑布流错位风险时不适用 | manual 分支输出 WaterFlow 实例源码片段 |
| `OM-NAVIGATION-SHOULD-01` | 无 Navigation/Split 证据，无法确认是否适用 | `notApplicable` 改为未发现 Navigation Split/双栏模式或仅单页导航 | 无 Navigation 时直接不涉及；有 Navigation 时输出 Navigation 源码片段 |
| `OM-GRIDCOL-SHOULD-01` | 判断缩进布局但没有 GridCol/offset/margin 证据 | 补仅大屏居中留白布局适用；普通 GridCol 分栏不适用 | 输出 GridCol 及父 GridRow 附近源码片段 |
| `OM-FLEX-SHOULD-01` | 无 Flex 位置，无法判断是否均分工具栏/菜单栏 | `review` 改为无法确认 Flex 子项是否为同类均分项 | 输出 Flex 组件及子组件源码片段 |
| `OM-FLEX-SHOULD-02` | 无 Flex 位置，无法判断固定宽子项是否溢出 | `notApplicable` 改为 Flex 子项数量少、可压缩或已有横向滚动时不适用 | 输出 Flex 组件及子组件源码片段 |
| `OM-ROWCOLUMN-SHOULD-01` | 无 Row/Column 命中，无法判断占比布局 | `notApplicable` 改为 Row/Column 仅自然内容排列、无比例分配诉求时不适用 | 输出 Row/Column 组件及子组件源码片段 |
| `OM-ROWCOLUMN-SHOULD-02` | 无显隐证据，displayPriority 规则难判 | `notApplicable` 改为未发现按断点或尺寸显隐的 Row/Column 子组件 | 只在命中 `visibility/displayPriority/if breakpoint` 等显隐线索时进 agent |
| `OM-SCROLL-SHOULD-01` | 无横向内容证据 | `notApplicable` 改为未发现横向延伸内容或已有 List/Scroll 横向能力 | 输出 Scroll/List/Row 横向相关源码片段；没有横向线索不进 agent |
| `OM-HOVER-MUST-01` | 只命中 `display` 却可能标成 `all_matched` | `notApplicable` 改为未使用 FolderStack/FoldSplitContainer/半折 posture/折痕区域 API 时不适用 | `display` 单独命中降级；命中 Hover 强入口才进入强候选 |
| `OM-HOVER-MUST-02` | 同上，且 NA/review 偏泛化 | 同 `OM-HOVER-MUST-01`，补折痕区域适用边界 | 同上 |
| `OM-HOVER-MUST-04` | `none_matched` 仍给全项目代表文件 | 补未发现 FolderStack 时不适用 | 无 FolderStack 时直接不涉及，不给泛化 representative files |
| `OM-HOVER-MUST-06` | `none_matched` 仍给全项目代表文件 | 补未发现 FoldSplitContainer 时不适用 | 无 FoldSplitContainer 时直接不涉及，不给泛化 representative files |
| `OM-HOVER-SHOULD-01` | `display` 弱 token 容易误判为自定义悬停态 | 补未发现自定义半折/折痕区域计算时不适用 | 只有 `display` 不进 agent；需要 fold/crease/rect/top/height 组合证据 |
| `OM-ASPECTRATIO-SHOULD-01` | 只给已使用 `aspectRatio` 的位置，不能证明缺失 | 补说明：已使用 aspectRatio 不是自动通过，需确认视觉容器需求 | 扫描视觉组件候选，如 Image/Video/XComponent/SwiperImageItem，输出候选源码片段 |
| `OM-ASPECTRATIO-SHOULD-02` | 只命中 aspectRatio，不能证明需要断点变化 | 保留固定比例内容不适用；补无法确认不同比例设计需求时 review | 仅在存在断点布局上下文或 aspectRatio 动态表达式时进 agent |
| `OM-WEB-MUST-02` | 无 Web 组件/资源入口，`none_matched` 仍给全项目文件 | 明确无 Web 组件或无本地 Web 资源时不适用；资源不可见时 review | 只有命中 Web 强入口时进 agent；否则不涉及 |
| `OM-WEB-SHOULD-01` | 无 Web 资源路径，agent 不知读哪里 | 同 Web MUST，补 Web 资源不可见 review | 同上 |
| `OM-WEB-SHOULD-02` | 同上 | 同上 | 同上 |
| `OM-WEB-SHOULD-03` | 同上，且轮播框架多样 | 补无法识别 Web 轮播实现时 review | 同上 |
| `OM-BREAKPOINT-MUST-03` | 未命中 `WidthBreakpoint` 时仍给 183 个文件 | YAML 可保留，必要时补“未发现断点值分发工具时不适用” | 找 `BreakpointUtils/getValue/currentBreakpoint/sm/md/lg/xl` helper；无工具时不涉及 |
| `OM-WATERFLOW-MUST-01` | 有定位证据，但 pass/fail 仍复述规则名 | pass/fail 改为列数表达式能解析为非递减/较大断点列数更小 | 保留定位证据并贴 WaterFlow 源码片段 |
| `OM-GRID-MUST-01` | 同上，且多个 Grid 命中只给首个复核入口 | pass/fail 改为 Grid columnsTemplate 列数序列非递减/递减失败 | 输出最多 5 个 Grid 源码片段 |
| `OM-GRIDCOL-MUST-01` | 有定位证据，但 NA/review 泛化 | 补 GridRow columns 按断点变化时才检查 GridCol 实际占比 | 贴 GridCol 与父 GridRow 附近源码片段 |
| `OM-WATERFLOW-SHOULD-01` | 有 `evidence_files` 但缺源码上下文 | review 改为无法确认动态列数是否需要 SLIDING_WINDOW | 贴 WaterFlow 源码片段 |

## 扫描器实现细节

### Manual 规则源码片段

在 `runArkuiStaticRule()` 的 `MANUAL_APPLICABILITY_CHECKS` 分支中：

1. 查找 `scanIndex.componentInstances` 中目标组件实例。
2. 没有实例时返回 `不涉及`。
3. 有实例时截取最多 5 个实例，记录文件、行号和组件源码片段。
4. 复用现有 snippet/matched snippet 机制即可，不额外构造属性摘要。

示例源码片段证据：

```json
{
  "rule_id": "OM-FLEX-MUST-01",
  "file": "features/home/src/main/ets/pages/Home.ets",
  "line": 42,
  "subject": "Flex",
  "source": "Flex({ justifyContent: FlexAlign.SpaceBetween }) {\n  Text(title).flexGrow(1)\n  Button('更多').flexShrink(0)\n}",
  "question": "请结合子组件职责判断该 Flex 是否为弹性内容区与固定区域并存的拉伸布局。"
}
```

### `static_precheck` 收敛

生成 `static_precheck` 时遵守：

- `none_matched` 不输出 `representative_files`。
- `target_file_count` 保留为扫描规模指标，但不作为阅读入口。
- `matched_tokens` 只记录强锚点或明确标识。弱 token 不应导致 `all_matched`。

### Hover 强弱锚点

Hover 规则锚点分为：

- 强锚点：`FolderStack`、`FoldSplitContainer`、`foldStatus`、`HALF_FOLDED`、`getCurrentFoldCreaseRegion`、crease/rect 使用。
- 弱锚点：单独的 `display`。

只有弱锚点时，规则应倾向 `不涉及` 或 `review`，不得产生 `all_matched`。

### Web 入口

Web 规则只在以下信号出现时进入 agent：

- `Web(` 组件。
- `runJavaScript`、`javaScriptProxy`、Web controller。
- ETS 中可定位的本地 Web 资源路径。

找不到入口时直接 `不涉及`。找到入口但资源不可见时 `review`。

## Payload 质量验收

以 `20260608T071457_case_167600441_d7b23fbc` 这类一多 payload 为验收样本：

- `OM-FLEX-MUST-01` 不再出现“无定位证据 + target 全项目 + 声称有中间态证据”的组合。
- `OM-HOVER-*` 中单独命中 `display` 不再显示 `signal_status=all_matched`。
- `OM-WEB-*` 在没有 Web 入口时不再携带 183 个 ETS 代表文件。
- `OM-ASPECTRATIO-SHOULD-*` 不再仅凭已使用 `aspectRatio` 作为充分阅读证据。
- 有源码片段的规则，每条片段都能把 agent 带到具体文件和行号。

## 测试建议

- 增加 manual 规则源码片段测试：构造 Flex/Navigation/Row/WaterFlow 样例，断言 agent candidate 带文件、行号和源码片段。
- 增加 Hover 弱 token 测试：只有 `display` 时不得 `all_matched`。
- 增加 `none_matched` 测试：不输出 representative files。
- 增加 Web 入口测试：无 `Web(` 时 Web 规则不进 agent 或判不涉及；有 Web controller 但资源不可见时 review。
- 增加 payload 回归测试：从样例 case 生成 prompt，统计高风险组合数量下降。

## 实施顺序

1. 修改 YAML 中仍泛化或复述规则名的 `decisionCriteria` 和 `targetChecks.llmPrompt`。
2. 修改 manual 规则分支，让已有组件实例转为源码片段证据。
3. 调整 Hover/Web/Breakpoint case constraint precheck 的强弱锚点和 representative files 逻辑。
4. 增加 focused tests，确认 payload 证据质量改善。

## 预期收益

这套改动不会让静态扫描器变复杂，但能显著降低 agent 的无效搜索和误导性判定：

- 对有组件实例的规则，agent 能从具体文件行号开始读。
- 对没有强证据的规则，payload 不再制造泛化阅读入口。
- 对适用性依赖强的规则，YAML 明确告诉 agent 何时不适用、何时 review。
- 对一多评测，rule agent 的注意力更集中在真正需要语义判断的候选上。
