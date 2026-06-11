# ArkAnalyzer Rule Coverage Matrix

Generated from `listRegisteredRules()` on 2026-06-09. This matrix describes the current migration state after introducing `arkFacts` into `collectEvidence`, ArkTS static evaluator, and ArkUI static evaluator.

## Status Legend

| Status | Meaning |
| --- | --- |
| `facts-partial` | Evaluator can consume `arkFacts`, but current collector/fact schema does not yet cover every semantic field needed by the rule. |
| `facts-gap` | The rule is routed through facts-backed ArkUI scan index, but a known facts loss blocks reliable deterministic judgement. |
| `facts-assisted` | Facts provide candidate components/evidence; Agent remains required for layout intent or applicability. |
| `legacy-or-mixed` | Still primarily depends on source text/config/Web-resource scanning, with possible facts assistance. |
| `legacy-text` | Still uses regex text-pattern evaluator. |
| `legacy-specialized` | Still uses a specialized non-facts evaluator. |
| `agent-assisted` | Static precheck only anchors evidence; Agent remains the real judge. |
| `agent-only` | No static detector is configured. |
| `external` | Owned by an external tool, not ArkAnalyzer migration scope. |
| `unsupported` | Registered rule/check has no current evaluator support. |

## Summary

- Total registered rules: 116
- By detector: arkts_static=14, arkui_extra=2, arkui_static=45, case_constraint_precheck=12, none=9, regex=34
- By coverage: agent-assisted=12, agent-only=9, facts-assisted=9, facts-gap=4, facts-partial=34, legacy-or-mixed=12, legacy-specialized=2, legacy-text=34

## Migration Findings

- ArkAnalyzer is wired into the scoring flow and both ArkTS/ArkUI static evaluators can prefer `evidence.arkFacts`.
- No rule should currently be described as fully migrated to facts-only deterministic judgement. The collector emits a compact scene summary, but many ArkTS semantic facts and ArkUI constructor arguments are still missing.
- The most important ArkUI gap is constructor arguments, especially `GridRow({ columns, breakpoints })`, `GridCol({ span })`, and similar component create arguments. E2E task `6226360` exposed this directly.
- Regex, case-constraint, ArkUI-extra, and no-detector rules remain outside the current facts migration path.

## Full Matrix

| Rule ID | Pack | Detector | Check | Coverage | Current basis | Gap / next action |
| --- | --- | --- | --- | --- | --- | --- |
| ARKTS-MUST-001 | arkts-language | arkts_static | identifier_name_conflict | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | collector 目前只稳定产出 class/struct/method 名称，变量/函数/接口/枚举/命名空间不足。 |
| ARKTS-MUST-002 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-MUST-003 | arkts-language | none | - | agent-only | 规则定义没有静态 detector。 | 需要设计 facts 或保留 Agent 判定。 |
| ARKTS-MUST-004 | arkts-language | arkts_static | class_interface_heritage | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | collector 尚未产出 extends/implements。 |
| ARKTS-MUST-005 | arkts-language | none | - | agent-only | 规则定义没有静态 detector。 | 需要设计 facts 或保留 Agent 判定。 |
| ARKTS-MUST-006 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-MUST-007 | arkts-language | none | - | agent-only | 规则定义没有静态 detector。 | 需要设计 facts 或保留 Agent 判定。 |
| ARKTS-MUST-008 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-MUST-009 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-MUST-010 | arkts-language | none | - | agent-only | 规则定义没有静态 detector。 | 需要设计 facts 或保留 Agent 判定。 |
| ARKTS-SHOULD-001 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-SHOULD-002 | arkts-language | arkts_static | esobject_usage_scope | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | collector 尚未产出声明类型文本。 |
| ARKTS-SHOULD-003 | arkts-language | arkts_static | class_as_value | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | collector 尚未产出变量声明和 initializer。 |
| ARKTS-SHOULD-004 | arkts-language | none | - | agent-only | 规则定义没有静态 detector。 | 需要设计 facts 或保留 Agent 判定。 |
| ARKTS-SHOULD-005 | arkts-language | arkts_static | type_name_upper_camel | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | 可覆盖 class/struct，接口/枚举/命名空间仍缺。 |
| ARKTS-SHOULD-006 | arkts-language | arkts_static | value_name_lower_camel | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | 可覆盖 method 名称，变量/函数/参数仍缺。 |
| ARKTS-SHOULD-007 | arkts-language | arkts_static | constant_enum_upper_snake | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | collector 尚未产出 enum member 和顶层 const。 |
| ARKTS-SHOULD-008 | arkts-language | arkts_static | boolean_name_prefix | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | collector 尚未产出 boolean 类型信息。 |
| ARKTS-SHOULD-009 | arkts-language | arkts_static | spacing_style | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | 格式空格不是当前 ArkAnalyzer facts 事实，仍需文本扫描。 |
| ARKTS-SHOULD-010 | arkts-language | arkts_static | class_property_access_modifier | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | collector 尚未产出字段和访问修饰符。 |
| ARKTS-SHOULD-011 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-001 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-002 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-003 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-004 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-005 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-006 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-007 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-008 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-009 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-010 | arkts-language | arkts_static | object_literal_class_initialization | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | collector 尚未产出对象字面量初始化事实。 |
| ARKTS-FORBID-011 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-012 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-013 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-014 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-015 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-016 | arkts-language | arkts_static | enum_namespace_restrictions | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | collector 尚未产出 enum/namespace 及 enum initializer。 |
| ARKTS-FORBID-017 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-018 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-019 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-020 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-021 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-022 | arkts-language | arkts_static | enum_namespace_restrictions | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | collector 尚未产出 enum/namespace 及 enum initializer。 |
| ARKTS-FORBID-023 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-024 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-FORBID-025 | arkts-language | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-PERF-SHOULD-001 | arkts-performance | arkts_static | let_never_reassigned | facts-partial | ArkTS evaluator 已优先消费 arkFacts。 | collector 尚未产出变量声明和赋值事实。 |
| ARKTS-PERF-SHOULD-002 | arkts-performance | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-PERF-SHOULD-003 | arkts-performance | none | - | agent-only | 规则定义没有静态 detector。 | 需要设计 facts 或保留 Agent 判定。 |
| ARKTS-PERF-SHOULD-004 | arkts-performance | none | - | agent-only | 规则定义没有静态 detector。 | 需要设计 facts 或保留 Agent 判定。 |
| ARKTS-PERF-SHOULD-005 | arkts-performance | none | - | agent-only | 规则定义没有静态 detector。 | 需要设计 facts 或保留 Agent 判定。 |
| ARKTS-PERF-SHOULD-006 | arkts-performance | none | - | agent-only | 规则定义没有静态 detector。 | 需要设计 facts 或保留 Agent 判定。 |
| ARKTS-PERF-FORBID-001 | arkts-performance | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-PERF-FORBID-002 | arkts-performance | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-PERF-FORBID-003 | arkts-performance | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-PERF-FORBID-004 | arkts-performance | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKTS-PERF-FORBID-005 | arkts-performance | regex | - | legacy-text | 仍由 text-pattern regex evaluator 判定。 | 尚未迁移为 AST/facts；部分语法类规则可后续映射到 ArkTS facts。 |
| ARKUI-MUST-001 | arkui-extra | arkui_extra | route_navdestination | legacy-specialized | 仍由 ArkUI extra 专用 evaluator 判定。 | routerMap/NavDestination、bindSheet 链式调用尚未迁移为 facts。 |
| ARKUI-FORBID-001 | arkui-extra | arkui_extra | multi_bindsheet_same_component | legacy-specialized | 仍由 ArkUI extra 专用 evaluator 判定。 | routerMap/NavDestination、bindSheet 链式调用尚未迁移为 facts。 |
| OM-CONFIG-MUST-01 | cross-device-adaptation | arkui_static | module_device_types_multi_device | legacy-or-mixed | 该 check 主要依赖源码文本、配置文件或 Web 资源扫描。 | ArkAnalyzer facts 只能辅助组件存在性，不能替代文本/配置证据。 |
| OM-BREAKPOINT-MUST-01 | cross-device-adaptation | arkui_static | breakpoint_ranges_standard | facts-partial | 该 check 可复用 ArkUI component scan index，scan index 现在可由 facts 构建。 | constructor args/复杂属性仍可能不完整。 |
| OM-BREAKPOINT-MUST-02 | cross-device-adaptation | arkui_static | breakpoint_no_hardcoded_width | legacy-or-mixed | 该 check 主要依赖源码文本、配置文件或 Web 资源扫描。 | ArkAnalyzer facts 只能辅助组件存在性，不能替代文本/配置证据。 |
| OM-BREAKPOINT-MUST-03 | cross-device-adaptation | case_constraint_precheck | - | agent-assisted | case constraint precheck 提供静态锚点，最终依赖 Agent/规则描述。 | 尚未接入 ArkAnalyzer facts；适用性和语义证据较强依赖源码上下文。 |
| OM-BREAKPOINT-MUST-04 | cross-device-adaptation | arkui_static | breakpoint_source_standard | legacy-or-mixed | 该 check 主要依赖源码文本、配置文件或 Web 资源扫描。 | ArkAnalyzer facts 只能辅助组件存在性，不能替代文本/配置证据。 |
| OM-BREAKPOINT-MUST-05 | cross-device-adaptation | arkui_static | breakpoint_listener_source_standard | legacy-or-mixed | 该 check 主要依赖源码文本、配置文件或 Web 资源扫描。 | ArkAnalyzer facts 只能辅助组件存在性，不能替代文本/配置证据。 |
| OM-BREAKPOINT-MUST-06 | cross-device-adaptation | arkui_static | breakpoint_listener_after_load_content | legacy-or-mixed | 该 check 主要依赖源码文本、配置文件或 Web 资源扫描。 | ArkAnalyzer facts 只能辅助组件存在性，不能替代文本/配置证据。 |
| OM-GRIDROW-MUST-01 | cross-device-adaptation | arkui_static | gridrow_breakpoints_standard | facts-gap | 组件 GridRow 已能从 facts 建索引。 | 当前 collector/adapter 对 constructor args 保留不足，E2E 已暴露 GridRow/GridCol 参数缺失。 |
| OM-LIST-MUST-01 | cross-device-adaptation | arkui_static | list_lanes_non_decreasing | facts-partial | 组件 List 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-WATERFLOW-MUST-01 | cross-device-adaptation | arkui_static | waterflow_columns_template_non_decreasing | facts-partial | 组件 WaterFlow 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-SWIPER-MUST-01 | cross-device-adaptation | arkui_static | swiper_display_count_non_decreasing | facts-partial | 组件 Swiper 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-SWIPER-MUST-02 | cross-device-adaptation | arkui_static | swiper_indicator_by_display_count | facts-partial | 组件 Swiper 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-SWIPER-MUST-03 | cross-device-adaptation | arkui_static | swiper_margins_for_multi_display | facts-partial | 组件 Swiper 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-GRID-MUST-01 | cross-device-adaptation | arkui_static | grid_columns_template_non_decreasing | facts-partial | 组件 Grid 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-SIDEBAR-MUST-01 | cross-device-adaptation | arkui_static | sidebar_show_by_breakpoint | facts-partial | 组件 SideBarContainer 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-SIDEBAR-MUST-02 | cross-device-adaptation | arkui_static | sidebar_width_by_breakpoint | facts-partial | 组件 SideBarContainer 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-SIDEBAR-MUST-03 | cross-device-adaptation | arkui_static | sidebar_type_by_breakpoint | facts-gap | 组件 SideBarContainer 已能从 facts 建索引。 | 当前 collector/adapter 对 constructor args 保留不足，E2E 已暴露 GridRow/GridCol 参数缺失。 |
| OM-TABS-MUST-01 | cross-device-adaptation | arkui_static | tabs_vertical_by_breakpoint | facts-partial | 组件 Tabs 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-TABS-MUST-02 | cross-device-adaptation | arkui_static | tabs_bar_position_by_breakpoint | facts-partial | 组件 Tabs 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-TABS-MUST-03 | cross-device-adaptation | arkui_static | tabs_bar_size_by_breakpoint | facts-partial | 组件 Tabs 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-GRIDROW-MUST-02 | cross-device-adaptation | arkui_static | gridrow_columns_non_decreasing | facts-gap | 组件 GridRow 已能从 facts 建索引。 | 当前 collector/adapter 对 constructor args 保留不足，E2E 已暴露 GridRow/GridCol 参数缺失。 |
| OM-GRIDCOL-MUST-01 | cross-device-adaptation | arkui_static | gridcol_span_by_breakpoint | facts-gap | 组件 GridCol 已能从 facts 建索引。 | 当前 collector/adapter 对 constructor args 保留不足，E2E 已暴露 GridRow/GridCol 参数缺失。 |
| OM-FLEX-MUST-01 | cross-device-adaptation | arkui_static | flex_grow_shrink_required | facts-assisted | 组件 Flex 可由 facts 提供候选，适用性仍交 Agent。 | 适用场景依赖布局意图，无法仅靠结构事实稳定判定。 |
| OM-HOVER-MUST-01 | cross-device-adaptation | case_constraint_precheck | - | agent-assisted | case constraint precheck 提供静态锚点，最终依赖 Agent/规则描述。 | 尚未接入 ArkAnalyzer facts；适用性和语义证据较强依赖源码上下文。 |
| OM-HOVER-MUST-02 | cross-device-adaptation | case_constraint_precheck | - | agent-assisted | case constraint precheck 提供静态锚点，最终依赖 Agent/规则描述。 | 尚未接入 ArkAnalyzer facts；适用性和语义证据较强依赖源码上下文。 |
| OM-HOVER-MUST-03 | cross-device-adaptation | arkui_static | folderstack_fullscreen | facts-partial | 该 check 可复用 ArkUI component scan index，scan index 现在可由 facts 构建。 | constructor args/复杂属性仍可能不完整。 |
| OM-HOVER-MUST-04 | cross-device-adaptation | case_constraint_precheck | - | agent-assisted | case constraint precheck 提供静态锚点，最终依赖 Agent/规则描述。 | 尚未接入 ArkAnalyzer facts；适用性和语义证据较强依赖源码上下文。 |
| OM-HOVER-MUST-05 | cross-device-adaptation | arkui_static | folderstack_upper_items_ids | facts-partial | 该 check 可复用 ArkUI component scan index，scan index 现在可由 facts 构建。 | constructor args/复杂属性仍可能不完整。 |
| OM-HOVER-MUST-06 | cross-device-adaptation | case_constraint_precheck | - | agent-assisted | case constraint precheck 提供静态锚点，最终依赖 Agent/规则描述。 | 尚未接入 ArkAnalyzer facts；适用性和语义证据较强依赖源码上下文。 |
| OM-HOVER-MUST-07 | cross-device-adaptation | arkui_static | custom_hover_fold_and_landscape | legacy-or-mixed | 该 check 主要依赖源码文本、配置文件或 Web 资源扫描。 | ArkAnalyzer facts 只能辅助组件存在性，不能替代文本/配置证据。 |
| OM-HOVER-MUST-08 | cross-device-adaptation | arkui_static | custom_hover_crease_region_api | legacy-or-mixed | 该 check 主要依赖源码文本、配置文件或 Web 资源扫描。 | ArkAnalyzer facts 只能辅助组件存在性，不能替代文本/配置证据。 |
| OM-HOVER-MUST-09 | cross-device-adaptation | arkui_static | custom_hover_fold_listener_cleanup | legacy-or-mixed | 该 check 主要依赖源码文本、配置文件或 Web 资源扫描。 | ArkAnalyzer facts 只能辅助组件存在性，不能替代文本/配置证据。 |
| OM-WEB-MUST-01 | cross-device-adaptation | arkui_static | web_container_size_by_breakpoint | facts-partial | 该 check 可复用 ArkUI component scan index，scan index 现在可由 facts 构建。 | constructor args/复杂属性仍可能不完整。 |
| OM-WEB-MUST-02 | cross-device-adaptation | case_constraint_precheck | - | agent-assisted | case constraint precheck 提供静态锚点，最终依赖 Agent/规则描述。 | 尚未接入 ArkAnalyzer facts；适用性和语义证据较强依赖源码上下文。 |
| OM-WEB-MUST-03 | cross-device-adaptation | arkui_static | web_breakpoint_sync_source | legacy-or-mixed | 该 check 主要依赖源码文本、配置文件或 Web 资源扫描。 | ArkAnalyzer facts 只能辅助组件存在性，不能替代文本/配置证据。 |
| OM-WEB-MUST-04 | cross-device-adaptation | arkui_static | web_media_query_breakpoints_standard | legacy-or-mixed | 该 check 主要依赖源码文本、配置文件或 Web 资源扫描。 | ArkAnalyzer facts 只能辅助组件存在性，不能替代文本/配置证据。 |
| OM-WEB-MUST-05 | cross-device-adaptation | arkui_static | web_vertical_breakpoint_aspect_ratio | legacy-or-mixed | 该 check 主要依赖源码文本、配置文件或 Web 资源扫描。 | ArkAnalyzer facts 只能辅助组件存在性，不能替代文本/配置证据。 |
| OM-LIST-SHOULD-01 | cross-device-adaptation | arkui_static | list_space_by_breakpoint | facts-partial | 组件 List 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-LIST-SHOULD-02 | cross-device-adaptation | arkui_static | list_divider_by_lanes | facts-partial | 组件 List 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-WATERFLOW-SHOULD-01 | cross-device-adaptation | arkui_static | waterflow_sliding_window_mode | facts-partial | 组件 WaterFlow 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-WATERFLOW-SHOULD-02 | cross-device-adaptation | arkui_static | waterflow_item_constraint_size | facts-assisted | 组件 WaterFlow 可由 facts 提供候选，适用性仍交 Agent。 | 适用场景依赖布局意图，无法仅靠结构事实稳定判定。 |
| OM-NAVIGATION-SHOULD-01 | cross-device-adaptation | arkui_static | navigation_nav_bar_width_required | facts-assisted | 组件 Navigation 可由 facts 提供候选，适用性仍交 Agent。 | 适用场景依赖布局意图，无法仅靠结构事实稳定判定。 |
| OM-GRIDROW-SHOULD-01 | cross-device-adaptation | arkui_static | gridrow_gutter_required | facts-partial | 组件 GridRow 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-GRIDCOL-SHOULD-01 | cross-device-adaptation | arkui_static | gridcol_offset_required | facts-assisted | 组件 GridCol 可由 facts 提供候选，适用性仍交 Agent。 | 适用场景依赖布局意图，无法仅靠结构事实稳定判定。 |
| OM-GRIDROW-SHOULD-02 | cross-device-adaptation | arkui_static | gridrow_no_dynamic_constraint_size_centering | legacy-or-mixed | 该 check 主要依赖源码文本、配置文件或 Web 资源扫描。 | ArkAnalyzer facts 只能辅助组件存在性，不能替代文本/配置证据。 |
| OM-FLEX-SHOULD-01 | cross-device-adaptation | arkui_static | flex_space_evenly_required | facts-assisted | 组件 Flex 可由 facts 提供候选，适用性仍交 Agent。 | 适用场景依赖布局意图，无法仅靠结构事实稳定判定。 |
| OM-FLEX-SHOULD-02 | cross-device-adaptation | arkui_static | flex_wrap_required | facts-assisted | 组件 Flex 可由 facts 提供候选，适用性仍交 Agent。 | 适用场景依赖布局意图，无法仅靠结构事实稳定判定。 |
| OM-ROWCOLUMN-SHOULD-01 | cross-device-adaptation | arkui_static | row_column_layout_weight_required | facts-assisted | 组件 Row 可由 facts 提供候选，适用性仍交 Agent。 | 适用场景依赖布局意图，无法仅靠结构事实稳定判定。 |
| OM-ROWCOLUMN-SHOULD-02 | cross-device-adaptation | arkui_static | row_column_display_priority_required | facts-assisted | 组件 Row 可由 facts 提供候选，适用性仍交 Agent。 | 适用场景依赖布局意图，无法仅靠结构事实稳定判定。 |
| OM-ROWCOLUMN-SHOULD-03 | cross-device-adaptation | arkui_static | blank_spacing_required | facts-partial | 组件 Blank 的 modifier 属性可由 facts 提供，opaque 表达式会转 Agent。 | 复杂表达式、状态变量解析和源码行号仍有限。 |
| OM-SCROLL-SHOULD-01 | cross-device-adaptation | arkui_static | horizontal_scroll_required | facts-assisted | 组件 Scroll 可由 facts 提供候选，适用性仍交 Agent。 | 适用场景依赖布局意图，无法仅靠结构事实稳定判定。 |
| OM-ASPECTRATIO-SHOULD-01 | cross-device-adaptation | case_constraint_precheck | - | agent-assisted | case constraint precheck 提供静态锚点，最终依赖 Agent/规则描述。 | 尚未接入 ArkAnalyzer facts；适用性和语义证据较强依赖源码上下文。 |
| OM-ASPECTRATIO-SHOULD-02 | cross-device-adaptation | case_constraint_precheck | - | agent-assisted | case constraint precheck 提供静态锚点，最终依赖 Agent/规则描述。 | 尚未接入 ArkAnalyzer facts；适用性和语义证据较强依赖源码上下文。 |
| OM-HOVER-SHOULD-01 | cross-device-adaptation | case_constraint_precheck | - | agent-assisted | case constraint precheck 提供静态锚点，最终依赖 Agent/规则描述。 | 尚未接入 ArkAnalyzer facts；适用性和语义证据较强依赖源码上下文。 |
| OM-WEB-SHOULD-01 | cross-device-adaptation | case_constraint_precheck | - | agent-assisted | case constraint precheck 提供静态锚点，最终依赖 Agent/规则描述。 | 尚未接入 ArkAnalyzer facts；适用性和语义证据较强依赖源码上下文。 |
| OM-WEB-SHOULD-02 | cross-device-adaptation | case_constraint_precheck | - | agent-assisted | case constraint precheck 提供静态锚点，最终依赖 Agent/规则描述。 | 尚未接入 ArkAnalyzer facts；适用性和语义证据较强依赖源码上下文。 |
| OM-WEB-SHOULD-03 | cross-device-adaptation | case_constraint_precheck | - | agent-assisted | case constraint precheck 提供静态锚点，最终依赖 Agent/规则描述。 | 尚未接入 ArkAnalyzer facts；适用性和语义证据较强依赖源码上下文。 |
