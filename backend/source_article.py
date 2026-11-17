"""Find readable article spans within flattened public webpage text."""

import re


_CONTROL = re.compile(
    r'简体(?:中文)?|繁体(?:中文)?|English|日本語|한국어|搜本[站網网]|搜站群|站内搜索|搜索本站|'
    r'(?:进入|开启|退出)(?:关怀|无障碍|长辈|适老)(?:模式|版)?|无障碍(?:阅读|浏览)|'
    r'扫一扫(?:在手机|用手机)?打开当前页|手机扫一扫打开当前页|分享到[：:]?|'
    r'网站导航[：:]?|网站地图|网站无障碍|打印本页|关闭窗口|返回顶部|政府网站找错|'
    r'网站标识码[：:]\s*\d+|[\u3400-\u9fff]?ICP备\d+号(?:-\d+)?',
    re.IGNORECASE,
)
_MENU = re.compile(
    r'首页|新闻中心|政务公开|政府信息公开|办事服务|政务服务|政民互动|互动交流|'
    r'改革动态|新手指南|进度查询|办事预约|意见反馈|帮助中心|掌上办|个人中心|'
    r'登录|注册|网站首页|机构概况|走进[\u3400-\u9fff]{2,10}|[\u3400-\u9fff]{2,10}概况|'
    r'中国政府网|国务院部门网站|[\u3400-\u9fff（）()]{1,28}'
    r'(?:政府网站|政务网站|设区市网站|辖市[（(]区[）)]网站|人民政府)'
)
_RELATED = re.compile(r'相关(?:文件|附件)[：:]?')
_MENU_SEPARATOR = re.compile(r'\s*[|｜·/／>]\s*|\s+')
_BOUNDARY = re.compile(r'^(?:#{1,6}\s|(?:[一二三四五六七八九十]+[、．.]|\d+[、．.])\s*\S)')
_CHROME_LABEL = re.compile(r'\[([^\]]+)\]\(https?://[^\s)]+\)')


def _menu_item(label):
    if _CONTROL.fullmatch(label):
        return True, {label}
    if _MENU.fullmatch(label):
        return False, {label}
    items = list(filter(None, _MENU_SEPARATOR.split(label)))
    if len(items) > 1 and all(_CONTROL.fullmatch(x) or _MENU.fullmatch(x) for x in items):
        return any(_CONTROL.fullmatch(x) for x in items), set(items)
    return False, set()


def source_article_spans(text):
    """Yield contiguous original spans. A web menu cannot join two claims."""
    run, items, has_control, start, position = [], set(), False, 0, 0
    for line in text.splitlines(keepends=True) + ['\0']:
        label = line.strip()
        if not label:
            position += len(line)
            continue
        if not _BOUNDARY.match(label):
            label = re.sub(r'^(?:>\s*)+|^[-*]\s+', '', label).strip()
            label = _CHROME_LABEL.sub(r'\1', label.strip('*')).strip()
        control, current_items = _menu_item(label)
        related = bool(_RELATED.fullmatch(label))
        if current_items or related:
            run.append((position, position + len(line), related))
            items.update(current_items)
            has_control |= control
        else:
            if run and (has_control or len(items) > 1):
                # “相关文件” is a real heading if it follows the menu.
                while run and run[-1][2]:
                    run.pop()
                end = run[0][0]
                if end > start:
                    yield text[start:end]
                start = run[-1][1]
            run, items, has_control = [], set(), False
        position += len(line)
    if start < len(text):
        yield text[start:]


def source_article_body(text):
    """Provide a display/context view while leaving archived evidence intact."""
    spans = list(source_article_spans(text))
    return text if spans == [text] else '\n\n'.join(part.strip() for part in spans if part.strip())
