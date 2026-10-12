"""Request-local context for city knowledge-base conversations.

These records describe material sent to the model, not verified facts. Nothing
here fetches URLs or joins material from another project or a previous request.
"""
import hashlib
import re
from urllib.parse import urlsplit


_URL = re.compile(r'https?://[^\s<>\[\]（），。；、"\'`]+', re.I)


def safe_source_url(value):
    """Accept an existing HTTP(S) link without credentials or active content."""
    if not isinstance(value, str):
        return ''
    value = value.strip().rstrip('.,;，。；')
    while value.endswith(')') and value.count(')') > value.count('('):
        value = value[:-1]
    if not value or len(value) > 4096 or re.search(r'[\s\x00-\x20\x7f<>"\'`\\]', value):
        return ''
    try:
        parsed = urlsplit(value)
        if (parsed.scheme.lower() not in ('http', 'https') or not parsed.hostname
                or parsed.username is not None or parsed.password is not None):
            return ''
        parsed.port  # Invalid or out-of-range ports raise ValueError.
    except ValueError:
        return ''
    return value


def _label(value, limit=240):
    return value.strip()[:limit] if isinstance(value, str) else ''


def chat_sources(chunks):
    """Project only selected chunks; a valid URL is not a factual endorsement."""
    sources = []
    for chunk in chunks:
        row = chunk if isinstance(chunk, dict) else {}
        text = chunk if isinstance(chunk, str) else row.get('text', '')
        text = text if isinstance(text, str) else str(text or '')
        candidates = _URL.findall(text)
        # Keep provenance already attached to this exact chunk. In particular,
        # never resolve a bare 'source[1]' against another chunk's bibliography.
        for field in ('url', 'source', 'src', 'cite'):
            value = row.get(field)
            if isinstance(value, str):
                candidates.extend(_URL.findall(value))
        for field in ('sources', 'urls'):
            for value in row.get(field, []) if isinstance(row.get(field), list) else []:
                candidates.append(value.get('url') if isinstance(value, dict) else value)
        urls = list(dict.fromkeys(url for value in candidates if (url := safe_source_url(value))))
        sources.append({
            'id': _label(row.get('id')) or 'chunk_'+hashlib.sha256(text.encode()).hexdigest()[:20],
            'cite': _label(row.get('cite')),
            'topic': _label(row.get('topic')),
            'text': text,
            'urls': urls,
            'traceable': bool(urls),
        })
    return sources


def chat_context(sources):
    """The displayed source records and model evidence use the same text/URLs."""
    return '\n\n'.join(
        '[材料%d｜%s｜%s·%s]\n%s\n原始链接：%s' % (
            index, source['id'], source['cite'], source['topic'], source['text'],
            '；'.join(source['urls']) or '本片段未附可追溯原始链接（仅有来源编号或主题名不构成原始链接）')
        for index, source in enumerate(sources, 1)
    )


def conversation_history(history, question, max_messages=8, max_content=1500):
    """Keep recent user/assistant text, excluding the pending question at tail."""
    if not isinstance(history, list):
        return []
    valid = []
    for item in reversed(history):
        if not isinstance(item, dict) or item.get('role') not in ('user', 'assistant'):
            continue
        content = item.get('content')
        if not isinstance(content, str) or not content.strip():
            continue
        content = content.strip()
        # Older clients append the pending user message before calling us.
        # Remove it before truncation; the final user message is added below.
        if not valid and item['role'] == 'user' and content == question:
            continue
        valid.append({'role': item['role'], 'content': content[:max_content]})
        if len(valid) >= max_messages:
            break
    return list(reversed(valid))
