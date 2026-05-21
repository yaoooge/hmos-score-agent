from __future__ import annotations

import html
import zipfile
from datetime import datetime, timezone
from pathlib import Path


OUT = Path("hmos-score-agent-architecture-summary.pptx")
SLIDE_W = 13_333_333
SLIDE_H = 7_500_000
EMU = 914400


def emu(value: float) -> int:
    return int(round(value * EMU))


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def color(value: str) -> str:
    return value.replace("#", "").upper()


def tx_body(text: str, size: int, fill: str, bold: bool = False, align: str = "l") -> str:
    parts = [
        '<p:txBody><a:bodyPr wrap="square" rtlCol="0"/><a:lstStyle/>'
    ]
    for line in text.split("\n"):
        parts.append(f'<a:p><a:pPr algn="{align}"/>')
        if line:
            b = ' b="1"' if bold else ""
            parts.append(
                f'<a:r><a:rPr lang="zh-CN" sz="{size * 100}" dirty="0"{b}>'
                f'<a:solidFill><a:srgbClr val="{color(fill)}"/></a:solidFill>'
                '<a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/>'
                f'</a:rPr><a:t>{esc(line)}</a:t></a:r>'
            )
        parts.append("</a:p>")
    parts.append("</p:txBody>")
    return "".join(parts)


def shape(
    sid: int,
    name: str,
    x: float,
    y: float,
    w: float,
    h: float,
    text: str,
    fill: str,
    line: str,
    size: int,
    text_fill: str,
    bold: bool = False,
    align: str = "l",
    round_rect: bool = True,
) -> str:
    geom = "roundRect" if round_rect else "rect"
    return (
        f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{esc(name)}"/>'
        '<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>'
        f'<a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm>'
        f'<a:prstGeom prst="{geom}"><a:avLst/></a:prstGeom>'
        f'<a:solidFill><a:srgbClr val="{color(fill)}"/></a:solidFill>'
        f'<a:ln w="12700"><a:solidFill><a:srgbClr val="{color(line)}"/></a:solidFill></a:ln>'
        "</p:spPr>"
        + tx_body(text, size, text_fill, bold=bold, align=align)
        + "</p:sp>"
    )


def textbox(
    sid: int,
    name: str,
    x: float,
    y: float,
    w: float,
    h: float,
    text: str,
    size: int,
    fill: str,
    bold: bool = False,
    align: str = "l",
) -> str:
    return (
        f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{esc(name)}"/>'
        '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>'
        f'<a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>'
        "</p:spPr>"
        + tx_body(text, size, fill, bold=bold, align=align)
        + "</p:sp>"
    )


def arrow(sid: int, name: str, x1: float, y1: float, x2: float, y2: float, line: str = "#64748B") -> str:
    x = min(x1, x2)
    y = min(y1, y2)
    w = abs(x2 - x1)
    h = abs(y2 - y1)
    flip_h = ' flipH="1"' if x2 < x1 else ""
    flip_v = ' flipV="1"' if y2 < y1 else ""
    return (
        f'<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="{sid}" name="{esc(name)}"/>'
        '<p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>'
        f'<a:xfrm{flip_h}{flip_v}><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm>'
        '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>'
        f'<a:ln w="14000"><a:solidFill><a:srgbClr val="{color(line)}"/></a:solidFill><a:tailEnd type="triangle"/></a:ln>'
        '</p:spPr></p:cxnSp>'
    )


def slide_base() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F8FAFC"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>'
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
        '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
    )


def title(slide: list[str], main: str, sub: str = "") -> None:
    slide.append(textbox(2, "Title", 0.55, 0.28, 8.8, 0.45, main, 24, "#0F172A", True))
    if sub:
        slide.append(textbox(3, "Subtitle", 0.58, 0.73, 11.2, 0.28, sub, 9, "#64748B"))


def footer(slide: list[str], page: str) -> None:
    slide.append(textbox(999, "Footer", 11.7, 7.02, 0.7, 0.2, page, 8, "#94A3B8", False, "r"))


def slide1() -> str:
    s = [slide_base()]
    title(s, "HarmonyOS 评分服务：分层架构", "从 API 接入、评分中心、规则/Agent 能力到产物和分析闭环")
    rows = [
        ("应用领域层", "远端评分 API / 本地 CLI / Dashboard / 人工复核", "#E0F2FE", "#0284C7"),
        ("业务中心层", "评分中心 / 规则中心 / 人工中心 / 分析中心", "#DCFCE7", "#16A34A"),
        ("能力平台层", "opencode runtime / 任务队列 / registry / artifact store / callback", "#FEF3C7", "#D97706"),
        ("技术底座层", "Node.js / TypeScript / Express / LangGraph / AJV / Vue / hvigor", "#F1F5F9", "#475569"),
    ]
    y = 1.05
    for idx, (left, right, fill, line) in enumerate(rows, start=10):
        s.append(shape(idx, left, 0.45, y, 1.55, 0.82, left, fill, line, 13, line, True, "l"))
        s.append(shape(idx + 20, right, 2.1, y, 10.5, 0.82, right, "FFFFFF", "CBD5E1", 10, "#1F2937", False, "l"))
        y += 0.95
    s.append(shape(70, "Agents", 0.55, 5.05, 5.9, 1.1,
                   "4 个 opencode agent / skill\n"
                   "hmos-understanding：提取约束和分类 hints\n"
                   "hmos-rubric-scoring：逐 item 离散档位评分\n"
                   "hmos-rule-assessment：候选规则最终判定\n"
                   "hmos-human-rating-gap-analysis：人工评级差异归因",
                   "#EEF2FF", "#6366F1", 8, "#312E81", False, "l"))
    s.append(shape(71, "Artifacts", 6.75, 5.05, 5.65, 1.1,
                   "核心产物\n"
                   "result.json：basic_info、overall_conclusion、dimension_results、rule_violations、risks、human_review_items\n"
                   "report.html：可视化报告；run.log：执行日志；datasets/*.jsonl：人工样本",
                   "#ECFEFF", "#06B6D4", 8, "#155E75", False, "l"))
    footer(s, "1 / 5")
    s.append("</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>")
    return "".join(s)


def slide2() -> str:
    s = [slide_base()]
    title(s, "从输入到输出：主执行链路", "每一步都落盘或生成可回放证据")
    boxes = [
        ("1 输入", "remote task / local case"),
        ("2 下载", "写 inputs/remote-task.json\n下载 original/workspace/diff"),
        ("3 物化", "生成 case 目录\n统计文件数和 patch"),
        ("4 任务理解", "hmos-understanding\n约束摘要和 cross-device 判定"),
        ("5 分类", "full_generation / continuation / bug_fix"),
        ("6 审计", "静态规则引擎\n确定性规则 + 候选规则"),
        ("7 并行工具", "官方 Code Linter\nhvigor 构建检查"),
        ("8 Rubric", "加载 rubric 和风险 taxonomy"),
        ("9 Agents", "rubric scoring / rule assessment"),
        ("10 融合", "规则扣分 + 档位收敛 + hard gate"),
        ("11 报告", "schema 校验 result.json\n渲染 report.html"),
        ("12 输出", "persist / callback / rule stats"),
    ]
    coords = [(0.35, 1.15), (2.35, 1.15), (4.35, 1.15), (6.35, 1.15), (8.35, 1.15), (10.35, 1.15),
              (10.35, 3.18), (8.35, 3.18), (6.35, 3.18), (4.35, 3.18), (2.35, 3.18), (0.35, 3.18)]
    for idx, ((head, body), (x, y)) in enumerate(zip(boxes, coords), start=10):
        s.append(shape(idx, head, x, y, 1.5, 0.34, head, "#DBEAFE", "#2563EB", 10, "#1E3A8A", True))
        s.append(shape(idx + 30, body, x, y + 0.38, 1.5, 1.0, body, "FFFFFF", "93C5FD", 6, "#1F2937", False))
    for i in range(5):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]
        s.append(arrow(100 + i, "a", x1 + 1.5, y1 + 0.86, x2, y2 + 0.86, "#2563EB"))
    s.append(arrow(106, "b", coords[5][0] + 0.75, coords[5][1] + 1.38, coords[6][0] + 0.75, coords[6][1], "#2563EB"))
    for i in range(6, 11):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]
        s.append(arrow(110 + i, "c", x1, y1 + 0.86, x2 + 1.5, y2 + 0.86, "#2563EB"))
    s.append(shape(150, "Parallel", 0.75, 5.45, 5.35, 0.7,
                   "关键并行：ruleAudit 后，officialCodeLinterNode 和 rubricPreparationNode 并行；ruleMerge 等待官方工具 + rule agent；scoreFusion 等待 rubric agent + ruleMerge。",
                   "#F8FAFC", "#CBD5E1", 8, "#334155", False, "l"))
    s.append(shape(151, "Remote", 6.45, 5.45, 5.35, 0.7,
                   "远端任务先 pending，再 running；完成回调只带 basic_info 和 overall_conclusion，完整 result.json 由接口单独查询。",
                   "#ECFEFF", "#06B6D4", 8, "#155E75", False, "l"))
    footer(s, "2 / 5")
    s.append("</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>")
    return "".join(s)


def slide3() -> str:
    s = [slide_base()]
    title(s, "节点级职责和 agent 边界", "每个节点只做一小段工作，每个 agent 只处理它被授权的评测面")
    s.append(shape(10, "Prelude", 0.4, 1.08, 3.65, 1.45,
                   "预处理 / 任务理解 / 分类\n"
                   "download / materialize / write inputs\n"
                   "build sandbox / write constraint summary\n"
                   "infer task type",
                   "#E0F2FE", "#0284C7", 8, "#155E75", False, "l"))
    s.append(shape(11, "Rules", 4.2, 1.08, 4.25, 1.45,
                   "规则审计 / 官方工具 / rubric\n"
                   "静态规则引擎、Code Linter、hvigor\n"
                   "load rubric / risk taxonomy\n"
                   "prepare rubric 和 rule prompt",
                   "#DCFCE7", "#16A34A", 8, "#14532D", False, "l"))
    s.append(shape(12, "Agents", 8.65, 1.08, 4.2, 1.45,
                   "rubric scoring / rule assessment / gap analysis\n"
                   "逐项评分、候选规则判定、人工差异归因",
                   "#FCE7F3", "#DB2777", 8, "#831843", False, "l"))
    steps = [
        ("remoteTaskPreparationNode", "下载 original/workspace/diff，写 inputs/remote-task.json，写 case-info.json，统计文件数"),
        ("taskUnderstandingNode", "构建 opencode sandbox，抽取 constraint-summary.json，写 case-rule-definitions.json，生成 effective.patch"),
        ("inputClassificationNode", "根据 case input 和理解结果判定任务类型"),
        ("ruleAuditNode", "运行静态规则引擎，拿到 deterministic rule results / assisted rule candidates / rule evidence"),
        ("officialCodeLinterNode", "准备 linter workspace，跑官方 Code Linter，必要时跑 hvigor 构建检查，写 code-linter 结果"),
        ("rubricPreparationNode", "加载 rubric.yaml 和 risk-taxonomy.yaml，生成 rubric snapshot"),
        ("rubricScoringPromptBuilderNode", "组装 rubricScoringPayload 和 workspace 提示"),
        ("ruleAgentPromptBuilderNode", "组装 ruleAgentBootstrapPayload 和候选规则上下文"),
        ("rubricScoringAgentNode", "只做 rubric item 逐项离散档位评分"),
        ("ruleAssessmentAgentNode", "只做候选规则最终判定"),
        ("ruleMergeNode", "合并静态规则、官方工具和 agent 判定"),
        ("scoreFusionOrchestrationNode", "计算 item / dimension / total score 和 hard gate"),
        ("reportGenerationNode", "生成并校验 result.json"),
        ("artifactPostProcessNode", "渲染 report.html"),
        ("persistAndUploadNode", "落盘全部 inputs / intermediate / outputs 并回调"),
        ("humanRatingGapAnalysisNode", "只在人工评级达到阈值时做差异分析"),
    ]
    y = 2.78
    for idx, (head, body) in enumerate(steps, start=30):
        s.append(shape(idx, head, 0.55, y, 4.0, 0.36, head, "#FEF3C7", "#D97706", 9, "#78350F", True))
        s.append(shape(idx + 50, body, 4.75, y, 7.95, 0.36, body, "FFFFFF", "FBBF24", 7, "#334155", False, "l"))
        y += 0.42
    footer(s, "3 / 5")
    s.append("</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>")
    return "".join(s)


def slide4() -> str:
    s = [slide_base()]
    title(s, "分数计算规则", "Rubric 离散档位基础分 + 规则修正 + hard gate 上限")
    s.append(shape(10, "Rubric", 0.45, 1.05, 3.85, 1.52,
                   "基础分：按任务类型加载模板\n"
                   "总分 100，item 使用 scoring_bands 离散档位\n"
                   "rubric agent 必须覆盖每个 item；失败时保留满分并降低 confidence",
                   "#DBEAFE", "#2563EB", 8, "#1E3A8A", False, "l"))
    s.append(shape(11, "Dimensions", 4.55, 1.05, 3.95, 1.52,
                   "full_generation：20/20/20/15/15/10\n"
                   "continuation：20/20/15/15/15/10/5\n"
                   "bug_fix：25/20/15/15/10/10/5",
                   "#F0FDF4", "#16A34A", 8, "#14532D", False, "l"))
    s.append(shape(12, "RuleDelta", 8.75, 1.05, 3.8, 1.52,
                   "rule_delta = Σ rule_impact.score_delta\n"
                   "final_item = snap_to_nearest_declared_scoring_band(max(0, base + delta))\n"
                   "官方工具 / 规则包各有自己的 ratio 映射",
                   "#FEF3C7", "#D97706", 8, "#78350F", False, "l"))
    s.append(shape(20, "HardGate", 0.65, 3.05, 5.8, 1.2,
                   "G1 / G2 / G3 / G4\n"
                   "G1 高密度静态错误 cap=69\n"
                   "G2 ArkTS/HarmonyOS 基本规范严重不符 cap=69\n"
                   "G3 严重工程风险 cap=79\n"
                   "G4 bug_fix 误修/过修 cap=59",
                   "#FFFFFF", "#CBD5E1", 9, "#111827", True, "l"))
    s.append(shape(21, "Formula", 6.75, 3.05, 5.65, 1.2,
                   "raw_total = Σ dimension_score\n"
                   "score_cap = min(triggered gate caps + hvigor cap)\n"
                   "total_score = score_cap ? min(raw_total, score_cap) : raw_total",
                   "#FFFFFF", "#CBD5E1", 9, "#111827", True, "l"))
    s.append(shape(30, "Risk", 0.85, 4.9, 5.35, 0.8,
                   "risk 项来自规则违规和构建检查；score_effect 会记录原始扣分、等级权重、hard gate ids 和 gate_caps。",
                   "#EEF2FF", "#6366F1", 10, "#312E81", True, "l"))
    s.append(shape(31, "ResultFields", 6.55, 4.9, 5.35, 0.8,
                   "result.json 记录 agent_evaluation、rule_impacts、score_fusion、risks、human_review_items、official_linter_results、build_check_summary。",
                   "#ECFEFF", "#06B6D4", 10, "#155E75", True, "l"))
    footer(s, "4 / 5")
    s.append("</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>")
    return "".join(s)


def slide5() -> str:
    s = [slide_base()]
    title(s, "Case 目录树状图", "每个 caseDir 保存输入快照、中间证据、输出报告、日志和人工分析产物")
    tree = (
        ".local-cases/<caseId>/\n"
        "|-- inputs/\n"
        "|   |-- case-info.json\n"
        "|   |-- remote-task.json\n"
        "|   |-- rubric-scoring-payload.json\n"
        "|   `-- rule-agent-bootstrap-payload.json\n"
        "|-- intermediate/\n"
        "|   |-- effective.patch | generated.patch\n"
        "|   |-- constraint-summary.json\n"
        "|   |-- case-rule-definitions.json\n"
        "|   |-- rule-audit.json\n"
        "|   |-- rubric-snapshot.json\n"
        "|   |-- agent-assisted-rule-candidates.json\n"
        "|   |-- rubric-agent-result.json\n"
        "|   |-- rule-agent-result.json\n"
        "|   |-- rule-audit-merged.json\n"
        "|   |-- score-fusion.json\n"
        "|   |-- report-schema-version.json\n"
        "|   `-- code-linter/\n"
        "|       |-- summary.json\n"
        "|       |-- findings.effective.json\n"
        "|       |-- stdout.sanitized.txt\n"
        "|       |-- stderr.sanitized.txt\n"
        "|       |-- exit-code.txt\n"
        "|       `-- hvigor-summary.json\n"
        "|-- outputs/\n"
        "|   |-- result.json\n"
        "|   `-- report.html\n"
        "|-- human-rating/\n"
        "|   |-- manual-rating.json\n"
        "|   `-- analysis.json | analysis-skipped.json\n"
        "|-- logs/\n"
        "|   `-- run.log\n"
        "`-- opencode-sandbox/\n"
        "    |-- generated/\n"
        "    |-- original/\n"
        "    |-- patch/effective.patch\n"
        "    `-- metadata/\n"
        "        |-- metadata.json\n"
        "        `-- agent-output/*.json"
    )
    s.append(shape(10, "Tree", 0.42, 1.03, 7.35, 5.95, tree, "FFFFFF", "CBD5E1", 5, "#0F172A", False, "l", False))
    s.append(shape(20, "Inputs", 8.0, 1.08, 4.3, 0.78, "inputs/：输入快照和 agent payload。", "#DBEAFE", "#2563EB", 9, "#1E3A8A", True, "l"))
    s.append(shape(21, "Intermediate", 8.0, 2.08, 4.3, 1.05, "intermediate/：节点级证据链和中间结果。", "#FEF3C7", "#D97706", 9, "#78350F", True, "l"))
    s.append(shape(22, "Outputs", 8.0, 3.38, 4.3, 0.82, "outputs/：result.json 和 report.html。", "#F0FDF4", "#16A34A", 9, "#14532D", True, "l"))
    s.append(shape(23, "Human", 8.0, 4.45, 4.3, 0.85, "human-rating/：manual-rating.json 与 analysis.json。", "#FCE7F3", "#DB2777", 9, "#831843", True, "l"))
    s.append(shape(24, "Sandbox", 8.0, 5.55, 4.3, 0.95, "opencode-sandbox/：agent 只读工作区。", "#EEF2FF", "#6366F1", 9, "#312E81", True, "l"))
    footer(s, "5 / 5")
    s.append("</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>")
    return "".join(s)


def package_xml(slide_count: int) -> dict[str, str]:
    overrides = [
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ]
    for i in range(1, slide_count + 1):
        overrides.append(f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>')
    content_types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + "".join(overrides) + "</Types>"
    rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'
    slide_ids = "".join(f'<p:sldId id="{255 + i}" r:id="rId{i}"/>' for i in range(1, slide_count + 1))
    pres_rels = "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>' for i in range(1, slide_count + 1))
    pres_rels += f'<Relationship Id="rId{slide_count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId{slide_count + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>'
    now = datetime.now(timezone.utc).isoformat()
    core = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>hmos-score-agent 架构与链路总结</dc:title><dc:creator>Codex</dc:creator><cp:lastModifiedBy>Codex</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified></cp:coreProperties>'
    app = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Codex</Application><Slides>{slide_count}</Slides></Properties>'
    master = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>'
    master_rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>'
    layout = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
    layout_rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>'
    theme = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="hmos"><a:themeElements><a:clrScheme name="hmos"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="334155"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="16A34A"/></a:accent2><a:accent3><a:srgbClr val="D97706"/></a:accent3><a:accent4><a:srgbClr val="DB2777"/></a:accent4><a:accent5><a:srgbClr val="6366F1"/></a:accent5><a:accent6><a:srgbClr val="06B6D4"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="hmos"><a:majorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:majorFont><a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme><a:fmtScheme name="hmos"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'
    return {
        "[Content_Types].xml": content_types,
        "_rels/.rels": rels,
        "ppt/presentation.xml": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId6"/></p:sldMasterIdLst><p:sldIdLst>{slide_ids}</p:sldIdLst><p:sldSz cx="{SLIDE_W}" cy="{SLIDE_H}" type="wide"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
        "ppt/_rels/presentation.xml.rels": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{pres_rels}</Relationships>',
        "docProps/core.xml": core,
        "docProps/app.xml": app,
        "ppt/slideMasters/slideMaster1.xml": master,
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": master_rels,
        "ppt/slideLayouts/slideLayout1.xml": layout,
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": layout_rels,
        "ppt/theme/theme1.xml": theme,
        "ppt/slides/slide1.xml": slide1().encode("utf-8"),
        "ppt/slides/slide2.xml": slide2().encode("utf-8"),
        "ppt/slides/slide3.xml": slide3().encode("utf-8"),
        "ppt/slides/slide4.xml": slide4().encode("utf-8"),
        "ppt/slides/slide5.xml": slide5().encode("utf-8"),
        "ppt/slides/_rels/slide1.xml.rels": b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
        "ppt/slides/_rels/slide2.xml.rels": b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
        "ppt/slides/_rels/slide3.xml.rels": b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
        "ppt/slides/_rels/slide4.xml.rels": b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
        "ppt/slides/_rels/slide5.xml.rels": b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
    }


def main() -> None:
    parts = package_xml(5)
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, data in parts.items():
            zf.writestr(name, data)
    print(OUT.resolve())


if __name__ == "__main__":
    main()
