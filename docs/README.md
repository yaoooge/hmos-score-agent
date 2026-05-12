# 文档索引

本目录是 `hmos-score-agent` 的维护文档入口。根目录 README 只保留最小启动信息，具体接口、架构和 agent 契约都在这里维护。

## 建议阅读顺序

| 顺序 | 文档 | 适合场景 |
| --- | --- | --- |
| 1 | [ARCHITECTURE.md](ARCHITECTURE.md) | 先了解代码仓目录结构、主评分 workflow、人工复核和人工评级差异分析流程。 |
| 2 | [apis/README.md](apis/README.md) | 对接管理台、远端任务平台、人工复核页面或接口联调。 |
| 3 | [human-review/README.md](human-review/README.md) | 查看人工复核全流程、重算规则、产物和排查方式。 |
| 4 | [agents/README.md](agents/README.md) | 维护 opencode agent、prompt、skill、权限和输出协议。 |
| 5 | [superpowers/specs/](superpowers/specs/) | 追溯历史需求设计、方案取舍和行为来源。 |
| 6 | [superpowers/plans/](superpowers/plans/) | 追溯历史实现计划和落地步骤。 |

## 文档分类

| 目录或文件 | 内容边界 |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 当前代码结构、运行入口、主评分 workflow、人工侧流程和运行产物。 |
| [apis/](apis/) | 服务对外 HTTP API、请求字段、响应字段、callback 约定。 |
| [human-review/](human-review/) | 人工复核全流程、重算规则、数据集和排查方式。 |
| [agents/](agents/) | 项目内 opencode agent 的职责、调用入口、权限、输入输出契约。 |
| [superpowers/specs/](superpowers/specs/) | 历史设计文档，按日期和主题命名。 |
| [superpowers/plans/](superpowers/plans/) | 历史实现计划，按日期和主题命名。 |

## 维护约定

- 新增或调整外部接口时，同步更新 [apis/README.md](apis/README.md)。
- 调整 workflow 节点、目录职责或运行产物时，同步更新 [ARCHITECTURE.md](ARCHITECTURE.md)。
- 调整 `.opencode/opencode.template.json`、agent prompt 或 skill 时，同步更新 [agents/](agents/)。
- 历史设计和实施计划保留在 `docs/superpowers/`，不作为当前运行说明的唯一来源。
