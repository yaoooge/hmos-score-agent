# Agent 过程评价的行业实现洞察报告

日期：2026-05-27

## 摘要

当前业界对 agent 的评价正在从“只看最终输出”转向“结果 + 过程 + 成本 + 风险”的组合评价。原因很直接：agent 的最终产物可能看起来正确，但过程里可能发生了错误工具选择、无效重试、跳过验证、越权操作、隐性副作用、成本浪费或不可复现的侥幸路径。对于代码生成类 agent，仅评价生成代码会遗漏 agent 如何通过 skills、tools、shell、文件系统、测试、补丁、审核器等一系列动作得到结果。

行业里比较成熟的做法不是孤立地发明一个“过程分”，而是先建立完整 trace，再在 trace 上叠加 trajectory eval、规则检查、LLM-as-judge、人工标注和回归数据集。OpenAI、LangSmith/AgentEvals、Arize/Phoenix、MLflow、Braintrust、Langfuse、DeepEval、Ragas、Docker Agent 等生态都在朝这个方向发展。

对当前 `hmos-score-agent` 这类评分系统来说，值得借鉴的不是某一个工具，而是这条链路：

```text
执行轨迹采集 -> 轨迹标准化 -> 规则型过程检查 -> golden trajectory 回归 -> LLM judge 软评价 -> 人工抽样校准 -> 趋势监控
```

## 1. 为什么只做结果评价不够

传统用例评价通常回答一个问题：最终结果是否满足目标？例如代码是否编译、测试是否通过、规则是否违规、最终得分是多少。这对 deterministic workflow 足够，但对 agent 不够。

Agent 的行为有几个特征：

- 它通过多步交互完成任务，包含 LLM reasoning、tool calls、skills、文件读写、命令执行、测试、网络调用等。
- 它的过程具有不确定性，同一个输入在不同模型、prompt、tool schema、上下文状态下可能走出不同路径。
- 它可能以错误方式得到正确结果，例如跳过必要验证、误用工具、重复尝试、利用脏状态或产生隐藏副作用。
- 它的失败往往不是最终一步导致的，而是中间某个错误选择逐步传播。
- 成本、时延、重试、工具错误率本身也是产品质量的一部分。

Arize 的 agent trajectory evaluation 文档对此有一个很典型的判断：即使最终答案正确，糟糕的步骤序列也可能浪费时间和成本，甚至暴露风险；单个 span 或最终响应评价会漏掉步骤之间的错误。参考：[Arize Agent Trajectory Evaluations](https://arize.com/docs/ax/evaluate/evaluators/trace-and-session-evals/trace-level-evaluations/agent-trajectory-evaluations)。

这意味着，对 agent 的评价对象应该从：

```text
case input -> final generated code
```

扩展为：

```text
case input -> agent trajectory -> artifacts -> final generated code -> score
```

## 2. 行业共识：trace 是过程评价的基础设施

几乎所有成熟实现都把 trace 作为第一层基础设施。没有 trace，就无法稳定地评价过程。

一个 agent trace 通常包含：

- root run：一次任务执行或一次对话。
- span hierarchy：LLM 调用、tool 调用、检索、文件操作、子 agent、workflow node 等。
- 输入输出：用户输入、模型消息、tool arguments、tool results、最终输出。
- 元数据：模型名、prompt 版本、tool schema、skill 版本、case id、环境信息。
- 运行指标：耗时、token、cost、重试次数、错误码、退出码。
- 状态变化：文件 diff、数据库写入、外部 API 副作用、审批记录。

OpenAI 的 trace grading 将 trace 定义为 agent 决策、工具调用和推理步骤的端到端日志，并在这个日志上打结构化分数或标签。参考：[OpenAI Trace Grading](https://developers.openai.com/api/docs/guides/trace-grading)。

LangChain 的 AgentEvals 也明确把 eval 定义为评价 agent 的 execution trajectory，即消息和 tool calls 的序列，并支持 deterministic match 和 LLM-as-judge。参考：[LangChain Agent Evals](https://docs.langchain.com/oss/python/langchain/test/evals)。

MLflow 的 GenAI trace 评价则强调 trace 是 LLM 应用完整执行流，可对生产 trace 做离线复评，减少重复运行带来的计算和 LLM 成本。参考：[MLflow Evaluating Production Traces](https://mlflow.org/docs/latest/genai/eval-monitor/running-evaluation/traces/)。

## 3. 标准化趋势：OpenTelemetry 与 OpenInference

行业里越来越明显的趋势是：不要用随意 JSON 记录 agent 过程，而是尽量靠近 OpenTelemetry / OpenInference 这类 span 语义。

OpenTelemetry 已经在 GenAI semantic conventions 中定义了 agent invocation、tool execution、tool definitions、conversation id 等语义。例如 `invoke_agent` 用于描述 agent 调用，tool definitions 可以作为 agent/model 可用工具列表被记录。参考：[OpenTelemetry GenAI agent spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)。

OpenInference 是建立在 OpenTelemetry 之上的 AI 应用可观测性语义规范，覆盖 trace 结构、span 层级、LLM spans、tool calling 等。它的价值在于让不同框架和平台产出的 trace 能够被统一消费。参考：[OpenInference Specification](https://arize-ai.github.io/openinference/spec/)。

这背后的行业判断是：agent eval 不应该被绑死在某个 agent framework。评价系统应该能吃 LangChain、OpenAI Agents SDK、LlamaIndex、CrewAI、AutoGen、自研 orchestrator 或 Codex-like runner 的 trace。

对代码生成评分系统而言，尤其应该把这些对象一等化：

- `agent_run`
- `skill_invocation`
- `tool_call`
- `shell_command`
- `file_read`
- `file_write`
- `patch_apply`
- `test_run`
- `review_or_judge`
- `final_artifact`

## 4. 主流实现范式

### 4.1 轨迹匹配：deterministic trajectory match

这是最直接、成本最低的过程评价方式：为某类 case 定义期望工具轨迹，然后比较实际轨迹。

常见匹配模式：

- strict：工具调用顺序、结构必须一致。
- unordered：工具集合一致，顺序无关。
- subset：实际调用不能超出允许工具集合。
- superset：必须包含关键工具，允许额外工具。
- argument-aware：不仅比较工具名，还比较关键参数。
- output-aware：进一步比较工具输出是否满足后续决策需要。

LangChain AgentEvals 就提供了 strict、unordered、subset、superset 等 trajectory match 模式。参考：[LangChain Agent Evals](https://docs.langchain.com/oss/python/langchain/test/evals)。

适用场景：

- 关键流程必须发生，例如“修改代码后必须运行测试”。
- 合规流程必须发生，例如“危险操作前必须检查权限或审批”。
- 工具选择有明确答案，例如“需要读项目配置时必须调用文件读取/搜索工具”。
- 回归测试，例如模型或 prompt 升级后不应跳过关键步骤。

局限：

- 对开放任务太僵硬，容易误杀合理的新路径。
- 无法判断“不同路径是否更好”。
- 维护 golden trajectory 有成本。

### 4.2 工具正确性：tool correctness / tool call accuracy

很多 eval 框架把过程评价的第一步收敛到 tool use 评价：是否调用了正确工具，是否少调用、多调用、参数是否正确。

DeepEval 的 Tool Correctness metric 会比较 expected tools 与 actual tools，并可配置严格程度，默认看工具名，也可以要求输入参数和输出匹配。参考：[DeepEval Tool Correctness](https://deepeval.com/docs/metrics-tool-correctness)。

Ragas 对 agent/tool use 提供 Tool Call Accuracy、Tool Call F1、Agent Goal Accuracy 等指标。参考：[Ragas Agentic or Tool Use Metrics](https://docs.ragas.io/en/v0.4.1/concepts/metrics/available_metrics/agents/)。

这类指标很适合作为自动化基础分：

```text
tool_precision = 正确调用的工具数 / 实际调用的工具数
tool_recall    = 正确调用的工具数 / 期望调用的工具数
tool_f1        = precision 与 recall 的调和平均
```

但它只能覆盖“工具是否对”，不能覆盖“过程是否聪明、是否安全、是否高效”。

### 4.3 规则型过程评价：policy / invariant checks

生产系统里最先落地的通常不是 LLM judge，而是规则型评价。它便宜、稳定、可解释，适合作为红线。

典型规则包括：

- 必须项：修改代码后必须运行相关测试。
- 禁止项：不得调用危险命令、不得访问非授权路径、不得上传敏感文件。
- 顺序项：先理解任务，再修改代码；先收集证据，再声明成功。
- 参数项：tool arguments 必须满足 schema 和业务约束。
- 预算项：tool 调用次数、耗时、token、重试次数不能超阈值。
- 重复项：相同工具相同参数重复调用超过 N 次视为低效。
- 错误处理项：tool 失败后必须采取恢复动作，不能直接忽略。
- 证据项：最终结论必须关联测试结果、日志或 diff。

这类规则跟传统 lint 很像，但 lint 的对象从“代码”变成了“agent 行为日志”。

### 4.4 LLM-as-judge 轨迹评价

LLM judge 适合评价“过程质量”这种难以规则化的维度。例如：

- 工具选择是否合理。
- 中间步骤是否推进了问题解决。
- 是否有无意义绕路。
- 是否根据工具返回调整策略。
- 是否识别并处理失败。
- 是否在不确定时过度自信。
- 是否遵守用户意图和系统约束。

Arize/Phoenix 的实现方式是：从 trace 中抽取有序 tool calls，把 trajectory、用户输入、工具定义、可选 reference outputs 交给 LLM judge，输出 correct/incorrect 及解释。参考：[Arize Agent Trajectory Evaluations](https://arize.com/docs/ax/evaluate/evaluators/trace-and-session-evals/trace-level-evaluations/agent-trajectory-evaluations)。

OpenAI 的 trace grading 也是类似方向：在 trace 上打结构化标签或分数，用于识别 agent 哪里做得好、哪里犯错。参考：[OpenAI Trace Grading](https://developers.openai.com/api/docs/guides/trace-grading)。

局限也很明显：

- LLM judge 本身会不稳定。
- judge 可能偏好“看起来合理”的轨迹，而不是实际有效的轨迹。
- judge 成本高，不适合对所有生产 trace 全量执行。
- 对代码 agent 的工具输出、diff、测试日志理解可能有盲点。

因此业内通常把 LLM judge 放在第二层：先用规则和统计信号筛选，再对高价值样本做 judge。

### 4.5 行为回归：replay + behavior drift

Docker Agent 的 eval 文档体现了另一个务实方向：保存一次对话或 agent run，后续 replay 同样输入，看行为是否变化。它强调这类 eval 衡量的是一致性，不直接代表正确性；分数下降表示行为变了，需要人工判断变好还是变坏。参考：[Docker Agent Evals](https://docs.docker.com/ai/docker-agent/evals/)。

这种方式对 agent 非常重要。因为很多回归不是最终分数立刻下降，而是：

- 原来会运行测试，现在不运行。
- 原来会读约束文件，现在凭空猜。
- 原来只改一个文件，现在改了很多无关文件。
- 原来一次成功，现在多次重试才成功。
- 原来调用本地工具，现在调用网络或慢工具。

这类漂移可以通过 trajectory diff 捕捉。

### 4.6 人工标注与校准

业内越来越清楚：LLM judge 不能无校准地替代人。AgentRewardBench 针对 web agent trajectory 自动评价做了研究，指出规则方法难扩展且可能低估成功率；人工评价更准但慢；LLM judge 更灵活但没有单一 judge 在所有 benchmark 上都最好。参考：[AgentRewardBench](https://arxiv.org/abs/2504.08942)。

合理做法是：

- 抽样人工看 trace。
- 标注成功、失败、风险、副作用、重复、关键失败步骤。
- 用人工标签校准规则阈值和 LLM judge prompt。
- 监控 judge 与人工的一致率。
- 对高风险 case 保留人工复核。

AgentProcessBench 也反映了研究界对 step-level process quality 的关注：它包含人工标注的工具增强轨迹，用来评价每一步是否有效，并指出“中性步骤”和“错误步骤”的区分对当前模型仍有挑战。参考：[AgentProcessBench](https://arxiv.org/abs/2603.14465)。

## 5. 产品和框架版图

### OpenAI

重点是 trace grading、agent workflows eval、datasets/eval runs。适合把 workflow trace 转成结构化评价，并逐步沉淀可重复数据集。它代表了“先观察 trace，再 formalize grader，再进入 eval dataset”的路径。

### LangSmith / AgentEvals

重点是 agent trajectory evaluation、trajectory match、LLM-as-judge、和 LangChain/LangGraph 生态集成。它代表了“开发期和 CI 回归期的 agent trajectory eval”路径。

### Arize / Phoenix / OpenInference

重点是 trace observability、OpenInference span schema、trace-level trajectory evaluator、生产监控。它代表了“生产 trace + evaluator + dashboard”的路径。

### MLflow

重点是 GenAI tracing、production trace evaluation、tracking server、scorers。它代表了“传统 MLOps 平台向 GenAI/agent eval 扩展”的路径，强调 trace 可复用、可离线评价。

### Braintrust

重点是 eval、logging、trace viewer、span 类型、score span、human review。其文档把 trace 看作端到端 execution，每个 span 可表示 task、llm、function、tool、score 等，适合把 eval 结果和执行过程放在一起分析。参考：[Braintrust Examine Traces](https://www.braintrust.dev/docs/observe/examine-traces)。

### Langfuse

重点是开源 LLM observability、tracing、scores、datasets、prompt management、成本监控。它通常被用于先看清每次调用和多步链路，再在 trace 或 observation 上加 score。参考：[Langfuse Metrics Overview](https://langfuse.com/docs/metrics/overview/)。

### DeepEval / Confident AI

重点是 pytest-like eval framework、agentic metrics、tool correctness、task completion、step efficiency、argument correctness、plan adherence 等。适合快速补齐离线指标。

### Ragas

从 RAG eval 扩展到 agent/tool use 指标，适合在已有 RAG/agent 数据集上加 tool call accuracy、F1、goal accuracy。

## 6. 业内常见指标体系

一个成熟 agent 过程评价体系通常不是单分，而是多维度面板。

### 6.1 工具选择类

- expected tool recall
- unexpected tool rate
- tool precision / recall / F1
- forbidden tool usage
- missing required tool
- tool argument correctness
- tool schema violation rate

### 6.2 轨迹结构类

- critical path coverage
- step order correctness
- plan adherence
- branch appropriateness
- redundant step rate
- loop/retry rate
- early termination rate
- recovery after failure rate

### 6.3 验证与证据类

- test execution coverage
- validation-before-final rate
- evidence-linked conclusion rate
- assertion-without-evidence rate
- ignored tool error rate

### 6.4 成本效率类

- tool calls per successful case
- LLM calls per successful case
- token per successful case
- wall-clock latency
- retry count
- duplicate call ratio
- expensive tool usage rate

### 6.5 安全与副作用类

- unauthorized path access
- destructive command attempt
- external network access
- sensitive data exposure
- unapproved write operation
- side-effect reversibility
- human approval bypass

### 6.6 稳定性与回归类

- trajectory similarity score
- tool drift rate
- parameter drift rate
- output shape drift
- flake rate across repeated runs
- model/prompt/tool-version regression

## 7. 研究界趋势

研究界的方向也在从 outcome-only 往 process-aware 转。

WebArena、AgentBench、tau-bench 等 benchmark 推动了“在交互环境中评价 agent”的范式。WebArena 强调真实 web 环境里的长程任务成功率；AgentBench 将 agent 评估形式化为多环境、多轮决策；tau-bench 更接近真实客服/业务工具调用场景。

但新的研究开始指出，仅看最终状态仍然不足：

- AgentRewardBench 关注 web agent trajectory 的自动评价可靠性。
- AgentProcessBench 专门评价 tool-using agent 的 step-level effectiveness。
- 近年的 trace diagnosis / issue localization 研究关注如何从长轨迹定位关键失败步骤。
- Plan adherence 相关研究开始评估 coding agent 是否遵循计划，而不是只看是否修好 bug。

这说明“过程评价”不是工程平台的小功能，而是在成为 agent 可靠性研究的核心对象。

## 8. 行业实践中的几个关键洞察

### 洞察 1：trace visibility 不等于 process evaluation

能看到 trace 只是第一步。很多团队装了 Langfuse、LangSmith 或 Phoenix 后，仍然需要人工盯 trace。真正有价值的是在 trace 上自动打标签、打分、聚类和归因。

换句话说：

```text
observability tells what happened
evaluation tells whether it was good
diagnosis tells why it failed
```

### 洞察 2：规则和 LLM judge 是互补关系

规则适合红线、预算、schema、顺序、强制验证。LLM judge 适合开放质量、策略合理性、失败归因。只用规则会僵硬，只用 judge 会不稳。

### 洞察 3：golden trajectory 应该只覆盖关键路径

不要试图为所有 case 写完整标准轨迹。更合理的是标注关键里程碑：

```text
must_read_constraints -> must_edit_relevant_files -> must_run_validation -> must_report_evidence
```

这样既能抓回归，又不会压制 agent 找到更优路径。

### 洞察 4：过程评价要区分“变化”和“好坏”

trajectory diff 只能说明行为变了，不能自动说明变差。Docker Agent 文档对此说得很清楚：eval 衡量一致性，不直接衡量正确性。工程上应把 drift 当作 review trigger，而不是直接当作 failure。

### 洞察 5：过程分不能简单惩罚“步骤多”

有些任务需要探索。盲目压低 tool call count 会鼓励 agent 少验证、少读上下文。更合理的是评价“每一步是否提供新信息或降低不确定性”。

### 洞察 6：对代码 agent，验证行为是核心过程信号

代码任务里，最重要的过程信号往往不是“调用了哪个搜索工具”，而是：

- 是否理解了用例约束。
- 是否只修改相关文件。
- 是否运行了合适测试。
- 测试失败后是否定位根因。
- 是否把最终结论绑定到测试和 diff。
- 是否避免破坏用户未要求修改的文件。

## 9. 对 hmos-score-agent 的启发

当前系统已有评分、规则、报告、workflow observability 等模块。下一步如果要评价 agent 过程，可以先把“过程评价”定位为现有结果评价的补充，而不是替代。

建议的分析对象：

```text
case_run
  ├─ input/task understanding
  ├─ agent/skill/tool trajectory
  ├─ generated artifacts
  ├─ validation attempts
  ├─ final code result
  └─ scoring result
```

可以优先沉淀这些基础事件：

- `skill_invoked`
- `tool_invoked`
- `tool_result`
- `shell_command_started`
- `shell_command_finished`
- `file_changed`
- `patch_generated`
- `test_started`
- `test_finished`
- `agent_finalized`
- `score_generated`

初期不要追求复杂 judge，先做高信号规则：

- 修改代码但没有运行任何验证：高风险。
- tool 失败后直接 final：高风险。
- 同一 shell 命令重复失败超过阈值：低效或卡死。
- 生成代码后没有引用 diff/test 证据：结论可信度低。
- 大量无关文件变更：过程污染。
- 评分 agent 与执行 agent 使用同一份不隔离上下文：评价污染风险。
- 最终结果合格但过程存在 forbidden action：结果分不能完全覆盖风险。

中期再做 trajectory 维度：

- 建立关键路径模板，而不是完整路径模板。
- 对不同 case 类型设置 required milestones。
- 对 tool/skill 序列做 similarity 和 drift。
- 把 drift case 送人工 review 或 LLM judge。

长期可以形成四层分数：

```text
final_result_score      最终代码/用例结果
process_compliance      是否遵守必要流程与红线
process_quality         路径是否合理、有效、可恢复
efficiency_stability    成本、时延、重试、漂移、flake
```

## 10. 推荐的行业化落地路径

### 第一阶段：可观测

目标：先能完整复盘一次 agent run。

动作：

- 统一 run id / case id / trace id。
- 记录 skill/tool/shell/file/test 事件。
- 保留 tool args 和结果摘要。
- 记录耗时、退出码、错误、成本。
- 将 trace 与最终评分结果关联。

### 第二阶段：规则过程评价

目标：抓明显过程问题。

动作：

- 建立 rule pack。
- 输出 process findings。
- 在报告里展示关键过程风险。
- 将风险映射到扣分或人工复核。

### 第三阶段：trajectory regression

目标：捕捉 agent 行为漂移。

动作：

- 为高价值 case 保存参考轨迹或关键里程碑。
- 比较工具序列、参数、验证行为。
- 将 drift 作为回归信号。
- 区分“变了”和“变坏”。

### 第四阶段：LLM judge 与人工校准

目标：评价开放过程质量。

动作：

- 只对抽样、高风险、drift case 运行 judge。
- judge 输出结构化标签：good / neutral / bad / risky / inefficient。
- 人工抽样校准 judge。
- 建立 disagreement set 改进 prompt/rubric。

### 第五阶段：生产监控与闭环

目标：从离线评分走向持续质量运营。

动作：

- 统计过程指标趋势。
- 监控 tool error、retry、latency、cost。
- 从线上失败 trace 自动生成新 eval case。
- 将人工 review 结果反哺规则和 judge。

## 11. 风险与注意事项

### 隐私与数据安全

Trace 里可能包含源码、用户输入、凭据、命令输出、文件路径、内部接口返回。需要脱敏、采样、权限控制和保留策略。

### 评价污染

如果评分 agent 能看到执行 agent 的不可见推理或无关上下文，可能导致评价偏差。建议只评价可审计事件、工具输入输出、artifact 和验证证据。

### 过度拟合过程

如果把参考轨迹写得太死，会让 agent 为了匹配过程而牺牲结果和创新路径。关键路径约束优于完整轨迹约束。

### LLM judge 幻觉

Judge 可能误判工具结果、误解代码 diff、或被漂亮解释影响。高风险结论需要规则证据或人工校准。

### 成本膨胀

全量 trace + 全量 judge 会很贵。行业常见做法是：全量记录轻量指标，抽样保存重 trace，条件触发 judge。

## 12. 结论

行业对 agent 过程评价的共识可以概括为：

```text
先 trace，后 eval；
先规则，后 judge；
先关键路径，后完整诊断；
先发现漂移，再判断好坏；
先人工校准，再自动扩展。
```

对于当前代码生成评分场景，最有价值的不是马上设计一个复杂过程评分公式，而是先把 agent 的 skills/tools 执行过程结构化记录下来，并把最确定的过程红线纳入评分报告。这样既能解释“为什么同样结果分的 case 质量不同”，也能为后续 golden trajectory、LLM judge、人工复核和持续监控打基础。

## 参考资料

- [OpenAI Trace Grading](https://developers.openai.com/api/docs/guides/trace-grading)
- [OpenAI Agent Evals](https://developers.openai.com/api/docs/guides/agent-evals)
- [LangChain Agent Evals](https://docs.langchain.com/oss/python/langchain/test/evals)
- [Arize Agent Trajectory Evaluations](https://arize.com/docs/ax/evaluate/evaluators/trace-and-session-evals/trace-level-evaluations/agent-trajectory-evaluations)
- [OpenInference Specification](https://arize-ai.github.io/openinference/spec/)
- [OpenTelemetry GenAI Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
- [MLflow Evaluating Production Traces](https://mlflow.org/docs/latest/genai/eval-monitor/running-evaluation/traces/)
- [Braintrust Examine Traces](https://www.braintrust.dev/docs/observe/examine-traces)
- [Langfuse Metrics Overview](https://langfuse.com/docs/metrics/overview/)
- [DeepEval Tool Correctness](https://deepeval.com/docs/metrics-tool-correctness)
- [Ragas Agentic or Tool Use Metrics](https://docs.ragas.io/en/v0.4.1/concepts/metrics/available_metrics/agents/)
- [Docker Agent Evals](https://docs.docker.com/ai/docker-agent/evals/)
- [AgentRewardBench: Evaluating Automatic Evaluations of Web Agent Trajectories](https://arxiv.org/abs/2504.08942)
- [AgentProcessBench: Diagnosing Step-Level Process Quality in Tool-Using Agents](https://arxiv.org/abs/2603.14465)
- [AgentBench: Evaluating LLMs as Agents](https://arxiv.org/abs/2308.03688)
- [WebArena: A Realistic Web Environment for Building Autonomous Agents](https://arxiv.org/abs/2307.13854)
