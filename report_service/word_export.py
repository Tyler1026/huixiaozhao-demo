#!/usr/bin/env python3
"""慧小招报告 Markdown → Word 合并脚本 v3.1
格式要求：仿宋正文小四(12pt)、标题仿宋加粗、表格五号(10.5pt)、1.5倍行距、标准公文页边距
章节顺序按报告逻辑重排：摘要→方向→产业链缺口→目标企业→评分→行动→基础数据附录
v3.1 新增：--compact 精简版输出支持
"""
import re
import json
from pathlib import Path
from docx import Document
from docx.shared import Pt, Inches, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

# 字体名称
FONT_NAME = '仿宋'
FONT_NAME_EN = 'FangSong'

# 章节顺序（按报告逻辑重排）
CHAPTER_ORDER = [
    "00_executive_summary.md",
    "02_industry_direction.md",
    "06_supply_chain_gaps.md",
    "05a_target_enterprises_dir1.md",
    "05b_target_enterprises_dir2.md",
    "05c_target_enterprises_dir3.md",
    "06b_fact_check.md",
    "07_matching_score.md",
    "08_action_plan.md",
    "01a_economy.md",
    "01b_population.md",
    "01c_transport_land.md",
    "01d_life_support.md",
    "03_competition.md",
    "04_policy_trends.md",
]

CHAPTER_LABELS = {
    "06b_fact_check.md": "事实核验",
    "00_executive_summary.md": "核心结论与决策摘要",
    "02_industry_direction.md": "第一章 产业方向研判",
    "06_supply_chain_gaps.md": "第二章 产业链全景与缺口分析",
    "05a_target_enterprises_dir1.md": "第三章 目标招商企业（方向一）",
    "05b_target_enterprises_dir2.md": "第三章 目标招商企业（方向二）",
    "05c_target_enterprises_dir3.md": "第三章 目标招商企业（方向三）",
    "07_matching_score.md": "第四章 企业-城市匹配度评分",
    "08_action_plan.md": "第五章 行动计划与话术",
    "01a_economy.md": "附录一 经济数据",
    "01b_population.md": "附录二 人口与劳动力",
    "01c_transport_land.md": "附录三 区位交通与产业园区",
    "01d_life_support.md": "附录四 生活配套",
    "03_competition.md": "附录五 区域竞争格局",
    "04_policy_trends.md": "附录六 招商政策汇编",
}

# 精简版章节顺序（对应 09_compact_report.md 内部段落标记）
COMPACT_SECTION_ORDER = [
    "方法论",
    "决策摘要",
    "研判",
    "缺口",
    "企业总览",
    "评分",
    "行动",
]

COMPACT_SECTION_LABELS = {
    "方法论": "第0段 · 方法论说明",
    "决策摘要": "第1段 · 核心决策摘要",
    "研判": "第2段 · 产业方向研判",
    "缺口": "第3段 · 产业链缺口分析",
    "企业总览": "第4段 · 目标企业总览",
    "评分": "第5段 · 企业匹配度评分",
    "行动": "第6段 · 行动计划",
}


# ──────────────────────────────────────────────
# 通用工具函数
# ──────────────────────────────────────────────

def _region_label(city_name):
    """Keep an existing administrative suffix; add 市 for a bare city name."""
    name = city_name.strip()
    return name if name.endswith(('市', '区', '县')) else f'{name}市'


def set_run_font(run, size_pt, bold=False):
    """Set font to FangSong with given size."""
    run.font.name = FONT_NAME
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run.font.color.rgb = RGBColor(0, 0, 0)
    # Set East Asian font
    r = run._element
    rPr = r.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = r.makeelement(qn('w:rFonts'), {})
        rPr.insert(0, rFonts)
    rFonts.set(qn('w:eastAsia'), FONT_NAME)
    rFonts.set(qn('w:ascii'), FONT_NAME_EN)
    rFonts.set(qn('w:hAnsi'), FONT_NAME_EN)


def set_paragraph_spacing(paragraph):
    """Set 1.5x line spacing."""
    pf = paragraph.paragraph_format
    pf.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE


def add_styled_paragraph(doc, text, size_pt=12, bold=False, bullet=False):
    """Add a paragraph with FangSong font."""
    if bullet:
        p = doc.add_paragraph(style='List Bullet')
    else:
        p = doc.add_paragraph()
    # Clean markdown formatting, apply bold segments
    segments = re.split(r'(\*\*.+?\*\*)', text)
    for seg in segments:
        if seg.startswith('**') and seg.endswith('**'):
            run = p.add_run(seg[2:-2])
            set_run_font(run, size_pt, bold=True)
        else:
            seg_clean = re.sub(r'\*(.+?)\*', r'\1', seg)
            if seg_clean:
                run = p.add_run(seg_clean)
                set_run_font(run, size_pt, bold=bold)
    set_paragraph_spacing(p)
    return p


def add_heading_styled(doc, text, level):
    """Add heading with FangSong bold, appropriate size."""
    size_map = {0: 22, 1: 18, 2: 15, 3: 14, 4: 12}
    size = size_map.get(level, 12)
    p = doc.add_paragraph(style=f'Heading {min(max(level, 1), 4)}')
    run = p.add_run(text)
    set_run_font(run, size, bold=True)
    set_paragraph_spacing(p)
    # Spacing before heading
    pf = p.paragraph_format
    pf.space_before = Pt(12 if level >= 2 else 18)
    pf.space_after = Pt(6)
    pf.keep_with_next = True
    return p


def parse_table(lines):
    """Parse markdown table lines into rows of cells."""
    rows = []
    for line in lines:
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if all(re.match(r'^[-:]+$', c) for c in cells if c):
            continue
        rows.append(cells)
    return rows


def add_table_to_doc(doc, rows, highlight_header=False, score_col_idx=None):
    """Add a parsed table with FangSong 五号(10.5pt).

    highlight_header: 若为 True，表头行底色设为浅灰 RGB(242,242,242)
    score_col_idx: 若指定列索引，该列值 >= 8.5 的行底色设为浅绿 RGB(226,239,218)
    """
    if not rows:
        return
    ncols = max(len(r) for r in rows)
    table = doc.add_table(rows=len(rows), cols=ncols)
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate(rows):
        # 判断是否需要高亮评分行
        row_score = None
        if score_col_idx is not None and i > 0 and score_col_idx < len(row):
            try:
                row_score = float(re.sub(r'[^\d.]', '', row[score_col_idx]))
            except (ValueError, TypeError):
                row_score = None

        for j, cell_text in enumerate(row):
            if j < ncols:
                cell = table.cell(i, j)
                cell.text = ''
                p = cell.paragraphs[0]
                # Clean markdown bold in cells
                clean_text = re.sub(r'\*\*(.+?)\*\*', r'\1', cell_text)
                clean_text = re.sub(r'\*(.+?)\*', r'\1', clean_text)
                run = p.add_run(clean_text)
                set_run_font(run, 10.5, bold=(i == 0))
                set_paragraph_spacing(p)

                # 表头行浅灰底色
                if i == 0 and highlight_header:
                    _set_cell_bg(cell, 'F2F2F2')
                # 高分行浅绿底色
                elif row_score is not None and row_score >= 8.5:
                    _set_cell_bg(cell, 'E2EFDA')

    doc.add_paragraph()  # spacing


def _set_cell_bg(cell, hex_color):
    """为单元格设置背景色（十六进制颜色字符串，如 'F2F2F2'）。"""
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_color)
    # 移除已有 shd
    existing = tcPr.find(qn('w:shd'))
    if existing is not None:
        tcPr.remove(existing)
    tcPr.append(shd)


def set_page_margins(doc):
    """Set standard document margins: top/bottom 2.54cm, left/right 3.17cm."""
    for section in doc.sections:
        section.top_margin = Cm(2.54)
        section.bottom_margin = Cm(2.54)
        section.left_margin = Cm(3.17)
        section.right_margin = Cm(3.17)


def _add_header_right(doc, text):
    """在文档首节页眉右上角添加文字。"""
    section = doc.sections[0]
    header = section.header
    # 清空默认段落
    for p in header.paragraphs:
        for run in p.runs:
            run.text = ''
    if header.paragraphs:
        hp = header.paragraphs[0]
    else:
        hp = header.add_paragraph()
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = hp.add_run(text)
    set_run_font(run, 10.5, bold=False)


def _add_page_numbers(doc):
    footer = doc.sections[0].footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(footer.add_run('第 '), 10.5)
    field = OxmlElement('w:fldSimple')
    field.set(qn('w:instr'), 'PAGE')
    footer._p.append(field)
    set_run_font(footer.add_run(' 页'), 10.5)


def _add_contents(doc, labels):
    add_heading_styled(doc, '目录', 1)
    for number, label in enumerate(labels):
        p = doc.add_paragraph()
        link = OxmlElement('w:hyperlink')
        link.set(qn('w:anchor'), f'chapter_{number}')
        run = OxmlElement('w:r')
        text = OxmlElement('w:t')
        text.text = label
        run.append(text)
        link.append(run)
        p._p.append(link)
    doc.add_page_break()


def _chapter(doc, label, number):
    p = add_heading_styled(doc, label, 1)
    start = OxmlElement('w:bookmarkStart')
    start.set(qn('w:id'), str(number))
    start.set(qn('w:name'), f'chapter_{number}')
    end = OxmlElement('w:bookmarkEnd')
    end.set(qn('w:id'), str(number))
    p._p.insert(1 if p._p.pPr is not None else 0, start)
    p._p.append(end)
    return p


def _infer_compact_sections(content):
    """Group a native numbered report without deleting or summarizing lines."""
    markers = (
        (r'区域基本盘|区域概况|经济概况', '区域概况'),
        (r'三大产业方向|产业方向的确定|主导产业方向', '产业方向与载体'),
        (r'最直接制造端断点|产业链.*(?:断点|缺口)', '产业链缺口'),
        (r'补链以.*路径|补链方向与路径', '补链方向'),
        (r'本市存量企业服务重点一|目标企业总览|重点企业清单', '目标企业与对接'),
        (r'区级政策工具一|政策工具与条件', '政策工具与条件'),
        (r'优先级最高核查项|行动计划与里程碑', '行动与核查'),
        (r'待核实事项汇总|时效性与来源限制总说明', '资料边界与待核事项'),
    )
    sections, order = {}, []
    current = '概览'
    sections[current] = []
    order.append(current)
    for line in content.splitlines():
        body = re.sub(r'^\s*\d+[.、．]\s+', '', line)
        lead = body.split('：', 1)[0]
        for pattern, label in markers:
            if re.search(pattern, lead) and label not in sections:
                current = label
                sections[current] = []
                order.append(current)
                break
        sections[current].append(body)
    return sections, order


def _render_reader_body(doc, lines, dense=False):
    # The model's continuous 1..90 numbering is not a document hierarchy.
    # Keep all text, with a bold descriptive lead when one is present.
    rendered = []
    for line in lines:
        line = re.sub(r'^\s*\d+[.、．]\s+', '', line)
        if line and not line.startswith(('#', '|', '>', '-', '*')) and '：' in line:
            lead, tail = line.split('：', 1)
            if len(lead) <= 32:
                line = '**' + lead + '：**' + tail
        rendered.append(line)
    start = len(doc.paragraphs)
    _render_md_lines(doc, rendered, highlight_top_tables=True)
    if dense:
        for paragraph in doc.paragraphs[start:]:
            if paragraph.style.name.startswith('Heading'):
                continue
            paragraph.paragraph_format.line_spacing = 1.15
            paragraph.paragraph_format.space_after = Pt(4)


def _build_decision_main(doc, root, metadata):
    labels = ['研判正文', '目标企业清单', '企业匹配评分', '事实核验与资料边界']
    _add_contents(doc, labels)
    _chapter(doc, labels[0], 0)
    sections, order = _split_compact_sections((root / '09_compact_report.md').read_text(encoding='utf-8'))
    if not order:
        sections, order = _infer_compact_sections((root / '09_compact_report.md').read_text(encoding='utf-8'))
    for key in order:
        add_heading_styled(doc, COMPACT_SECTION_LABELS.get(key, key), 2)
        _render_reader_body(doc, sections[key])
    doc.add_page_break()
    _chapter(doc, labels[1], 1)
    directions = {item.get('id'): item.get('name') for item in metadata.get('02_industry_direction.md', {}).get('directions', [])}
    for number, filename in enumerate(('05a_target_enterprises_dir1.md', '05b_target_enterprises_dir2.md', '05c_target_enterprises_dir3.md'), 1):
        add_heading_styled(doc, directions.get(f'dir{number}') or f'产业方向{number}', 2)
        for index, company in enumerate(metadata.get(filename, {}).get('selected', []), 1):
            add_heading_styled(doc, f'{index}. {company.get("name", "名称待核实")}', 3)
            for key, label in (('landing_status', '落地状态'), ('segment', '产业环节'),
                               ('rationale', '适配依据'), ('expansion_evidence', '扩产或投资线索'),
                               ('uncertainty', '待核事项'), ('url', '企业资料来源'),
                               ('evidence_ref', '落地依据来源')):
                value = company.get(key)
                if value:
                    add_styled_paragraph(doc, f'{label}：{value}')
    doc.add_page_break()
    _chapter(doc, labels[2], 2)
    dimension_labels = {'industry_fit': '产业适配', 'supply_chain_fit': '补链价值',
                        'attractiveness': '吸引力', 'competitive_position': '竞争位置',
                        'policy_support': '政策支持', 'landing_feasibility': '落地可行', 'risk': '风险'}
    for score in metadata.get('07_matching_score.md', {}).get('scores', []):
        add_heading_styled(doc, f'{score.get("rank", "")}. {score.get("name", "名称待核实")} · {score.get("weighted_score", "待核实")}分', 3)
        dims = score.get('dimensions', {})
        add_styled_paragraph(doc, '；'.join(f'{dimension_labels.get(key, key)} {value}' for key, value in dims.items()))
    doc.add_page_break()
    _chapter(doc, labels[3], 3)
    checks = metadata.get('06b_fact_check.md', {})
    for check in checks.get('checks', []):
        add_styled_paragraph(doc, str(check.get('claim', '')))
        add_styled_paragraph(doc, f'核验结论：{check.get("verdict", "待核实")}；年份：{check.get("year", "待核实")}')
        for key, label in (('source', '来源'), ('cross_source', '交叉来源')):
            if check.get(key):
                add_styled_paragraph(doc, label + '：' + check[key], size_pt=10.5)
    if checks.get('high_star_unavailable'):
        add_styled_paragraph(doc, checks.get('high_star_note') or '高星级企业信号仍待核实。')
    add_styled_paragraph(doc, '完整研究附件保存各阶段研究正文与原始证据摘录，可用于逐项复核。')


def _render_md_lines(doc, lines, highlight_top_tables=False, score_col_idx=None):
    """将 Markdown 行列表渲染到 doc，支持表格高亮控制。

    highlight_top_tables: 若 True，所有表格均启用表头浅灰高亮，并尝试识别评分列
    score_col_idx: 全局评分列索引（覆盖自动识别）
    """
    i = 0
    while i < len(lines):
        line = lines[i]

        # Headings (skip # which is file title, use ## and below)
        if line.startswith('# '):
            pass  # skip, we already added chapter label
        elif line.startswith('## '):
            add_heading_styled(doc, line[3:].strip(), level=2)
        elif line.startswith('### '):
            add_heading_styled(doc, line[4:].strip(), level=3)
        elif line.startswith('#### '):
            add_heading_styled(doc, line[5:].strip(), level=4)
        elif re.match(r'^[一二三四五六七八九十百零〇]+[、.．]\s*\S', line.strip()):
            # Native reports may use plain Chinese-numbered section titles.
            add_heading_styled(doc, line.strip(), level=2)
        # Table detection
        elif line.strip().startswith('|'):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                table_lines.append(lines[i])
                i += 1
            rows = parse_table(table_lines)
            # 精简版：自动检测评分列
            detected_score_col = score_col_idx
            if highlight_top_tables and detected_score_col is None and rows:
                header_row = rows[0] if rows else []
                for ci, hdr in enumerate(header_row):
                    if re.search(r'评分|得分|score', hdr, re.IGNORECASE):
                        detected_score_col = ci
                        break
            add_table_to_doc(
                doc, rows,
                highlight_header=highlight_top_tables,
                score_col_idx=detected_score_col if highlight_top_tables else None,
            )
            continue
        # Blockquote
        elif line.startswith('>'):
            text = line.lstrip('> ').strip()
            if text:
                add_styled_paragraph(doc, text, size_pt=12)
        # Horizontal rule
        elif line.strip() == '---':
            pass
        # Bullet points
        elif re.match(r'^[-*]\s', line.strip()):
            text = re.sub(r'^[-*]\s', '', line.strip())
            add_styled_paragraph(doc, text, size_pt=12, bullet=True)
        # Numbered list
        elif re.match(r'^\d+\.\s', line.strip()):
            text = re.sub(r'^\d+\.\s', '', line.strip())
            p = doc.add_paragraph(style='List Number')
            segments = re.split(r'(\*\*.+?\*\*)', text)
            for seg in segments:
                if seg.startswith('**') and seg.endswith('**'):
                    run = p.add_run(seg[2:-2])
                    set_run_font(run, 12, bold=True)
                else:
                    seg_clean = re.sub(r'\*(.+?)\*', r'\1', seg)
                    if seg_clean:
                        run = p.add_run(seg_clean)
                        set_run_font(run, 12)
            set_paragraph_spacing(p)
        # Code block (skip)
        elif line.strip().startswith('```'):
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                i += 1
        # Empty line
        elif line.strip() == '':
            pass
        # Regular paragraph
        else:
            text = line.strip()
            if text:
                add_styled_paragraph(doc, text, size_pt=12)
        i += 1


# ──────────────────────────────────────────────
# 完整版
# ──────────────────────────────────────────────

def md_to_docx(input_dir, output_path, city_name, synthetic=False):
    """Convert all markdown chapters into a single .docx."""
    doc = Document()
    set_page_margins(doc)
    _add_page_numbers(doc)
    if synthetic:
        add_styled_paragraph(doc, 'SYNTHETIC TEST — 合成测试，非真实研究', bold=True)

    # Title page
    doc.add_paragraph()  # spacing
    title_p = doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title_p.add_run(f'{_region_label(city_name)}精准招商作战报告')
    set_run_font(run, 22, bold=True)

    subtitle_p = doc.add_paragraph()
    subtitle_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle_p.add_run('慧小招 · AI招商数字员工')
    set_run_font(run, 15, bold=False)

    doc.add_page_break()

    input_path = Path(input_dir)
    evidence_path = input_path / 'evidence.json'
    if evidence_path.is_file() and (input_path / '09_compact_report.md').is_file():
        metadata = json.loads(evidence_path.read_text(encoding='utf-8')).get('stages', {})
        if any(metadata.get(filename, {}).get('selected') for filename in (
                '05a_target_enterprises_dir1.md', '05b_target_enterprises_dir2.md', '05c_target_enterprises_dir3.md')):
            _build_decision_main(doc, input_path, metadata)
            doc.save(output_path)
            return output_path

    _add_contents(doc, [CHAPTER_LABELS.get(filename, filename) for filename in CHAPTER_ORDER])
    for index, filename in enumerate(CHAPTER_ORDER):
        filepath = input_path / filename
        if not filepath.is_file():
            raise ValueError(f'Missing chapter: {filename}')

        # Chapter title from label map
        chapter_label = CHAPTER_LABELS.get(filename, filename)
        _chapter(doc, chapter_label, index)

        content = filepath.read_text(encoding='utf-8')
        lines = content.split('\n')

        _render_md_lines(doc, lines)

        # Page break between chapters
        if index < len(CHAPTER_ORDER) - 1:
            doc.add_page_break()

    doc.save(output_path)
    return output_path


# ──────────────────────────────────────────────
# 精简版
# ──────────────────────────────────────────────

def _split_compact_sections(content):
    """将 09_compact_report.md 按段落标记拆分为有序 dict。

    支持两种段落标记格式：
      <!-- SECTION: 方法论 -->   （HTML 注释风格）
      ## 第0段·方法论            （Markdown 标题风格，含"段"字）
    返回 dict {section_key: [lines]} 和 list [section_key, ...]（保持出现顺序）
    """
    # 尝试按 HTML 注释标记拆分
    section_comment_re = re.compile(
        r'<!--\s*SECTION\s*[：:]\s*(.+?)\s*-->', re.IGNORECASE
    )
    # 尝试按 Markdown 标题中含"段"字拆分，提取关键词
    section_heading_re = re.compile(
        r'^#{1,3}\s+第[0-9０-９]+段[·•·]?\s*(.+)', re.UNICODE
    )

    lines = content.split('\n')
    sections = {}       # key -> [lines]
    order = []          # 保持顺序
    current_key = None
    current_lines = []

    def _flush():
        nonlocal current_key, current_lines
        if current_key is not None:
            sections[current_key] = current_lines
        elif current_lines:
            # 文件开头无标记内容，归入 _preamble
            sections['_preamble'] = current_lines
        current_lines = []

    for line in lines:
        # 检测 HTML 注释标记
        m = section_comment_re.match(line.strip())
        if m:
            _flush()
            current_key = m.group(1).strip()
            if current_key not in order:
                order.append(current_key)
            continue

        # 检测 Markdown 段标题
        m2 = section_heading_re.match(line)
        if m2:
            _flush()
            current_key = m2.group(1).strip()
            if current_key not in order:
                order.append(current_key)
            current_lines.append(line)  # 保留标题行本身
            continue

        current_lines.append(line)

    _flush()
    return sections, order


def build_compact_docx(city, input_dir, output_path, synthetic=False):
    """读取 09_compact_report.md 生成精简版 Word 报告。

    格式与完整版相同，额外特性：
    - 文档页眉右上角：「{地区名称}精准招商作战报告（精简版）」
    - TOP5/TOP15 等重要表格表头行底色浅灰 RGB(242,242,242)
    - 评分 >= 8.5 的企业行底色浅绿 RGB(226,239,218)
    - 字数目标：完整版的 30%-40%，不超过 60 页
    """
    input_path = Path(input_dir)
    compact_file = input_path / '09_compact_report.md'

    if not compact_file.exists():
        raise ValueError('Missing compact report')

    content = compact_file.read_text(encoding='utf-8')

    doc = Document()
    set_page_margins(doc)
    _add_page_numbers(doc)
    if synthetic:
        add_styled_paragraph(doc, 'SYNTHETIC TEST — 合成测试，非真实研究', bold=True)

    # ── 页眉（右上角） ──
    region = _region_label(city)
    _add_header_right(doc, f'{region}精准招商作战报告（精简版）')

    # ── 封面 ──
    doc.add_paragraph()
    title_p = doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title_p.add_run(f'{region}精准招商作战报告')
    set_run_font(run, 22, bold=True)

    subtitle_p = doc.add_paragraph()
    subtitle_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle_p.add_run('（精简版）')
    set_run_font(run, 16, bold=True)

    subtitle2_p = doc.add_paragraph()
    subtitle2_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle2_p.add_run('慧小招 · AI招商数字员工')
    set_run_font(run, 15, bold=False)

    doc.add_page_break()

    # ── 拆分章节 ──
    sections, detected_order = _split_compact_sections(content)

    # 按照预定顺序渲染（优先使用预定义顺序，兼容文件内出现顺序）
    render_order = []
    for key in COMPACT_SECTION_ORDER:
        if key in sections:
            render_order.append(key)
    # 补充文件中检测到但预定义列表里没有的节
    for key in detected_order:
        if key not in render_order and key != '_preamble':
            render_order.append(key)

    # Native reports use numbered facts rather than the older SECTION tags.
    # Infer navigable groups without discarding any numbered fact.
    if not render_order:
        sections, render_order = _infer_compact_sections(content)
        _add_contents(doc, render_order)
        for index, key in enumerate(render_order):
            _chapter(doc, key, index)
            _render_reader_body(doc, sections[key], dense=True)
    else:
        if sections.get('_preamble'):
            render_order.insert(0, '_preamble')
        _add_contents(doc, [COMPACT_SECTION_LABELS.get(key, '概览' if key == '_preamble' else key) for key in render_order])
        for idx, key in enumerate(render_order):
            label = COMPACT_SECTION_LABELS.get(key, '概览' if key == '_preamble' else key)
            _chapter(doc, label, idx)

            section_lines = sections.get(key, [])

            # 评分章节和企业总览章节启用表格高亮
            is_score_section = key in ('评分', '企业总览')
            _render_md_lines(
                doc,
                section_lines,
                highlight_top_tables=is_score_section,
            )

            if idx < len(render_order) - 1:
                doc.add_page_break()

    doc.save(output_path)
    return output_path
