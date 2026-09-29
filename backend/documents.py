"""Document extraction, mechanically relocated without behavior changes."""
import io

# 文档文本提取：PDF 用 pdfplumber，Word(.docx) 用 python-docx；缺库时优雅降级
try:
    import pdfplumber
    _PDF_AVAIL = True
except ImportError:
    _PDF_AVAIL = False
try:
    import docx as _docx
    _DOCX_AVAIL = True
except ImportError:
    _DOCX_AVAIL = False


def _extract_doc_text(filename, file_bytes):
    """从上传文件字节中提取纯文本，返回 (text, err)。支持 .pdf / .docx / 纯文本。"""
    name = (filename or "").lower()
    try:
        if name.endswith(".pdf"):
            if not _PDF_AVAIL:
                return "", "服务端未安装 pdfplumber，无法解析 PDF"
            out = []
            img_count = 0
            page_count = 0
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                page_count = len(pdf.pages)
                for page in pdf.pages:
                    t = page.extract_text() or ""
                    if t.strip():
                        out.append(t)
                    try:
                        img_count += len(page.images or [])
                    except Exception:
                        pass
            text = "\n\n".join(out).strip()
            if not text:
                return "", "PDF 未提取到文字（可能是扫描件/图片型 PDF，暂不支持 OCR）"

            # ── 【2026-09-21】网页打印型 PDF 识别 ──
            # 实测松江政策文件「沪松府规〔2022〕5号」：13MB / 6 页 / 69 张图片，
            # pdfplumber 能取到 1576 字符，但全是政府门户的导航文案
            # （"本站 搜索您想了解的政策"、"李强会见卡塔尔首相"、"处长讲政策"、"便民提示"），
            # 政策正文全在图片里。若只用"文字为空"判失败，这类文件会顺利过关，
            # 把门户导航当成政策正文写进知识库并污染 RAG 检索 —— 比解析失败更糟。
            # 判据：图片密度高（每页 >=3 张）且正文太薄（每页 <200 字），
            #       或命中多个门户导航特征词。两者都满足才拦，避免误伤正常图文混排文件。
            nav_markers = [
                "搜索您想了解的政策", "要闻动态", "统一政策发布平台", "处长讲政策",
                "政务服务", "个人办事", "法人办事", "便民提示", "友情链接",
                "市政府部门网站", "主办单位：上海市人民政府", "一网通办",
            ]
            hit_nav = [m for m in nav_markers if m in text.replace(" ", "")]
            per_page_chars = (len(text) / page_count) if page_count else len(text)
            per_page_imgs = (img_count / page_count) if page_count else img_count
            looks_like_webprint = (
                len(hit_nav) >= 3
                and per_page_imgs >= 3
                and per_page_chars < 400
            )
            if looks_like_webprint:
                return "", (
                    "这份 PDF 看起来是网页打印生成的：%d 页含 %d 张图片，"
                    "可提取的文字只有 %d 字符且主要是网站导航"
                    "（命中「%s」等），正文应在图片中无法读取。"
                    "建议改用政策原文的文字版 PDF/Word，或直接粘贴正文段落。"
                    % (page_count, img_count, len(text), "」「".join(hit_nav[:3]))
                )
            return text, None
        if name.endswith(".docx"):
            if not _DOCX_AVAIL:
                return "", "服务端未安装 python-docx，无法解析 Word"
            dd = _docx.Document(io.BytesIO(file_bytes))
            paras = [p.text for p in dd.paragraphs if p.text and p.text.strip()]
            for tbl in dd.tables:
                for row in tbl.rows:
                    cells = [c.text.strip() for c in row.cells if c.text and c.text.strip()]
                    if cells:
                        paras.append(" | ".join(cells))
            text = "\n\n".join(paras).strip()
            if not text:
                return "", "Word 文档未提取到文字"
            return text, None
        if name.endswith(".doc"):
            return "", "旧版 .doc 二进制格式不支持，请另存为 .docx 或 PDF 后再上传"
        for enc in ("utf-8", "gbk", "latin-1"):
            try:
                return file_bytes.decode(enc).strip(), None
            except Exception:
                continue
        return "", "无法解码文本文件"
    except Exception as e:
        return "", "解析失败：" + str(e)


