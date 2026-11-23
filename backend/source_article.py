"""Find readable article spans within flattened public webpage text."""

import html
import re


_CONTROL = re.compile(
    r'(?:字号\s*[：:]\s*(?:默认|小|中|大|\s)+[;；]?|【?字体\s*[：:]\s*[大中小\s]+】?|字体大小\s*[：:]\s*(?:放大|正常|缩小|\s)+|打印)|简体(?:中文)?|繁体(?:中文)?|English|日本語|한국어|搜本[站網网]|搜站群|站内搜索|搜索本站|'
    r'(?:进入|开启|退出)(?:关怀|无障碍|长辈|适老)(?:模式|版)?|无障碍(?:阅读|浏览)|'
    r'扫一扫(?:在手机|用手机)?打开当前页|手机扫一扫打开当前页|分享到[：:]?|'
    r'网站导航[：:]?|网站地图|网站无障碍|打印本页|关闭窗口|返回顶部|政府网站找错|网站纠错|'
    r'政务邮箱登录|(?:当前(?:所在)?|您所在)位置[：:]?\s*(?:首页|网站首页|门户首页)?|(?:访问量|浏览量)\s*[：:]\s*[\d,]*|'
    r'(?:政务服务|一网通办)(?:公众号|小程序)|'
    r'网站标识码[：:]\s*\d+|[\u3400-\u9fff]?ICP备\d+号(?:-\d+)?',
    re.IGNORECASE,
)
_MENU = re.compile(
    r'首页|新闻中心|政务公开|政府信息公开|办事服务|政务服务|政民互动|互动交流|'
    r'改革动态|新手指南|进度查询|办事预约|意见反馈|帮助中心|掌上办|个人中心|'
    r'登录|注册|网站首页|门户首页|机构概况|走进[\u3400-\u9fff]{2,10}|'
    r'[\u3400-\u9fff]{2,10}(?:概况|概览|要闻)|新闻动态|区镇快讯|数据开放|'
    r'老年服务|无障碍|关怀版|适老版|长者版|智能问答|智能客服|政务邮箱|'
    r'了解详情|用户空间|在线客服|相关办事链接|办事平台|'
    r'中国政府网|国务院部门网站|[\u3400-\u9fff（）()]{1,28}'
    r'(?:政府网站|政务网站|设区市网站|辖市[（(]区[）)]网站|人民政府)'
)
_RELATED = re.compile(r'相关(?:文件|附件)[：:]?')
_MENU_SEPARATOR = re.compile(r'\s*[|｜·/／>›»→]\s*|\s+')
_BOUNDARY = re.compile(r'^(?:#{1,6}\s|(?:[一二三四五六七八九十]+[、．.]|\d+[、．.])\s*\S)')
_CHROME_LABEL = re.compile(r'\[([^\]]+)\]\(https?://[^\s)]+\)')
_BREADCRUMB = re.compile(
    r'(?:(?:当前(?:所在)?|您所在)位置\s*[：:]\s*)?'
    r'(?:首页|网站首页|门户首页)(?:\s*(?:[>›»→/／]\s*)+[\w（）() \u3000]{0,36}){1,8}'
)
_TITLE_WITH_SITE = re.compile(
    r'(.{8,180}?)\s+[-–—｜|]\s+[\u3400-\u9fff]{2,24}(?:人民政府|政府门户网站|政务服务网)'
)


_SITE_WITH_TITLE = re.compile(r'[\u3400-\u9fff]{2,24}(?:人民政府|政府门户网站|政务服务网)\s+(?:(?:地方动态|要闻动态|新闻中心|文件通知)\s+){0,3}(.{8,180})')


def _menu_item(label):
    if _CONTROL.fullmatch(label) or _BREADCRUMB.fullmatch(label):
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
    previous_position, previous_title = 0, None
    for line in text.splitlines(keepends=True) + ['\0']:
        label = line.strip()
        if not label:
            position += len(line)
            continue
        if not _BOUNDARY.match(label):
            label = re.sub(r'^(?:>\s*)+|^[-*]\s+', '', label).strip()
            label = _CHROME_LABEL.sub(r'\1', label.strip('*')).strip()
        # Decode only for classification: emitted excerpts remain slices of
        # the exact source, including their punctuation and original encoding.
        label = html.unescape(html.unescape(label)).strip()
        possible_path = _CHROME_LABEL.sub(r'\1', re.sub(r'^#{1,6}\s+', '', label)).strip()
        possible_path = re.sub(r'[;；/\s]*字号\s*[：:]\s*(?:默认|小|中|大|\s)+[;；]?[”\"]?$', '', possible_path).strip('“”\" ;；')
        if _BREADCRUMB.fullmatch(possible_path):
            label = possible_path
        control, current_items = _menu_item(label)
        # A flattened menu may split its location and path across two lines.
        if (not current_items and any(re.search(r'位置|首页', x) for x in items)
                and re.search(r'[>›»→/／]', label)
                and re.fullmatch(r'(?:[>›»→/／]\s*)?[\w（）() \u3000]{1,36}(?:\s*(?:[>›»→/／]\s*)+[\w（）() \u3000]{1,36}){0,7}', label)):
            control, current_items = True, {label}
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
                if has_control and previous_title and previous_title == re.sub(r'^#{1,6}\s+', '', label):
                    end = previous_position
                if end > start:
                    yield text[start:end]
                start = run[-1][1]
            run, items, has_control = [], set(), False
            previous_position = position
            duplicate_title = _TITLE_WITH_SITE.fullmatch(label) or _SITE_WITH_TITLE.fullmatch(label)
            previous_title = duplicate_title[1] if duplicate_title else None
        position += len(line)
    if start < len(text):
        yield text[start:]


def source_article_body(text):
    """Provide a display/context view while leaving archived evidence intact."""
    spans = list(source_article_spans(text))
    return text if spans == [text] else '\n\n'.join(part.strip() for part in spans if part.strip())

def source_publication_date(text, explicit=''):
    """Use an explicit publication field or a labelled original date, never an arbitrary year."""
    import datetime
    def valid(value):
        match = re.search(r'(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})', str(value or ''))
        if not match:
            return ''
        try:
            return datetime.date(*map(int, match.groups())).isoformat()
        except ValueError:
            return ''
    supplied = str(explicit or '').strip()
    if not re.search(r'未知|未确认|待核|不详', supplied):
        date = valid(supplied)
        if date:
            return date
    match = re.search(r'(?<!\w)(?:发布日期|发布时间|发文日期|成文日期|日期|时间)\s*[：:]?\s*(20\d{2}[-年/]\d{1,2}[-月/]\d{1,2}日?)', str(text or '')[:6000])
    return valid(match[1]) if match else ''
