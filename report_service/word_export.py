#!/usr/bin/env python3
"""慧小招报告 Markdown → Word 合并脚本 v3.1
格式要求：仿宋正文小四(12pt)、标题仿宋加粗、表格五号(10.5pt)、1.5倍行距、标准公文页边距
章节顺序按报告逻辑重排：摘要→方向→产业链缺口→目标企业→评分→行动→基础数据附录
v3.1 新增：--compact 精简版输出支持
"""
import re
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

def set_run_font(run, size_pt, bold=False):
    """Set font to FangSong with given size."""
    run.font.name = FONT_NAME
    run.font.size = Pt(size_pt)
    run.font.bold = bold
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
    p = doc.add_paragraph()
    run = p.add_run(text)
    set_run_font(run, size, bold=True)
    set_paragraph_spacing(p)
    # Spacing before heading
    pf = p.paragraph_format
    pf.space_before = Pt(12 if level >= 2 else 18)
    pf.space_after = Pt(6)
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
    if synthetic:
        add_styled_paragraph(doc, 'SYNTHETIC TEST — 合成测试，非真实研究', bold=True)

    # Title page
    doc.add_paragraph()  # spacing
    title_p = doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title_p.add_run(f'{city_name}市精准招商作战报告')
    set_run_font(run, 22, bold=True)

    subtitle_p = doc.add_paragraph()
    subtitle_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle_p.add_run('慧小招 · AI招商数字员工')
    set_run_font(run, 15, bold=False)

    doc.add_page_break()

    input_path = Path(input_dir)

    for filename in CHAPTER_ORDER:
        filepath = input_path / filename
        if not filepath.is_file():
            raise ValueError(f'Missing chapter: {filename}')

        # Chapter title from label map
        chapter_label = CHAPTER_LABELS.get(filename, filename)
        add_heading_styled(doc, chapter_label, level=1)

        content = filepath.read_text(encoding='utf-8')
        lines = content.split('\n')

        _render_md_lines(doc, lines)

        # Page break between chapters
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
    - 文档页眉右上角：「{city}市精准招商作战报告（精简版）」
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
    if synthetic:
        add_styled_paragraph(doc, 'SYNTHETIC TEST — 合成测试，非真实研究', bold=True)

    # ── 页眉（右上角） ──
    _add_header_right(doc, f'{city}市精准招商作战报告（精简版）')

    # ── 封面 ──
    doc.add_paragraph()
    title_p = doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title_p.add_run(f'{city}市精准招商作战报告')
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

    # 若文件未使用段落标记，则整体渲染
    if not render_order:
        lines = content.split('\n')
        _render_md_lines(doc, lines, highlight_top_tables=True)
    else:
        for idx, key in enumerate(render_order):
            label = COMPACT_SECTION_LABELS.get(key, key)
            add_heading_styled(doc, label, level=1)

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
