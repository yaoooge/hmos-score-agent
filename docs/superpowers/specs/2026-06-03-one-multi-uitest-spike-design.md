# 一多 UI 自动化穿刺方案

## 目标

做一个尽量小的本地穿刺，验证一多组件规则能否通过固定 UI 自动化测试产出确定性结果。

本穿刺只接收一个指定的本地 HarmonyOS 工程地址，由启动脚本在该工程上挂载 `List` 和 `Swiper` 的固定测试，执行后生成一个结果 JSON。暂不考虑完整一多规则集整改，不接入现有评分流程，不做云端任务编排，也不做 Web 类规则。

成功目标：

```text
给定一个本地工程地址
  -> 启动脚本识别并准备工程
  -> 挂载 List / Swiper UI 自动化测试
  -> 在可用模拟器或设备上执行测试
  -> 生成 result.json
```

## 非目标

- 不改造整体一多规则集。
- 不接入当前评分工作流。
- 不新增看板展示。
- 不实现云端下发、本机轮询、任务锁或结果回调。
- 不覆盖 Web、Hover、Grid、Tabs、SideBar、WaterFlow、Flex 等规则。
- 不证明所有断点完整覆盖；本穿刺只证明测试链路可运行并产出结构化结果。

## 官方工具假设

本穿刺采用 HarmonyOS 官方推荐的 UI 自动化路径：

- 使用 DevEco Testing Hypium 编写 UI 自动化脚本。
- 使用 DevEco Studio / HarmonyOS SDK / Hvigor / hdc 完成构建、安装、启动和设备交互。
- 使用本地模拟器优先验证，真机也可以作为临时替代。

官方测试服务文档说明 UI 自动化测试可使用 DevEco Testing Hypium，CI/CD 可通过 `run` 命令调用 Hypium 用例。DevEco Testing 也说明 Hypium 支持多形态设备自动化用例编写。因此本穿刺优先研究本地模拟器，不要求 Linux 云端直接运行 UI 自动化。

## 简易规则集

只定义一个临时规则集 `one-multi-ui-spike`，包含三条规则：

| 规则编号 | 来源规则 | 组件 | 检测目标 |
| --- | --- | --- | --- |
| `LIST-001` | `CMP-MUST-01` | `List` | `List` 在不同设备宽度下的可见列数不下降。 |
| `SWIPER-001` | `CMP-MUST-03` | `Swiper` | `Swiper` 在不同设备宽度下的可见元素数不下降。 |
| `SWIPER-002` | `CMP-MUST-04` | `Swiper` | 单元素展示时 indicator 可见，多元素展示时 indicator 不可见。 |

规则编号不超过三段，并按组件归类。后续如果验证链路可行，再扩展其他组件规则。

## 组件 ID 约定

测试脚本只使用固定 ID 定位组件。被测工程需要严格采用以下 ID：

| 组件 | ID |
| --- | --- |
| 主 `List` | `list_001` |
| 代表性 `ListItem` | `list_item_001` |
| 主 `Swiper` | `swiper_001` |
| 代表性 `Swiper` 子项 | `swiper_item_001` |

如果有多个同类组件，后续可递增为 `list_002`、`swiper_002`，但穿刺只要求 `001`。

如果启动脚本发现组件存在但缺少约定 ID，该规则不执行 UI 测试，直接在结果中标记为 `blocked`。

## 模拟器策略

单台真机尺寸固定，不适合验证一多断点变化。本穿刺优先使用本地模拟器，通过不同模拟器 profile 近似不同断点：

| 断点 | 推荐 profile | 说明 |
| --- | --- | --- |
| `sm` | `om_phone_sm` | 手机尺寸模拟器。 |
| `md` | `om_tablet_md` | 平板尺寸模拟器，如本地环境支持。 |
| `lg` | `om_2in1_lg` | 宽屏或 2in1 模拟器，如本地环境支持。 |

第一阶段可以只跑通一个模拟器 profile，结果标记为 `partial`。只有在至少两个 profile 上跑通并能比较测量结果时，才输出完整规则判断。

## 本机环境准备

执行穿刺的本机需要准备：

- Windows 或 macOS。
- DevEco Studio。
- 与被测工程 API 版本匹配的 HarmonyOS SDK。
- DevEco Testing。
- DevEco Testing Hypium。
- 可用的 `hdc` 和 DevEco 命令行工具。
- Node.js、`ohpm`、Hvigor。
- Hypium 所需 Python 环境。
- 至少一个可启动的本地模拟器。
- 推荐预创建模拟器 profile：`om_phone_sm`、`om_tablet_md`、`om_2in1_lg`。

推荐机器资源：

- 内存至少 16 GB，推荐 32 GB。
- 可用磁盘至少 100 GB。

如果模拟器环境不足，穿刺仍可先用真机或单个模拟器验证脚本链路，但结果不得声明完整覆盖一多断点。

## 启动脚本

新增一个启动脚本作为穿刺入口。建议命令形态：

```bash
npm run uitest:spike -- --project /path/to/harmony-project --out /path/to/result.json
```

脚本职责：

1. 校验 `--project` 是否存在。
2. 检查工程中是否包含 HarmonyOS 工程关键文件。
3. 扫描 `.ets` 文件，识别 `List(`、`Swiper(` 和约定 ID。
4. 生成本次要执行的简易规则计划。
5. 将固定 Hypium 测试文件挂载或复制到被测工程的测试目录。
6. 调用构建命令。
7. 选择可用模拟器 profile。
8. 安装并启动应用。
9. 执行 List / Swiper 测试。
10. 归集测试输出、截图和日志。
11. 写出 `result.json`。

脚本只处理一个本地工程，不处理队列，不并发执行。

## 规则触发

穿刺使用最小静态扫描，不依赖完整 rule engine：

| 条件 | 触发规则 |
| --- | --- |
| 扫描到 `List(` 且包含 `list_001` | `LIST-001` |
| 扫描到 `Swiper(` 且包含 `swiper_001` | `SWIPER-001`、`SWIPER-002` |
| 扫描到 `List(` 但缺少 `list_001` | `LIST-001` 输出 `blocked` |
| 扫描到 `Swiper(` 但缺少 `swiper_001` | `SWIPER-001`、`SWIPER-002` 输出 `blocked` |

这个扫描只服务穿刺。后续正式接入时再由现有规则引擎生成 `uiTestPlan`。

## 测试挂载方式

固定测试资产保存在当前评测工程中，例如：

```text
fixtures/uitest-spike/
  hypium/
    list_test.py
    swiper_test.py
  manifest.json
```

启动脚本把这些文件复制或链接到被测工程的测试目录。具体目录由被测工程结构探测得到，探测失败时允许通过参数指定：

```bash
npm run uitest:spike -- \
  --project /path/to/harmony-project \
  --test-dir /path/to/harmony-project/test \
  --out /path/to/result.json
```

穿刺阶段不自动修改业务源码，只依赖用户已经按 ID 契约给组件加好 ID。

## 结果 JSON

输出文件必须包含脚本状态、触发规则、设备 profile、每条规则结果和证据。

示例：

```json
{
  "schemaVersion": "uitest-spike-v1",
  "project": "/path/to/harmony-project",
  "status": "completed",
  "scope": "partial",
  "profiles": ["om_phone_sm"],
  "rules": [
    {
      "ruleId": "LIST-001",
      "component": "List",
      "result": "pass",
      "evidence": {
        "om_phone_sm": {
          "visibleColumns": 1,
          "selector": "list_001"
        }
      }
    },
    {
      "ruleId": "SWIPER-001",
      "component": "Swiper",
      "result": "pass",
      "evidence": {
        "om_phone_sm": {
          "visibleItems": 1,
          "selector": "swiper_001"
        }
      }
    },
    {
      "ruleId": "SWIPER-002",
      "component": "Swiper",
      "result": "pass",
      "evidence": {
        "om_phone_sm": {
          "indicatorVisible": true,
          "selector": "swiper_001"
        }
      }
    }
  ],
  "artifacts": {
    "logs": ["hypium.log"],
    "screenshots": []
  }
}
```

允许的顶层状态：

| 状态 | 含义 |
| --- | --- |
| `completed` | 脚本执行完成并生成规则结果。 |
| `partial` | 只跑通部分 profile 或部分规则。 |
| `failed` | 构建、安装、启动或测试命令失败。 |
| `blocked` | 本机环境不具备执行条件。 |

允许的规则结果：

| 结果 | 含义 |
| --- | --- |
| `pass` | 规则通过。 |
| `fail` | 规则失败。 |
| `not_applicable` | 未命中该组件或该规则不适用。 |
| `blocked` | 命中组件但缺少 ID、缺少设备或无法执行测试。 |

## 验收标准

穿刺完成时需要满足：

- 启动脚本可以接收一个指定的本地工程地址。
- 脚本能识别 `List` 和 `Swiper` 的触发条件。
- 脚本能检测 `list_001`、`list_item_001`、`swiper_001`、`swiper_item_001`。
- 脚本能把固定 Hypium 测试挂载到被测工程。
- 脚本能在至少一个可用模拟器或设备上执行测试命令。
- 脚本能生成结构稳定的 `result.json`。
- 缺少 ID、缺少设备、构建失败、测试失败都能在 JSON 中体现，而不是只在终端报错。
- 不写入现有评分结果，不影响已有评分流程。

## 风险与处理

| 风险 | 处理 |
| --- | --- |
| 本地模拟器 profile 不齐全 | 允许单 profile 跑通，输出 `partial`。 |
| DevEco / Hypium 命令行路径因机器不同而变化 | 启动脚本支持通过配置或环境变量指定工具路径。 |
| Hypium 对组件定位依赖 ID，缺少 ID 会失败 | 缺少 ID 时直接输出 `blocked`，不做猜测定位。 |
| 被测工程测试目录结构不一致 | 自动探测失败时允许显式传入 `--test-dir`。 |
| 单 profile 无法证明断点非递减 | 单 profile 只验证链路，完整规则结论至少需要两个 profile。 |

## 后续扩展

穿刺跑通后再考虑：

- 增加 `GRID-001`、`TABS-*`、`SIDEBAR-*` 等纯 UI 组件规则。
- 把简易扫描替换成现有规则引擎生成的 `uiTestPlan`。
- 接入云端任务下发和本机 Runner 串行执行。
- 接入结果报告和评分流程。
- 最后再评估 Web 类规则。
