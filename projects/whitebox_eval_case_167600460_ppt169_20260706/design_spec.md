# whitebox_eval_case_167600460 - Design Spec

## I. Project Information

| Item | Value |
| ---- | ----- |
| **Project Name** | whitebox_eval_case_167600460 |
| **Canvas Format** | PPT 16:9 (1280x720) |
| **Page Count** | 2 |
| **Design Style** | General Consulting + light technical review brief |
| **Target Audience** | 技术负责人、评测平台研发、质量与交付管理人员 |
| **Use Case** | 说明白盒代码评价的输入输出、流程、评分标准和样例扣分链路 |
| **Created Date** | 2026-07-06 |

---

## II. Canvas Specification

| Property | Value |
| -------- | ----- |
| **Format** | PPT 16:9 |
| **Dimensions** | 1280x720 |
| **viewBox** | `0 0 1280 720` |
| **Margins** | left/right 56px, top 48px, bottom 36px |
| **Content Area** | 1168x636 |

---

## III. Visual Theme

### Theme Style

- **Style**: Light corporate technical briefing, based on the referenced PPT template color mood.
- **Theme**: Light theme.
- **Tone**: objective, audit-oriented, evidence-first, structured.

### Color Scheme

| Role | HEX | Purpose |
| ---- | --- | ------- |
| **Background** | `#FFFFFF` | Page background |
| **Secondary bg** | `#F7F7F5` | Large panels and table bands |
| **Primary** | `#C7000A` | Main emphasis, section numbers, critical rule markers |
| **Accent** | `#F26B43` | Secondary highlights and progress accents |
| **Secondary accent** | `#E9002F` | Hard gate and warning emphasis |
| **Body text** | `#1D1D1B` | Main text |
| **Secondary text** | `#666666` | Captions and supporting labels |
| **Tertiary text** | `#919191` | Footer and meta labels |
| **Border/divider** | `#D9D9D9` | Card borders and divider lines |
| **Soft border** | `#EDEDED` | Light table and flow borders |
| **Success** | `#2E7D32` | Pass states |
| **Warning** | `#C7000A` | Violations and hard gate |

---

## IV. Typography System

### Font Plan

**Typography direction**: CJK-first business sans with monospace code/path labels.

| Role | Chinese | English | Fallback tail |
| ---- | ------- | ------- | ------------- |
| **Title** | `"Microsoft YaHei", "PingFang SC"` | `Arial` | `sans-serif` |
| **Body** | `"Microsoft YaHei", "PingFang SC"` | `Arial` | `sans-serif` |
| **Emphasis** | `"Microsoft YaHei", "PingFang SC"` | `Arial` | `sans-serif` |
| **Code** | - | `Consolas, "Courier New"` | `monospace` |

**Per-role font stacks**:

- Title: `"Microsoft YaHei", "PingFang SC", Arial, sans-serif`
- Body: `"Microsoft YaHei", "PingFang SC", Arial, sans-serif`
- Emphasis: `"Microsoft YaHei", "PingFang SC", Arial, sans-serif`
- Code: `Consolas, "Courier New", monospace`

### Font Size Hierarchy

**Baseline**: Body font size = 17px.

| Purpose | Size | Weight |
| ------- | ---- | ------ |
| Page title | 34px | Bold |
| Section label | 15px | Semibold |
| Panel title | 20px | Bold |
| Body content | 17px | Regular |
| Dense table text | 13px | Regular |
| Annotation / caption | 12px | Regular |
| Hero number | 44px | Bold |

---

## V. Layout Principles

### Page Structure

- **Header area**: 48-118px, title, subtitle, and page metadata.
- **Content area**: 118-662px, flow diagram on page 1 and score breakdown table on page 2.
- **Footer area**: 662-704px, case id and concise source note.

### Spacing Specification

| Element | Current Project |
| ------- | --------------- |
| Safe margin from canvas edge | 56px |
| Content block gap | 24px |
| Icon-text gap | 10px |
| Card gap | 16px |
| Card padding | 18px |
| Card border radius | 6px |

---

## VI. Icon Usage Specification

### Source

- **Built-in icon library**: `tabler-outline`
- **Stroke width**: 2
- **Usage method**: SVG placeholder `<use data-icon="tabler-outline/icon-name" .../>`

### Recommended Icon List

| Purpose | Icon Path | Page |
| ------- | --------- | ---- |
| Input artifacts | `tabler-outline/file-import` | P01 |
| Evidence parsing | `tabler-outline/file-diff` | P01 |
| Static checks | `tabler-outline/checklist` | P01 |
| Rule agent | `tabler-outline/shield-search` | P01 |
| Score fusion | `tabler-outline/chart-bar` | P01, P02 |
| Final report | `tabler-outline/report-analytics` | P01 |
| Violation | `tabler-outline/alert-triangle` | P02 |
| Hard gate | `tabler-outline/shield-exclamation` | P02 |

---

## VII. Visualization Reference List

No external chart templates are used. The deck uses custom SVG-native flow blocks, score bars, and a compact correction table.

---

## VIII. Image Resource List

No raster images are used. All visuals are native SVG shapes, text, and icons.

---

## IX. Content Outline

### Slide 01 - 白盒代码评价的输入、证据与流程

- **Layout**: Header + three-column input/evidence/output summary + horizontal workflow.
- **Title**: 白盒代码评价流程：以电视台元服务一多适配为例
- **Core message**: 本样例评价流程把远程任务、增量补丁、静态检查、规则判定和评分结果组织为一条可追溯的证据链。
- **Content**:
  - Case: `.local-cases/20260608T105703_case_167600460_dbee0885`
  - Task ID: `167600460`; test case: `local电视台元服务完成一多适配（一句话描述）`
  - 输入包括原始工程包、生成后工程、增量补丁、Rubric 评分载荷、规则判定载荷。
  - 白盒证据包括 2709 行 patch、11 个实质变更源码文件、Code Linter 结果、Rule Agent 候选规则判定。
  - 流程节点: 远程任务输入, 沙箱准备, Patch/工程解析, 官方 Code Linter, Rubric Agent, Rule Agent, 规则合并, 分数融合, 报告生成。

### Slide 02 - 打分标准、扣分点与规则修正

- **Layout**: Left score waterfall + right correction table + bottom hard gate strip.
- **Title**: 评分结果拆解：Rubric 基础分、规则修正与硬门槛
- **Core message**: 本样例总分由 Rubric 基础分 88、规则修正约 -14.8、硬门槛 G1 封顶共同形成，最终分数为 69。
- **Content**:
  - Rubric 基础分: 88; 规则修正后: 73; G1 封顶后: 69。
  - Rubric 扣分点包括注释处理不一致、`contentMaxWidth` 的 falsy 逻辑、`VideoCard` 重复配置、`isWideScreen` 分散、监听未注销、无关改动混入。
  - 规则修正覆盖 `OM-BREAKPOINT-MUST-02`、`OM-BREAKPOINT-MUST-04`、`OM-BREAKPOINT-MUST-03`、`ARKTS-SHOULD-010`、`ARKTS-PERF-SHOULD-001`、`OM-WATERFLOW-SHOULD-01`、`OFFICIAL-LINTER:@cross-device-app-dev/color-value`。
  - G1 触发策略: must_rule 不满足数量阈值 2, 实际 3; 分数上限 69。

---

## X. Speaker Notes Plan

- P01 notes explain the case input, evidence extraction scope, and workflow sequence.
- P02 notes explain the score arithmetic, rubric-level deductions, rule-level score deltas, and G1 cap.

---

## XI. Technical Constraints

- SVG output must use `viewBox="0 0 1280 720"`.
- Use only colors listed in `spec_lock.md`.
- Use only `tabler-outline` icons listed in `spec_lock.md`.
- Do not use external images.
- Keep all text editable in PowerPoint where possible.
