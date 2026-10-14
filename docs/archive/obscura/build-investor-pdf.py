# -*- coding: utf-8 -*-
"""
Build the investor-facing PDF, in a desktop and a phone layout.

    python docs/build-investor-pdf.py

Two typographic rules drive this file, both learned the hard way:

1. NEVER justify CJK text in ReportLab. Justification distributes slack across
   spaces, and a Chinese line contains none — so a line holding one Latin token
   ("gas", "MCP") stretches that single space across the whole measure and
   flings the token to the right margin. Left alignment is correct here.

2. Every style sets wordWrap="CJK". Without it ReportLab treats an unbroken run
   of Chinese as one atomic word and will not wrap it at all.

Content note: this is the commercial document. Implementation post-mortems stay
in docs/whitepaper.md, but the three facts an investor prices risk on — no audit
yet, no vesting yet, identity layer pending — remain, framed as status and
roadmap. Removing them would misrepresent a financial product, and diligence
surfaces them regardless.
"""
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, KeepTogether, PageBreak, PageTemplate,
    Paragraph, Spacer, Table, TableStyle,
)

HERE = Path(__file__).resolve().parent

FONTS = Path("C:/Windows/Fonts")
pdfmetrics.registerFont(TTFont("YaHei", str(FONTS / "msyh.ttc"), subfontIndex=0))
pdfmetrics.registerFont(TTFont("YaHei-Bold", str(FONTS / "msyhbd.ttc"), subfontIndex=0))
pdfmetrics.registerFontFamily("YaHei", normal="YaHei", bold="YaHei-Bold")

INK = colors.HexColor("#12161F")
MUTED = colors.HexColor("#5B6675")
ACCENT = colors.HexColor("#0E7C86")
RULE = colors.HexColor("#D8DEE6")
PANEL = colors.HexColor("#F4F7F9")


class Profile:
    """Page geometry and type scale for one output."""

    def __init__(self, key, pagesize, margins, base, lead, stacked_tables):
        self.key = key
        self.pagesize = pagesize
        self.ml, self.mr, self.mt, self.mb = margins
        self.base = base
        self.lead = lead
        self.stacked_tables = stacked_tables
        self.width = pagesize[0] - self.ml - self.mr


# A phone page is narrow on purpose: fit-to-width on a handset then lands the
# body around 22–24 Chinese characters per line, which is the comfortable range.
# An A4 page scaled to a phone screen renders body text at roughly 6pt.
PROFILES = {
    "mobile": Profile("mobile", (108 * mm, 192 * mm), (11 * mm, 11 * mm, 12 * mm, 14 * mm),
                      base=10, lead=17, stacked_tables=True),
    "a4": Profile("a4", A4, (22 * mm, 23 * mm, 20 * mm, 22 * mm),
                  base=10.5, lead=17, stacked_tables=False),
}

ss = getSampleStyleSheet()


def make_styles(p: Profile):
    def s(name, **kw):
        base = dict(fontName="YaHei", textColor=INK, fontSize=p.base,
                    leading=p.lead, wordWrap="CJK")
        base.update(kw)
        return ParagraphStyle(f"{name}-{p.key}", parent=ss["Normal"], **base)

    big = 1.0 if p.key == "a4" else 0.86
    return {
        "cover_title": s("ct", fontName="YaHei-Bold", fontSize=34 * big, leading=42 * big),
        "cover_sub": s("cs", fontSize=13 * big, leading=20 * big, textColor=MUTED),
        "cover_tag": s("ctg", fontName="YaHei-Bold", fontSize=11, leading=18, textColor=ACCENT),
        "h1": s("h1", fontName="YaHei-Bold", fontSize=p.base + 6, leading=p.base + 12),
        "h2": s("h2", fontName="YaHei-Bold", fontSize=p.base + 1.5,
                leading=p.lead + 2, spaceBefore=9, spaceAfter=3),
        "body": s("body", spaceAfter=7),
        "lead": s("lead", fontSize=p.base + 1, leading=p.lead + 2, spaceAfter=8),
        "bullet": s("bu", leftIndent=11, bulletIndent=1, spaceAfter=5),
        "note": s("note", fontSize=p.base - 1.5, leading=p.lead - 3, textColor=MUTED),
        "cell": s("cell", fontSize=p.base - 1, leading=p.lead - 3),
        "cellb": s("cellb", fontName="YaHei-Bold", fontSize=p.base - 1, leading=p.lead - 3),
        "cellk": s("cellk", fontName="YaHei-Bold", fontSize=p.base - 1.5,
                   leading=p.lead - 4, textColor=ACCENT),
        "kpi_n": s("kn", fontName="YaHei-Bold", fontSize=p.base + 8,
                   leading=p.base + 12, textColor=ACCENT, alignment=TA_CENTER),
        "kpi_l": s("kl", fontSize=p.base - 2, leading=p.base + 1,
                   textColor=MUTED, alignment=TA_CENTER),
    }


def build(p: Profile, out: Path):
    S = make_styles(p)
    W = p.width

    def para(t, k="body"):
        return Paragraph(t, S[k])

    def bullets(items):
        return [Paragraph(t, S["bullet"], bulletText="▪") for t in items]

    def rule(before=3, after=9):
        t = Table([[""]], colWidths=[W], rowHeights=[0.6])
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), ACCENT)]))
        return [Spacer(1, before), t, Spacer(1, after)]

    def section(title, num):
        return KeepTogether([Paragraph(f'<font color="#0E7C86">{num}</font>  {title}', S["h1"]), *rule()])

    def grid(rows, ratios):
        """Columns on a wide page; stacked key/value blocks on a phone."""
        if not p.stacked_tables:
            data = [[Paragraph(c, S["cellb"] if r == 0 else S["cell"]) for c in row]
                    for r, row in enumerate(rows)]
            t = Table(data, colWidths=[W * x for x in ratios], hAlign="LEFT")
            t.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
                ("BACKGROUND", (0, 0), (-1, 0), PANEL),
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, ACCENT),
            ]))
            return [t]

        header, *body = rows
        blocks = []
        for row in body:
            inner = [Paragraph(row[0], S["cellk"])]
            for label, value in zip(header[1:], row[1:]):
                inner += [Spacer(1, 2), Paragraph(f"<b>{label}</b>　{value}", S["cell"])]
            b = Table([[inner]], colWidths=[W], hAlign="LEFT")
            b.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), PANEL),
                ("LINEBEFORE", (0, 0), (0, -1), 1.8, ACCENT),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ]))
            blocks += [b, Spacer(1, 5)]
        return blocks

    def panel(title, text):
        inner = [Paragraph(title, S["cellb"]), Spacer(1, 3), Paragraph(text, S["cell"])]
        t = Table([[inner]], colWidths=[W], hAlign="LEFT")
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), PANEL),
            ("LINEBEFORE", (0, 0), (0, -1), 2.2, ACCENT),
            ("TOPPADDING", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ("LEFTPADDING", (0, 0), (-1, -1), 11),
            ("RIGHTPADDING", (0, 0), (-1, -1), 11),
        ]))
        return t

    def kpis(items):
        per_row = 2 if p.stacked_tables else 4
        out_flow = []
        for i in range(0, len(items), per_row):
            chunk = items[i:i + per_row]
            col = W / len(chunk)
            t = Table([[Paragraph(n, S["kpi_n"]) for n, _ in chunk],
                       [Paragraph(l, S["kpi_l"]) for _, l in chunk]],
                      colWidths=[col] * len(chunk), hAlign="LEFT")
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), PANEL),
                ("TOPPADDING", (0, 0), (-1, 0), 10),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
                ("TOPPADDING", (0, 1), (-1, 1), 1),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
            ]))
            out_flow += [t, Spacer(1, 4)]
        return out_flow

    def on_page(canv, doc):
        canv.saveState()
        if doc.page > 1:
            canv.setFont("YaHei", p.base - 2.5)
            canv.setFillColor(MUTED)
            canv.drawString(p.ml, p.mb - 9 * mm, "Obscura 暗匣 · 投资人简介 · 机密")
            canv.drawRightString(p.pagesize[0] - p.mr, p.mb - 9 * mm, str(doc.page))
            canv.setStrokeColor(RULE)
            canv.setLineWidth(0.4)
            canv.line(p.ml, p.mb - 5 * mm, p.pagesize[0] - p.mr, p.mb - 5 * mm)
        canv.restoreState()

    doc = BaseDocTemplate(
        str(out), pagesize=p.pagesize,
        leftMargin=p.ml, rightMargin=p.mr, topMargin=p.mt, bottomMargin=p.mb,
        title="Obscura 暗匣 · 投资人简介", author="Obscura",
        subject="面向自主代理的密封投标代币发行平台",
    )
    doc.addPageTemplates([PageTemplate(
        id="main",
        frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")],
        onPage=on_page)])

    F = []
    cover_gap = 52 * mm if p.key == "a4" else 30 * mm

    # ---------------------------------------------------------------- cover
    F += [Spacer(1, cover_gap), para("OBSCURA", "cover_tag"), Spacer(1, 4)]
    F += [para("暗匣", "cover_title"), Spacer(1, 7)]
    F += [para("面向自主代理的密封投标代币发行平台", "cover_sub"), Spacer(1, 3)]
    F += [para("Sealed-Bid Token Launches for Autonomous Agents", "cover_sub")]
    F += [Spacer(1, 14)] + rule(0, 12)
    F += [para("在密封投标、统一清算价的批量拍卖中，分配由真实估值决定，"
               "而非由交易排序能力决定。投标只能从用户自己的 AI 代理发起，"
               "私钥全程不离开用户设备。", "lead")]
    F += [Spacer(1, cover_gap * 0.7)]
    F += [para("技术与商业简介 · v0.1 · 2026 年 8 月", "note")]
    F += [para("本文件含机密信息，仅供接收方评估之用。", "note"), PageBreak()]

    # ---------------------------------------------------------------- 01
    F += [section("执行摘要", "01")]
    F += [KeepTogether(kpis([("100%", "分配与交易时序无关"), ("1", "统一清算价"),
                             ("0", "私钥离开用户设备"), ("O(n)", "链上清算价验证复杂度")]))]
    F += [Spacer(1, 7)]
    F += [para("代币公开发行的本质是稀缺供应的分配问题。当前主流的<b>先到先得铸造</b>模式，"
               "其分配结果由交易被打包的优先级决定，也就是由竞价能力与基础设施决定，"
               "而非由参与者对项目的真实估值决定。")]
    F += [para("后果是结构性的：专业搜索者与机器人系统性地占据主要份额；"
               "普通参与者以失败交易的形式承担成本；而这部分超额支付并未流向项目方，"
               "而是流向区块生产者。项目方付出了稀缺性，却没有获得对应的定价收益。")]
    F += [Spacer(1, 4)]
    F += [panel("Obscura 的核心主张",
                "把发行从「谁的机器人更快」改为「谁的估值更高」。"
                "密封投标消除抢跑，统一清算价让所有中标者支付同一价格，"
                "批量结算使分配结果与交易时序完全无关。")]
    F += [Spacer(1, 9)]
    F += [para("在此基础上，我们把唯一的投标入口实现为运行在用户本地的 MCP 服务，"
               "使其可被主流 AI 代理宿主一键安装，从而占据一个当前市场尚未被填补的分发位置——"
               "<b>代理原生的一级市场入口</b>。")]

    # ---------------------------------------------------------------- 02
    F += [Spacer(1, 10), section("市场问题", "02")]
    F += [para("先到先得的固定价格发行，其分配结果正比于交易优先级。"
               "这带来三个各方都不满意的结果：")]
    F += bullets([
        "<b>参与者</b>：胜负取决于基础设施而非判断力，失败交易的成本由散户承担。",
        "<b>项目方</b>：定价权旁落。供不应求时的溢价被区块生产者与抢跑者截获，而非计入募资。",
        "<b>代币本身</b>：初始持有者集中于短线套利方，二级市场开盘即面临抛压。",
    ])
    F += [Spacer(1, 5)]
    F += [para("当发行入口从人类界面转向 AI 代理时，这一缺陷被进一步放大。"
               "代理的端到端延迟由模型推理与工具调用往返构成，天然处于秒级至数十秒级，"
               "在竞速中必然落后于专用脚本。<b>沿用先到先得，等于把代理用户排除在外。</b>")]

    # ---------------------------------------------------------------- 03
    F += [Spacer(1, 10), section("发行机制", "03")]
    F += [para("一场发行分为五个阶段，全部由合约执行，无人工干预。"), Spacer(1, 3)]
    F += grid([
        ["阶段", "参与者动作", "机制作用"],
        ["① 准入", "质押保证金，取得参与资格", "配额按<b>人</b>绑定，抑制账户批量放大份额"],
        ["② 密封投标", "提交出价与数量，托管抵押金", "链上仅存哈希，<b>揭示前无人能看到任何出价</b>"],
        ["③ 揭示", "公开出价，合约校验哈希", "未揭示者抵押金没收，杜绝「免费期权」"],
        ["④ 清算", "无需参与，由 keeper 执行", "按统一清算价分批结算，成本与投标数解耦"],
        ["⑤ 领取", "领取代币与退款", "多付的抵押金原路退回"],
    ], [0.19, 0.31, 0.50])

    F += [Spacer(1, 8), Paragraph("清算价如何决定", S["h2"])]
    F += [para("清算价是使<b>累积需求恰好覆盖供应量的最高价格</b>。"
               "所有中标者按这一个价格成交，而不是按各自的出价。"), Spacer(1, 3)]
    F += grid([
        ["你的出价", "成交结果", "支付价格"],
        ["高于清算价", "全额成交", "按清算价"],
        ["等于清算价", "按比例削减", "按清算价"],
        ["低于清算价", "不成交", "抵押金全额退回"],
    ], [0.28, 0.36, 0.36])
    F += [Spacer(1, 6)]
    F += [panel("为什么这对项目方更有利",
                "统一清算价把「抢跑溢价」转化为「估值溢价」。"
                "先到先得模式下，超额需求表现为竞价成本，收益归区块生产者；"
                "批量拍卖中，超额需求直接抬高清算价，收益计入募资。"
                "同时，中标者由出价最高者构成，初始持有人结构更贴近真实看多方。")]

    F += [Spacer(1, 9), Paragraph("可验证的链上清算", S["h2"])]
    F += [para("链上排序的复杂度是平方级，投标规模一大就无法结算。"
               "我们采用链下计算、链上验证：任何人提交候选清算价，"
               "合约以<b>一次线性扫描</b>验证其正确性，提交错误值只会导致该笔交易回滚。"
               "结算进一步拆分为分批状态机，使单笔交易成本有界，"
               "投标总数不受区块上限约束。")]

    # ---------------------------------------------------------------- 04
    F += [PageBreak(), section("差异化：代理原生的发行入口", "04")]
    F += [para("投标只能通过用户自己的 AI 代理完成。交易在用户设备上构造与签名，"
               "平台全程不接触私钥，也不托管任何资产。"), Spacer(1, 4)]
    F += grid([
        ["维度", "传统发行平台", "Obscura"],
        ["分配依据", "交易打包优先级", "投标估值"],
        ["抢跑", "结构性存在", "投标密封，无可抢跑对象"],
        ["超额需求收益", "流向区块生产者", "计入项目方募资"],
        ["资产托管", "平台或合约托管账户", "用户自持，平台不接触私钥"],
        ["接入形态", "网页加钱包插件", "AI 代理一键安装"],
    ], [0.22, 0.38, 0.40])
    F += [Spacer(1, 7)]
    F += [para("分发形态本身构成壁垒。用户在代理宿主中安装一个扩展即可参与发行，"
               "无需访问网站、无需连接钱包插件、无需理解拍卖细节——"
               "他只需用自然语言表达意图，其余由代理完成。"
               "随着代理成为主流交互入口，<b>一级市场的代理原生接入是一个尚未被占据的位置</b>。")]

    # ---------------------------------------------------------------- 05
    F += [Spacer(1, 10), section("安全架构", "05")]
    F += [para("让 AI 代理代表用户签署交易，其风险必须被结构性地限制，"
               "而不是依赖模型的自觉。我们在代码层强制三重边界，"
               "全部在签名产生之前生效："), Spacer(1, 3)]
    F += grid([
        ["约束", "内容"],
        ["目标地址", "由启动时冻结的配置解析。工具参数中<b>不存在地址字段</b>，运行时读取的任何数据都无法改变交易去向"],
        ["函数白名单", "仅允许投标、揭示、领取、注册。新增合约方法在显式修改白名单前不可达"],
        ["单笔硬上限", "由用户设定，签名前强制校验，<b>对话内的任何内容都无法抬高</b>"],
    ], [0.24, 0.76])
    F += [Spacer(1, 6)]
    F += [panel("系统中不存在通用转账工具",
                "由此可得一个可精确陈述的安全上界：即使代理被恶意文案诱导，"
                "它所能造成的最坏后果是<b>一次劣质出价</b>，"
                "损失以用户预设的单笔上限为界，而非任意资产转移。"
                "项目方撰写的文案在进入代理上下文前会被显式标注为不可信内容。")]

    # ---------------------------------------------------------------- 06
    F += [Spacer(1, 10), section("技术就绪度", "06")]
    F += [para("系统已在以太坊测试网完成部署，并跑通完整生命周期："
               "投标、揭示、清算、代币到账。"), Spacer(1, 4)]
    F += grid([
        ["项目", "状态"],
        ["智能合约", "已部署测试网，19 项单元与随机化测试通过"],
        ["合约测试覆盖率", "行覆盖 90.24%，语句覆盖 91.84%"],
        ["代理接入层", "已完成，支持一键安装扩展包"],
        ["多链支持", "以太坊与 Base，配置化切换"],
        ["安全审计", "<b>尚未进行</b>，主网上线前完成第三方审计"],
        ["释放机制", "<b>尚未实现</b>，详见路线图"],
        ["身份层", "接口已预留，待接入身份验证方"],
    ], [0.30, 0.70])
    F += [Spacer(1, 5)]
    F += [para("当前处于测试网阶段。上表后三项是主网上线的前置条件，"
               "已列入路线图并作为里程碑管理。", "note")]

    # ---------------------------------------------------------------- 07
    F += [Spacer(1, 10), section("路线图", "07")]
    F += grid([
        ["阶段", "内容", "状态"],
        ["M1 机制与合约", "拍卖合约、分批结算、测试覆盖", "已完成"],
        ["M2 代理接入", "MCP 服务、扩展包分发、安全边界", "已完成"],
        ["M3 代币释放", "独立 vesting 合约，悬崖期加线性释放", "进行中"],
        ["M4 身份层", "接入身份验证，强化女巫抵抗", "计划中"],
        ["M5 安全审计", "第三方审计与静态分析", "计划中"],
        ["M6 主网发行", "首批合作项目方发行", "计划中"],
    ], [0.26, 0.53, 0.21])
    F += [Spacer(1, 6)]
    F += [para("释放机制采用<b>独立合约</b>而非并入拍卖合约："
               "拍卖逻辑的审计面已因分批结算显著扩大，"
               "职责分离可使两者独立审计与复用，降低关键路径风险。")]

    # ---------------------------------------------------------------- 08
    F += [Spacer(1, 10), section("重要提示", "08")]
    F += bullets([
        "本系统<b>尚未经过外部安全审计</b>，当前仅部署于测试网络。",
        "代币释放机制尚未实现，为主网上线前的必要工作。",
        "「通过自有代理参与」是产品与分发设计，其安全性由链上规则保障。",
        "本文件不构成要约、投资建议或任何形式的收益承诺。",
    ])
    F += [Spacer(1, 10)] + rule(0, 6)
    F += [para("Obscura 暗匣 · 机密文件 · 仅供接收方评估之用 · 2026 年 8 月", "note")]

    doc.build(F)
    return out


if __name__ == "__main__":
    for key, name in [("mobile", "Obscura-投资人简介-手机版.pdf"),
                      ("a4", "Obscura-投资人简介-A4.pdf")]:
        path = build(PROFILES[key], HERE / name)
        print(f"wrote {path.name}")
