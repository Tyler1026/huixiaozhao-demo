"""Body view of a public webpage, with its article-footer controls removed."""

import re


_WEB_FOOTER = re.compile(
    r'(?m)^[^\S\n]*(?:(?:相关文件|相关附件)[：:]?[^\S\n]*\n\s*)?'
    r'(?:扫一扫(?:在手机|用手机)?打开当前页|手机扫一扫打开当前页|分享到[：:]|网站导航[：:])'
    r'[^\S\n]*$'
)


def source_article_body(text):
    """Return a contiguous prefix of the original, suitable for verbatim excerpts."""
    footer = _WEB_FOOTER.search(text)
    return text[:footer.start()].rstrip() if footer else text
