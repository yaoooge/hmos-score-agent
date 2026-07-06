# 01_白盒代码评价流程

这一页说明白盒代码评价的输入、证据和产物。样例任务是电视台元服务一多适配，任务类型是 continuation 和 incremental，构建结果为成功。评价输入包括原始工程包、生成后工程、增量补丁、Rubric 评分载荷和规则判定载荷。白盒过程读取二千七百零九行 patch，识别十一个实质变更源码文件，并结合 Code Linter、Rubric Agent 和 Rule Agent 的输出形成证据链。流程从远程任务输入开始，经过沙箱准备、Patch 和工程解析、官方 Code Linter、Rubric 基础评分、规则判定、规则合并、分数融合，最后生成 result.json 和 report.html。

# 02_评分扣分与规则修正

这一页说明最终六十九分的形成过程。Rubric 基础分合计八十八分，主要扣分来自注释处理不一致、contentMaxWidth 的 falsy 逻辑、VideoProgramDetails 中大段重复的 VideoCard 配置、isWideScreen 判断散布在多个组件中、windowSizeChange 监听未注销，以及与一多适配无关的注释和常量清理。规则修正进一步影响评分项，三个断点 MUST 规则分别对 ArkTS/ArkUI 语法与类型安全扣二点一分，并对 ArkTS 约束遵循度扣一点七五分；若干 SHOULD 和官方 linter 规则继续对静态坏味道、性能风险、ArkUI 组织方式和 HarmonyOS 工程实践扣分。规则修正后分数为七十三分，随后 G1 高密度静态错误硬门槛触发，must_rule 不满足数量阈值为二、实际为三，分数上限为六十九分。
