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
ENTERPRISE_STAGES = frozenset({'enterprises_1', 'enterprises_2', 'enterprises_3'})
CITATION_STAGES = RESEARCH_STAGES | ENTERPRISE_STAGES
_BRACKETS = re.compile(r'(?<!\\)(?:\[([^\]\n]*)\]|【([^】\n]*)】)')
_SOURCE_PREFIX = re.compile(r'(?:来源|source|sources)\s*[:：]?\s*$', re.I)
_INNER_PREFIX = re.compile(r'^(?:来源|sources?)\s*[:：]\s*', re.I)
_INNER_MARKER = re.compile(r'^(?:来源|sources?\b)', re.I)
_NUMBERS = re.compile(r'[1-9][0-9]*(?:\s*[,，、;；]\s*[1-9][0-9]*)*')
_LINK = re.compile(r'\[[^\]\n]*\]\(https?://[^\s()]+\)')
_URL_END = r'(?=$|[\s<>"\'()\[\]{}，；。！？：、）】]|[.!?](?=$|\s))'
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
    return frozenset(part for stage in CITATION_STAGES for mode in ('standard', 'deep')
                     for part in get_stage(stage, mode=mode)['parts'])


def _valid_record(record):
    if not isinstance(record, dict) or record.get('version') != 1:
        return False
    try:
        return record.get('id') == _digest({key: value for key, value in record.items() if key != 'id'})
    except (TypeError, ValueError):
        return False


def comparison_keys(lines, frames=(), finalizations=()):
    """Compare original line identities without editing saved prose.

    Only an exact bound-line hash in a valid server-created frame can map back
    to its pre-binding hash. Unknown/legacy lines retain their own identity.
    """
    aliases, valid_frames = {}, {}
    for frame in frames if isinstance(frames, (list, tuple)) else ():
        if not _valid_record(frame):
            continue
        valid_frames[frame['id']] = frame
        bindings = frame.get('line_bindings', [])
        for line in bindings if isinstance(bindings, list) else []:
            if not isinstance(line, dict):
                continue
            bound, model = line.get('bound_sha256'), line.get('model_sha256')
            if not all(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value)
                       for value in (bound, model)):
                continue
            aliases.setdefault(bound, set()).add(model)
    restorations = {}
    for receipt in finalizations if isinstance(finalizations, (list, tuple)) else ():
        if not _valid_record(receipt) or receipt.get('kind') != 'enterprise_citation_finalization':
            continue
        parents = receipt.get('frame_ids')
        if (not isinstance(parents, list) or not parents
                or any(not isinstance(parent, str) or parent not in valid_frames for parent in parents)):
            continue
        sources = {}
        for parent in parents:
            parent_sources = valid_frames[parent].get('sources', [])
            for source in parent_sources if isinstance(parent_sources, list) else ():
                if (isinstance(source, dict) and isinstance(source.get('label'), str)
                        and isinstance(source.get('url'), str)):
                    sources.setdefault(source['label'], set()).add(source['url'])
        records = receipt.get('definition_restorations', [])
        for record in records if isinstance(records, list) else ():
            if not isinstance(record, dict) or not isinstance(record.get('labels'), list):
                continue
            labels = record['labels']
            if (not labels or any(not isinstance(label, str) or len(sources.get(label, ())) != 1 for label in labels)
                    or not all(isinstance(record.get(key), str) and re.fullmatch(r'[0-9a-f]{64}', record[key])
                               for key in ('before_sha256', 'after_sha256'))):
                continue
            restorations.setdefault(record.get('after_sha256'), []).append((record, sources))
    result = []
    for line in lines:
        key = _digest(line)
        restored_keys = set()
        for record, sources in restorations.get(key, []) if isinstance(line, str) else ():
            restored = line
            for label in reversed(record['labels']):
                expansion = label + '：' + next(iter(sources[label]))
                if expansion not in restored:
                    break
                restored = restored.replace(expansion, label, 1)
            else:
                if _digest(restored) == record.get('before_sha256'):
                    restored_keys.add(record['before_sha256'])
        if len(restored_keys) == 1:
            key = next(iter(restored_keys))
        result.append(next(iter(aliases[key])) if len(aliases.get(key, ())) == 1 else key)
    return result


def bind_text(text, evidence, stage, part):
    """Resolve explicit local references before a part can be committed.

    The new syntax is 【来源:1】; existing unambiguous 来源[1] and grouped
    来源[1,2] are accepted too. Bare numeric brackets are ambiguous and fail
    closed. Unbracketed source numbers also fail rather than bypass binding.
    Explicit URLs/Markdown links must use exact current-frame URLs;
    ordinary brackets retain their text. The first use defines a part-qualified
    label with the exact URL; repeated uses refer to it without duplicating URLs.
    """
    # Enterprise candidate completion can call the model twice for the same
    # part. Its source 1 may refer to a different observation in each call.
    # Keep ordinary-research labels unchanged; scope enterprise labels to the
    # exact frozen call inputs, without trusting a model-supplied identifier.
    scope = (_digest({'stage': stage, 'part': part, 'evidence': evidence,
                      'model_text_sha256': _digest(text)})
             if stage in ENTERPRISE_STAGES else None)
    sources = []
    try:
        for number, item in enumerate(evidence, 1):
            url = item['url']
            if (not isinstance(url, str) or not url
                    or any(char.isspace() or ord(char) < 32 for char in url)):
                raise CitationError()
            label = f'{part}来源{number}' + (f'·{scope[:16]}' if scope else '')
            sources.append({'number': number, 'url': url,
                            'id': hashlib.sha256(url.encode('utf-8')).hexdigest(),
                            'label': label, 'evidence_sha256': _digest(item)})
    except (KeyError, TypeError, ValueError):
        raise CitationError() from None
    # Verify complete URLs before protecting them from bracket parsing. A
    # prior-stage URL is not authority to use it in this call's source frame.
    for link in re.finditer(r'(?<!\\)\[[^\]\n]*\]\(\s*<?([^\s)>]+)', text):
        if not re.match(r'https://', link.group(1), re.I):
            raise CitationError()
    urls = {source['url']: source['number'] for source in reversed(sources)}
    exact_url = re.compile('(?:' + '|'.join(re.escape(url) for url in sorted(urls, key=len, reverse=True))
                           + ')' + _URL_END) if urls else None
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
    if re.search('(?:' + '|'.join(re.escape(name) for name in parts)
                 + r')(?:[·._:#-][A-Za-z0-9]+)?来源[0-9]+', masked):
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
    if scope:
        frame['scope_sha256'] = scope
    frame['id'] = _digest(frame)
    return bound, frame


def finalize_enterprise_text(bound_text, projected_text, frames, stage, part, *, segments=None):
    """Keep immutable call frames and audit the subsequent server projection.

    Projection can remove the first definition of a label while retaining its
    later short reference. Restore that definition on the first surviving use,
    then verify the remaining labels/URLs against these call frames. This is
    not a second model binding or a claim that projected prose was model text.
    """
    from .full_contract import get_stage
    if (stage not in ENTERPRISE_STAGES or not isinstance(frames, (tuple, list)) or not frames
            or not all(isinstance(frame, dict) for frame in frames)
            or not isinstance(bound_text, str) or not isinstance(projected_text, str)
            or part not in {name for mode in ('standard', 'deep') for name in get_stage(stage, mode=mode)['parts']}):
        raise CitationError()
    segments = [bound_text] if segments is None else segments
    if (not isinstance(segments, (list, tuple)) or not all(isinstance(segment, str) for segment in segments)
            or len(segments) != len(frames) or '\n\n'.join(segments) != bound_text
            or any(_digest(segment) != frame.get('bound_text_sha256')
                   for segment, frame in zip(segments, frames))):
        raise CitationError()
    labels = {}
    for frame in frames:
        if (not _valid_record(frame) or frame.get('stage') != stage or frame.get('part') != part
                or not frame.get('scope_sha256')):
            raise CitationError()
        sources = frame.get('sources')
        if not isinstance(sources, list):
            raise CitationError()
        for source in sources:
            if not isinstance(source, dict):
                raise CitationError()
            label, url = source.get('label'), source.get('url')
            if not isinstance(label, str) or not isinstance(url, str):
                raise CitationError()
            if label in labels and labels[label] != url:
                raise CitationError()
            labels[label] = url
    before_lines, final_lines = bound_text.splitlines(), projected_text.splitlines()
    if len(before_lines) != len(final_lines):
        raise CitationError()
    restorations = {}
    for label, url in labels.items():
        pattern = re.compile(re.escape(label) + r'(?![A-Za-z0-9])')
        occurrences = [(i, match) for i, line in enumerate(final_lines)
                       for match in pattern.finditer(line)]
        if not occurrences:
            continue
        definition = re.compile(re.escape('：' + url) + _URL_END)
        if any(final_lines[i][match.end():].startswith('：')
               and not definition.match(final_lines[i][match.end():])
               for i, match in occurrences):
            raise CitationError()
        if not any(definition.match(final_lines[i][match.end():])
                   for i, match in occurrences):
            index, match = occurrences[0]
            line = final_lines[index]
            final_lines[index] = line[:match.end()] + '：' + url + line[match.end():]
            restorations.setdefault(index, []).append(label)
    final_text = '\n'.join(final_lines)
    # Every generated label remains unambiguous, including the rare possibility
    # of a truncated scope collision. Unknown labels and foreign URLs fail shut.
    token = re.compile('(?:' + '|'.join(re.escape(name) for name in _part_names())
                       + r')(?:[·._:#-][A-Za-z0-9]+)?来源[0-9]+(?:·[A-Za-z0-9]+)?')
    if any(match.group() not in labels for match in token.finditer(final_text)):
        raise CitationError()
    urls = sorted(set(labels.values()), key=len, reverse=True)
    allowed = re.compile('(?:' + '|'.join(re.escape(url) for url in urls)
                         + ')' + _URL_END) if urls else None
    url_spans = []
    for match in re.finditer(r'https?://', final_text, re.I):
        if any(start <= match.start() < end for start, end in url_spans):
            continue
        resolved = allowed.match(final_text, match.start()) if allowed else None
        if resolved is None:
            raise CitationError()
        url_spans.append(resolved.span())
    segment_bindings, offset = [], 0
    for segment, frame in zip(segments, frames):
        segment_bindings.append({'frame_id': frame['id'], 'offset': offset,
                                 'length': len(segment), 'bound_text_sha256': _digest(segment)})
        offset += len(segment) + 2
    receipt = {
        'version': 1, 'kind': 'enterprise_citation_finalization', 'stage': stage, 'part': part,
        'frame_ids': [frame['id'] for frame in frames],
        'segments': segment_bindings,
        'bound_text_sha256': _digest(bound_text), 'final_text_sha256': _digest(final_text),
        'projection_changes': [{'line': i + 1, 'bound_sha256': _digest(before),
                                'projected_sha256': _digest(after)}
                               for i, (before, after) in enumerate(zip(before_lines, projected_text.splitlines()))
                               if before != after],
        # Only a pure definition restoration on a semantically unchanged line
        # may compare as its original bound/model line. Projected lines cannot.
        'definition_restorations': [
            {'line': i + 1, 'labels': restored,
             'before_sha256': _digest(before_lines[i].strip()),
             'after_sha256': _digest(final_lines[i].strip())}
            for i, restored in restorations.items()
            if before_lines[i] == projected_text.splitlines()[i]],
    }
    receipt['id'] = _digest(receipt)
    return final_text, receipt
