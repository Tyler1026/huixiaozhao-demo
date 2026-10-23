"""Bind research prose to the exact sources shown in one model call.

This module never reconstructs a frame from accumulated stage evidence. Saved
legacy prose is not an input to the binder and is never rewritten here.
"""
from __future__ import annotations

import hashlib
import json
import re
from functools import lru_cache


RESEARCH_STAGES = frozenset({
    'economy', 'population', 'transport', 'life', 'industry',
    'competition', 'policy', 'chain',
})
_BRACKETS = re.compile(r'(?<!\\)(?:\[([^\]\n]*)\]|【([^】\n]*)】)')
_SOURCE_PREFIX = re.compile(r'(?:来源|source|sources)\s*[:：]?\s*$', re.I)
_INNER_PREFIX = re.compile(r'^(?:来源|sources?)\s*[:：]\s*', re.I)
_INNER_MARKER = re.compile(r'^(?:来源|sources?\b)', re.I)
_NUMBERS = re.compile(r'[1-9][0-9]*(?:\s*[,，、;；]\s*[1-9][0-9]*)*')
_LINK = re.compile(r'\[[^\]\n]*\]\(https?://[^\s()]+\)')
_UNBOUND_SOURCE_NUMBER = re.compile(
    r'(?<![A-Za-z0-9_])(?:来源|sources?)\s*[:：]?\s*(?:[（(]\s*)?'
    r'(?!\d{4}\s*年)[-+−]?\d', re.I)


class CitationError(ValueError):
    """Static exception text: never include source or model content."""

    def __init__(self):
        super().__init__('research citation reference is invalid')


class BoundPayload(str):
    """Carry a server-created frame separately from untrusted model JSON."""

    def __new__(cls, text, frame):
        value = super().__new__(cls, text)
        value.citation_frame = frame
        return value


def _digest(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(',', ':'), allow_nan=False).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


@lru_cache(maxsize=1)
def _part_names():
    from .full_contract import get_stage
    return frozenset(part for stage in RESEARCH_STAGES for mode in ('standard', 'deep')
                     for part in get_stage(stage, mode=mode)['parts'])


def comparison_keys(lines, frames=()):
    """Compare original line identities without editing saved prose.

    Only an exact bound-line hash in a valid server-created frame can map back
    to its pre-binding hash. Unknown/legacy lines retain their own identity.
    """
    aliases = {}
    for frame in frames if isinstance(frames, (list, tuple)) else ():
        if not isinstance(frame, dict) or frame.get('version') != 1:
            continue
        unsigned = {key: value for key, value in frame.items() if key != 'id'}
        try:
            valid = frame.get('id') == _digest(unsigned)
        except (TypeError, ValueError):
            valid = False
        if not valid:
            continue
        bindings = frame.get('line_bindings', [])
        for line in bindings if isinstance(bindings, list) else []:
            if not isinstance(line, dict):
                continue
            bound, model = line.get('bound_sha256'), line.get('model_sha256')
            if not all(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value)
                       for value in (bound, model)):
                continue
            aliases.setdefault(bound, set()).add(model)
    return [next(iter(aliases[key])) if len(aliases.get(key, ())) == 1 else key
            for key in (_digest(line) for line in lines)]


def bind_text(text, evidence, stage, part):
    """Resolve explicit local references before a part can be committed.

    The new syntax is 【来源:1】; existing unambiguous 来源[1] and grouped
    来源[1,2] are accepted too. Bare numeric brackets are ambiguous and fail
    closed. Unbracketed source numbers also fail rather than bypass binding.
    Explicit URLs/Markdown links must use exact current-frame URLs;
    ordinary brackets retain their text. The first use defines a part-qualified
    label with the exact URL; repeated uses refer to it without duplicating URLs.
    """
    sources = []
    try:
        for number, item in enumerate(evidence, 1):
            url = item['url']
            if (not isinstance(url, str) or not url
                    or any(char.isspace() or ord(char) < 32 for char in url)):
                raise CitationError()
            sources.append({'number': number, 'url': url,
                            'id': hashlib.sha256(url.encode('utf-8')).hexdigest(),
                            'label': f'{part}来源{number}', 'evidence_sha256': _digest(item)})
    except (KeyError, TypeError, ValueError):
        raise CitationError() from None
    # Verify complete URLs before protecting them from bracket parsing. A
    # prior-stage URL is not authority to use it in this call's source frame.
    for link in re.finditer(r'(?<!\\)\[[^\]\n]*\]\(\s*<?([^\s)>]+)', text):
        if not re.match(r'https://', link.group(1), re.I):
            raise CitationError()
    urls = {source['url']: source['number'] for source in reversed(sources)}
    exact_url = re.compile('(?:' + '|'.join(re.escape(url) for url in sorted(urls, key=len, reverse=True))
                           + r')(?=$|[\s<>"\'()\[\]{}，；。！？：、）】]|[.!?](?=$|\s))') if urls else None
    explicit_urls, url_spans = [], []
    for start in re.finditer(r'https?://', text, re.I):
        if any(begin <= start.start() < end for begin, end in url_spans):
            continue
        match = exact_url.match(text, start.start()) if exact_url else None
        if match is None:
            raise CitationError()
        explicit_urls.append(urls[match.group(0)])
        url_spans.append(match.span())
    masked = list(text)
    for start, end in url_spans:
        masked[start:end] = ' ' * (end - start)
    masked = ''.join(masked)
    parts = _part_names() | {part}
    if re.search('(?:' + '|'.join(re.escape(name) for name in parts) + r')来源[0-9]+', masked):
        raise CitationError()
    protected = url_spans + [match.span() for match in _LINK.finditer(text)]
    used = []
    expanded = set()
    resolved_spans = []

    def resolve(match):
        raw = match.group(1) if match.group(1) is not None else match.group(2)
        inner = _INNER_PREFIX.match(raw.strip())
        prefix = _SOURCE_PREFIX.search(text[:match.start()])
        marked = bool(_INNER_MARKER.match(raw.strip()) or prefix)
        if any(start <= match.start() < end for start, end in url_spans):
            return match.group(0)
        if not marked and any(start <= match.start() < end for start, end in protected):
            return match.group(0)
        numbers = raw.strip()[inner.end():] if inner else raw.strip()
        numeric = bool(re.match(r'[-+]?\d', numbers))
        if not marked and not numeric:
            return match.group(0)
        if not marked or not _NUMBERS.fullmatch(numbers):
            raise CitationError()
        try:
            indexes = [int(number) for number in re.split(r'\s*[,，、;；]\s*', numbers)]
        except ValueError:
            raise CitationError() from None
        if any(number > len(sources) for number in indexes):
            raise CitationError()
        resolved_spans.append((prefix.start() if prefix else match.start(), match.end()))
        used.extend(indexes)
        labels = []
        for number in indexes:
            source = sources[number - 1]
            # Give every label its exact URL on first use. Subsequent uses of
            # the same part-qualified label remain resolvable without adding
            # repeated URLs that would hit the existing URL-filler gate.
            label = source['label']
            if number not in expanded:
                label += '：' + source['url']
                expanded.add(number)
            labels.append(label)
        return '(' + '；'.join(labels) + ')'

    bound = _BRACKETS.sub(resolve, text)
    remaining = _BRACKETS.sub('', masked)
    unbound = list(masked)
    for start, end in protected + resolved_spans:
        unbound[start:end] = ' ' * (end - start)
    if (_UNBOUND_SOURCE_NUMBER.search(''.join(unbound))
            or re.search(r'(?:来源|sources?)\s*[:：]?\s*[\[【]|(?<!\\)[\[【]\s*(?:来源|sources?\b|[-+]?\d)',
                         remaining, re.I)):
        raise CitationError()
    frame = {'version': 1, 'stage': stage, 'part': part, 'sources': sources,
             'references': used, 'explicit_url_references': explicit_urls,
             'model_text_sha256': _digest(text), 'bound_text_sha256': _digest(bound),
             'line_bindings': [{'bound_sha256': _digest(after.strip()), 'model_sha256': _digest(before.strip())}
                               for before, after in zip(text.splitlines(), bound.splitlines()) if before != after]}
    frame['id'] = _digest(frame)
    return bound, frame
