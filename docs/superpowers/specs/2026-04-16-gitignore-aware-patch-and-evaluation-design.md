# 基于 `.gitignore` 的 Patch 生成与代码评测过滤设计

## 1. 背景

当前工程已经具备两类与文件采集相关的能力：

- 基于 `original/` 与 `workspace/` 目录生成 `diff/changes.patch`
- 基于 `workspace`、`original`、`patch` 采集代码证据并执行规则评测

但当前实现存在同一个根因引发的两个问题：

1. patch 生成阶段只依赖硬编码忽略名单，未读取 `original/.gitignore` 与 `workspace/.gitignore`
2. 代码评测阶段直接递归扫描 `workspace` 全目录，未应用 `.gitignore` 过滤

这会导致编译产物、缓存文件、日志文件等本应被忽略的内容：

- 进入 patch 生成输入
- 进入规则评测证据集
- 造成错误的规则命中与评分污染

因此，本轮需要在 patch 生成与代码评测两个入口上统一接入 `.gitignore` 感知能力，确保文件采集边界与真实工程语义保持一致。

## 2. 目标

本轮实现目标如下：

1. patch 生成时分别读取 `original/.gitignore` 和 `workspace/.gitignore`，各自过滤对应目录。
2. 代码评测时，采集 `workspace` 证据时使用 `workspace/.gitignore` 过滤，采集 `original` 文件清单时使用 `original/.gitignore` 过滤。
3. patch 生成与代码评测复用同一套 ignore 匹配能力，避免规则分叉。
4. 即使 `.gitignore` 缺失、读取失败或包含当前版本不支持的复杂规则，流程仍应继续执行，并回退到系统级保底忽略项。
5. 通过测试证明：被 `.gitignore` 命中的文件不能进入 patch，也不能进入规则评测证据集。

## 3. 非目标

本轮明确不做以下事项：

- 不实现 Git 完整的全部 `.gitignore` 语义
- 不递归解析子目录中的局部 `.gitignore`
- 不支持 `!` 反向包含的完整行为
- 不支持 `**` 等全部高级通配规则
- 不改变 patch 输出格式
- 不改变 `result.json` schema
- 不重构为 AST 级文件扫描器

## 4. 设计原则

### 4.1 一处实现，双处复用

`.gitignore` 过滤能力必须抽成独立工具模块，供 patch 生成与证据采集统一复用，避免：

- patch 生成忽略一套规则
- 代码评测再忽略另一套规则

### 4.2 双侧目录独立解析

`original/` 与 `workspace/` 必须各自读取自己根目录下的 `.gitignore`，不能让一侧规则投射到另一侧。

### 4.3 快速落地优先

当前版本优先覆盖最常见、最容易污染评分结果的场景：

- 编译产物目录
- 缓存目录
- 日志文件
- 常见文件通配符

不以“完整还原 Git 所有匹配语义”为目标。

### 4.4 回退优先于失败

`.gitignore` 过滤是边界增强能力，不应成为新的工作流失败点。无论文件缺失、读取失败还是规则超范围，都应该回退到保底忽略策略继续执行。

## 5. 总体方案

### 5.1 新增统一 Ignore 过滤模块

建议新增独立模块，例如：

- `src/io/gitignoreMatcher.ts`

职责包括：

- 读取指定目录根下的 `.gitignore`
- 解析当前版本支持的规则
- 判断相对路径是否应被忽略
- 在目录遍历时统一过滤目录和文件

### 5.2 两类忽略来源

过滤规则由两部分组成：

#### A. 系统级保底忽略项

继续保留一组稳定的硬编码规则，例如：

- `.git`
- `.agent_bench`
- `.hvigor`
- `build`
- `node_modules`
- `oh_modules`
- `oh-package-lock.json5`
- `*.log`

这些规则在没有 `.gitignore` 时仍然生效。

#### B. 根级 `.gitignore`

分别读取：

- `original/.gitignore`
- `workspace/.gitignore`

并将其解析为该目录自己的附加忽略规则。

## 6. 规则支持范围

### 6.1 当前版本支持

当前版本建议支持以下规则：

- 空行忽略
- 注释行忽略
- 目录模式，例如 `build/`
- 文件模式，例如 `*.log`
- 相对路径模式，例如 `entry/build`
- 简单 `*` 通配

### 6.2 当前版本不支持

以下规则当前版本明确不支持：

- `!` 反向包含
- `**` 深度通配
- 子目录局部 `.gitignore`
- Git 的全部边缘路径匹配行为

对于不支持的规则：

- 不中断流程
- 不报致命错误
- 忽略无法解析的复杂语法
- 在日志中记录“按简化规则解析”

## 7. Patch 生成改造

### 7.1 当前问题

当前 `patchGenerator` 在复制目录树到临时目录时，只使用固定 `IGNORED_NAMES` 过滤，未感知 `.gitignore`。

### 7.2 目标行为

在 patch 生成时：

- `original/` 复制时使用 `original/.gitignore`
- `workspace/` 复制时使用 `workspace/.gitignore`

这样生成的临时目录会只包含“真实参与对比的文件”，最终 `git diff --no-index` 输出的 patch 自然不会包含已忽略产物。

### 7.3 影响边界

该改造只影响输入筛选，不改变：

- `git diff --no-index` 的调用方式
- patch 的 unified diff 输出格式
- `diff/changes.patch` 落盘路径

## 8. 代码评测改造

### 8.1 当前问题

当前 `evidenceCollector` 直接递归收集 `workspace` 全目录中的所有文件，并读取内容形成 `workspaceFiles`，导致编译产物也进入规则引擎。

### 8.2 目标行为

在代码评测时：

- 采集 `workspaceFiles` 时使用 `workspace/.gitignore`
- 采集 `originalFiles` 时使用 `original/.gitignore`

这样进入规则引擎的证据集只包含“应参与评测的源码与资源文件”。

### 8.3 影响结果

规则评测的输入边界将与 patch 输入边界保持一致，避免出现：

- patch 没包含某文件，但规则评测扫到了它
- patch 忽略某文件，但评分被该文件误命中

## 9. 日志与可观测性

建议在日志中记录以下信息：

- 是否检测到 `.gitignore`
- 使用了哪一侧目录的 `.gitignore`
- `.gitignore` 读取失败时的回退行为
- 检测到复杂规则但按简化规则忽略解析

如果当前阶段不希望额外增加日志文件字段，也至少要保留 `run.log` 中的关键提示，便于定位过滤是否生效。

## 10. 失败回退策略

### 10.1 `.gitignore` 不存在

直接回退到系统级保底忽略项。

### 10.2 `.gitignore` 读取失败

记录日志，继续使用系统级保底忽略项。

### 10.3 `.gitignore` 含不支持规则

仅应用可识别规则，忽略复杂规则，继续执行。

### 10.4 过滤模块内部异常

如果出现单次匹配异常，应优先保护主流程：

- patch 生成继续执行
- 规则评测继续执行
- 但要回退到保底忽略逻辑，并记录错误

## 11. 数据与接口设计

建议提供统一接口，例如：

```ts
export interface IgnoreFilter {
  isIgnored(relativePath: string, kind: "file" | "directory"): boolean;
}

export async function loadIgnoreFilter(rootDir: string): Promise<IgnoreFilter>;
```

也可以提供更高层的遍历接口，例如：

```ts
export async function collectVisibleFiles(rootDir: string): Promise<string[]>;
```

关键要求不是具体 API 名称，而是：

- patch 生成与证据采集必须消费同一套能力
- 不要在两个调用点里各写一份遍历 + 匹配逻辑

## 12. 测试策略

### 12.1 Patch 生成测试

新增测试用例：

- `workspace/.gitignore` 包含 `build/`、`*.log`
- `workspace/build/output.js` 存在规则命中内容
- `workspace/debug.log` 存在内容
- `workspace/src/main.ets` 为真实业务文件

期望：

- patch 中不包含 `build/output.js`
- patch 中不包含 `debug.log`
- patch 中保留真实业务源码改动

同时验证：

- `original/.gitignore` 的忽略规则只作用于 `original/`

### 12.2 Evidence Collector 测试

新增测试用例：

- `workspace/.gitignore` 忽略编译产物
- `workspace` 下同时存在源码文件和产物文件

期望：

- `workspaceFiles` 不包含被忽略产物
- `summary.workspaceFileCount` 只统计可见文件
- 真实源码仍被采集

### 12.3 规则评测集成测试

新增工作流级测试：

- 编译产物文件内容会命中某条规则
- 真实源码文件不命中该规则
- 编译产物被 `.gitignore` 忽略

期望：

- 规则结果不再因产物文件而误报
- `rule_audit_results` 只基于未忽略文件生成

## 13. 验证标准

本轮修复完成的判定标准是：

“任何被对应目录根级 `.gitignore` 命中的文件，都不能进入 patch 生成输入，也不能进入规则评测证据集。”

## 14. 实现范围建议

为了快速落地，当前第一版实现范围建议控制为：

1. 只支持根级 `.gitignore`
2. 只支持常见目录模式、文件模式和简单通配
3. patch 与评测统一复用一套 ignore 逻辑
4. 失败时统一回退到保底忽略项
5. 先补齐 patch、evidence、rule workflow 三层测试

这样可以在不引入复杂 Git 语义模拟器的前提下，先解决当前最直接的误报问题。
