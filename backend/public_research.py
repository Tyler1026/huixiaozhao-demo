"""Read-only, validated archives of public primary-source research.

The archive contains source text, not industrial conclusions.  Enrichment does
not perform a network request, change a live-research status, or claim that an
old source was fetched again.  Company websites are accepted only when a valid
disclosure excerpt identifies the website next to its company-website field.
"""
from __future__ import annotations

import copy
import datetime as dt
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from report_service import full_contract
from report_service.providers import validate_https_url

from .topic_evidence import topic_terms


DEFAULT_DIRECTORY = Path(__file__).resolve().parents[1] / 'data' / 'public-research'
MAX_FILES = 100
MAX_FILE_BYTES = 2_000_000
MAX_FULLTEXT_CHARS = 120_000
MAX_QUOTE_CHARS = 5_000
MAX_ARCHIVE_ROWS = 32
MAX_MERGED_ROWS = 96
MAX_ARCHIVE_QUOTE_CHARS = 40_000
# These are disclosure publishers, never an allow-list of researched companies.
_DISCLOSURE_HOSTS = ('cninfo.com.cn', 'sse.com.cn', 'szse.cn', 'hkexnews.hk')
_WEBSITE = re.compile(
    r'(?:公司网址|公司官网|官方网站)[ \t\r\n：:]{0,16}'
    r'(?:https?://)?(?P<host>(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+'
    r'[A-Za-z]{2,24})(?=$|[\s/，。；;、）)\]"\'<>])')
_HOST = re.compile(r'(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}')
_PUBLIC_SUFFIXES = {'com', 'org', 'net', 'cn', 'gov.cn', 'com.cn', 'org.cn',
                    'net.cn', 'edu.cn', 'co.uk', 'org.uk', 'com.au', 'co.jp'}


def _digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def _public_url(value):
    try:
        validate_https_url(value)
        parsed = urlsplit(value)
        host = (parsed.hostname or '').lower()
        # A cached URL is still provenance: reject deceptive or malformed hosts.
        if not _HOST.fullmatch(host) or parsed.port not in (None, 443):
            return ''
        return host
    except (ValueError, TypeError):
        return ''


def _authority(host):
    kind = full_contract.classify_source_type(host)
    if kind == 'government':
        return 'government'
    # Do not inherit broad media/forum domains from the general report source
    # classifier: a user-authored post must not attest a corporate website.
    if any(host == domain or host.endswith('.' + domain) for domain in _DISCLOSURE_HOSTS):
        return 'disclosure'
    return ''


def _publisher(host):
    parts = host.lower().split('.')
    return '.'.join(parts[-3:] if host.endswith(('.gov.cn', '.com.cn', '.org.cn')) else parts[-2:])


def _set_origins(sources, rows):
    """Union same-document pages and exact mirrors, including bridge records."""
    valid = {sid: source for sid, source in sources.items() if isinstance(source, dict)
             and _public_url(source.get('url')) and isinstance(source.get('fulltext'), str)
             and source.get('fulltext_sha256') == _digest(source['fulltext'])}
    parent = {sid: sid for sid in valid}

    def find(sid):
        while parent[sid] != sid:
            parent[sid] = parent[parent[sid]]
            sid = parent[sid]
        return sid

    seen = {}
    for sid, source in valid.items():
        keys = [('url', full_contract.canonical_url(source['url'])),
                ('text', source['fulltext_sha256'])]
        if isinstance(source.get('origin_id'), str) and source['origin_id']:
            # Live retrieval may already have recognized a rewritten mirror.
            # Additional archive evidence can merge origins, never split them.
            keys.append(('existing_origin', source['origin_id']))
        for key in keys:
            if key in seen:
                parent[find(sid)] = find(seen[key])
            seen[key] = sid
    groups = {}
    for sid in valid:
        groups.setdefault(find(sid), []).append(sid)
    for group in groups.values():
        known = [valid[sid]['origin_id'] for sid in group if isinstance(valid[sid].get('origin_id'), str)
                 and valid[sid]['origin_id']]
        origin = min(known) if known else 'origin_' + _digest(min(
            full_contract.canonical_url(valid[sid]['url']) for sid in group))[:20]
        for sid in group:
            sources[sid]['origin_id'] = origin
    for row in rows:
        if isinstance(row, dict) and row.get('source_id') in valid:
            row['origin_id'] = sources[row['source_id']]['origin_id']


def _timestamp(value):
    if not isinstance(value, str) or len(value) > 80:
        return False
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.tzinfo is not None
    except ValueError:
        return False


def _validated_source(source_id, value, archive_file):
    if not isinstance(value, dict):
        return None
    for field in ('title', 'published_at', 'published', 'fulltext_scope', 'extraction'):
        if field in value and not isinstance(value[field], str):
            return None
    if 'pdf_page' in value and (type(value['pdf_page']) is not int or not 1 <= value['pdf_page'] <= 10000):
        return None
    url, text = value.get('url'), value.get('fulltext')
    host = _public_url(url)
    if (not host or not isinstance(text, str) or not 20 <= len(text) <= MAX_FULLTEXT_CHARS
            or value.get('id') != source_id
            or source_id != 'source_' + _digest(full_contract.canonical_url(url) + '\0' + text)[:20]
            or value.get('fulltext_sha256') != _digest(text)
            or value.get('retrieval') != 'fetched'
            or not _timestamp(value.get('retrieved_at'))):
        return None
    # Deliberately copy only provenance.  Ratings and other authored fields are
    # not allowed into an archive-backed source via an extra JSON property.
    result = {key: copy.deepcopy(value[key]) for key in (
        'id', 'url', 'title', 'published_at', 'published', 'retrieved_at',
        'fulltext', 'fulltext_sha256', 'fulltext_scope', 'pdf_page', 'extraction')
        if key in value}
    result.update(source_type=_authority(host), retrieval='fetched', status='source',
                  publisher_id=_publisher(host), archived=True,
                  archive_file=archive_file, archive_retrieved_at=value['retrieved_at'])
    return result


def _validated_row(value, sources, archive_file):
    if not isinstance(value, dict):
        return None
    source_id, quote, url = value.get('source_id'), value.get('quote'), value.get('url')
    source = sources.get(source_id) if isinstance(source_id, str) else None
    if (not source or not isinstance(quote, str) or not 20 <= len(quote) <= MAX_QUOTE_CHARS
            or quote not in source['fulltext'] or url != source['url']
            or value.get('id') != 'tr_' + _digest(url + '\0' + quote)[:20]
            or value.get('retrieval') != 'fetched'
            or value.get('retrieved_at') != source['retrieved_at']
            or (value.get('fulltext_sha256') not in (None, source['fulltext_sha256']))):
        return None
    result = {key: source[key] for key in (
        'url', 'title', 'published_at', 'published', 'retrieved_at', 'source_type',
        'publisher_id', 'fulltext_sha256', 'fulltext_scope', 'pdf_page', 'extraction')
        if key in source}
    result.update(id=value['id'], source_id=source_id, quote=quote, excerpt=quote,
                  retrieval='fetched', status='source', archived=True,
                  archive_file=archive_file, archive_retrieved_at=source['retrieved_at'])
    return result


def _website_domains(rows):
    domains = {}
    for row in rows:
        if row['source_type'] != 'disclosure' or not _disclosure_document(row['url']):
            continue
        for match in _WEBSITE.finditer(row['quote']):
            host = match.group('host').lower()
            base = host.removeprefix('www.')
            if (base in _PUBLIC_SUFFIXES or not _HOST.fullmatch(base)
                    or not _public_url('https://' + base)):
                continue
            domains.setdefault(base, {'domain': base, 'website_host': host,
                'evidence_id': row['id'], 'source_id': row['source_id'],
                'url': row['url'], 'website_text': match.group(0)})
    return domains


def _disclosure_document(url):
    """Only issuer disclosure documents may attest another website's owner."""
    parsed = urlsplit(url)
    host, path = (parsed.hostname or '').lower(), parsed.path.lower()
    if host == 'static.cninfo.com.cn':
        return bool(re.fullmatch(r'/finalpage/\d{4}-\d{2}-\d{2}/\d+\.pdf', path))
    if host == 'static.sse.com.cn':
        return path.startswith('/stock/disclosure/announcement/') and path.endswith('.pdf')
    if host in ('disc.static.szse.cn', 'static.szse.cn'):
        return path.startswith('/download/disc/') and path.endswith('.pdf')
    if host in ('www.hkexnews.hk', 'hkexnews.hk'):
        return path.startswith('/listedco/listconews/') and path.endswith('.pdf')
    return False


def load_public_research(directory=None):
    """Load validated text and its website attestations, without network I/O.

    ``directory`` is a server-configured archive directory, not a client path.
    Invalid records are skipped independently; an invalid disclosure can never
    authorize a company source.  No supplied source-type or rating is trusted.
    """
    folder = Path(directory) if directory is not None else DEFAULT_DIRECTORY
    result = {'sources': {}, 'evidence': [], 'domain_evidence': {},
              'trusted_company_domains': [], 'files': [], 'rejected_count': 0}
    if not folder.is_dir():
        return result
    candidate_sources, candidate_rows = {}, []
    for path in sorted(folder.glob('*.json'))[:MAX_FILES]:
        try:
            if path.is_symlink() or path.stat().st_size > MAX_FILE_BYTES:
                raise ValueError('invalid_archive_file')
            document = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(document, dict) or not isinstance(document.get('sources'), dict):
                raise ValueError('invalid_archive_document')
            result['files'].append(path.name)
            for source_id, value in document['sources'].items():
                source = _validated_source(source_id, value, path.name)
                if not source or (source_id in candidate_sources
                                  and source['fulltext'] != candidate_sources[source_id]['fulltext']):
                    result['rejected_count'] += 1
                    continue
                candidate_sources.setdefault(source_id, source)
            for value in document.get('evidence', []):
                candidate_rows.append((value, path.name))
        except (OSError, UnicodeError, ValueError, TypeError):
            result['rejected_count'] += 1
    rows = []
    for value, archive_file in candidate_rows:
        row = _validated_row(value, candidate_sources, archive_file)
        if row:
            rows.append(row)
        else:
            result['rejected_count'] += 1
    domains = _website_domains(rows)
    allowed_sources = {}
    for source_id, source in candidate_sources.items():
        if not source['source_type']:
            host = _public_url(source['url'])
            domain = next((d for d in domains if host == d or host.endswith('.' + d)), None)
            if not domain:
                result['rejected_count'] += 1
                continue
            source['source_type'] = 'company'
            source['website_attestation'] = copy.deepcopy(domains[domain])
        allowed_sources[source_id] = source
    unique = {}
    for row in rows:
        source = allowed_sources.get(row['source_id'])
        if not source:
            continue
        row.update(source_type=source['source_type'])
        if source.get('website_attestation'):
            row['website_attestation'] = copy.deepcopy(source['website_attestation'])
        unique.setdefault(row['id'], row)
    used = {row['source_id'] for row in unique.values()}
    _set_origins(allowed_sources, list(unique.values()))
    result.update(sources={key: value for key, value in allowed_sources.items() if key in used},
                  evidence=list(unique.values()), domain_evidence=domains,
                  trusted_company_domains=sorted(domains))
    return result


def _city_terms(city):
    city = re.sub(r'\s+', '', city)
    short = re.sub(r'(?:特别行政区|自治州|自治区|省|市|区|县)$', '', city)
    return {word for word in (city, short) if len(word) >= 2}


def enrich_public_research(research, city, topic, directory=None):
    """Deep-copy ``research`` and append relevant validated archive excerpts.

    Selection uses the shared public topic vocabulary.  City mentions affect
    ordering only; they do not turn national statistics or an office address
    into local production evidence.  Live research flags/status are unchanged.
    """
    if not isinstance(research, dict):
        raise ValueError('research must be a mapping')
    if not isinstance(city, str) or not city.strip() or not isinstance(topic, str) or not topic.strip():
        raise ValueError('public city and topic are required')
    if (research.get('city') not in (None, city) or research.get('topic') not in (None, topic)):
        raise ValueError('research scope mismatch')
    merged = copy.deepcopy(research)
    library = load_public_research(directory)
    meta = {'status': 'no_match', 'retrieval': 'archive', 'network_requested': False,
            'added_evidence_ids': [], 'files': library['files'],
            'rejected_count': library['rejected_count'],
            'trusted_company_domains': [], 'domain_evidence': []}
    merged['public_research'] = meta
    terms = [t.casefold() for t in topic_terms(topic)]
    cities = _city_terms(city)
    candidates = []
    for row in library['evidence']:
        text = (row['quote'] + '\n' + row.get('title', '')).casefold()
        matches = [term for term in terms if term in text]
        if matches:
            source = library['sources'][row['source_id']]
            local = any(word in source['fulltext'] for word in cities)
            candidates.append((not local, -sum(min(len(t), 8) for t in matches), row['id'], row))
    evidence = merged.setdefault('evidence', [])
    sources = merged.setdefault('sources', {})
    if not isinstance(evidence, list) or not isinstance(sources, dict):
        raise ValueError('research evidence and sources have invalid types')
    existing_rows = {r.get('id'): r for r in evidence if isinstance(r, dict)}
    existing_ids = set(existing_rows)

    def valid_existing(row):
        current = existing_rows.get(row['id'])
        source = sources.get(row['source_id'])
        return (isinstance(current, dict) and isinstance(source, dict)
                and all(current.get(key) == row.get(key) for key in ('id', 'url', 'quote', 'source_id'))
                and source.get('id') == row['source_id']
                and source.get('url') == row['url']
                and source.get('fulltext_sha256') == row['fulltext_sha256']
                and isinstance(source.get('fulltext'), str)
                and _digest(source['fulltext']) == row['fulltext_sha256'])
    rows_by_id = {row['id']: row for row in library['evidence']}
    remaining = min(MAX_ARCHIVE_ROWS, max(0, MAX_MERGED_ROWS - len(evidence)))
    added, size = [], 0
    for _, _, _, row in sorted(candidates):
        if row['id'] in existing_ids:
            if not valid_existing(row):
                meta['rejected_count'] += 1
            continue
        group = [row]
        attestation = row.get('website_attestation')
        if attestation:
            attestation_row = rows_by_id[attestation['evidence_id']]
            if attestation['evidence_id'] not in existing_ids:
                group.insert(0, attestation_row)
            elif not valid_existing(attestation_row):
                meta['rejected_count'] += 1
                continue
        if len(group) > remaining or size + sum(len(r['quote']) for r in group) > MAX_ARCHIVE_QUOTE_CHARS:
            continue
        if any(r['source_id'] in sources and
               (not isinstance(sources[r['source_id']], dict)
                or sources[r['source_id']].get('fulltext_sha256') != r['fulltext_sha256']
                or sources[r['source_id']].get('id') != r['source_id']
                or sources[r['source_id']].get('url') != r['url']
                or not isinstance(sources[r['source_id']].get('fulltext'), str)
                or _digest(sources[r['source_id']]['fulltext']) != r['fulltext_sha256']) for r in group):
            meta['rejected_count'] += 1
            continue
        for new_row in group:
            new_row = copy.deepcopy(new_row)
            source = copy.deepcopy(library['sources'][new_row['source_id']])
            sources.setdefault(new_row['source_id'], source)
            evidence.append(new_row)
            existing_ids.add(new_row['id'])
            existing_rows[new_row['id']] = new_row
            added.append(new_row['id'])
            size += len(new_row['quote'])
            remaining -= 1
        if attestation:
            meta['trusted_company_domains'].append(attestation['domain'])
            meta['domain_evidence'].append(copy.deepcopy(attestation))
    meta['added_evidence_ids'] = added
    meta['status'] = 'added' if added else 'no_match'
    meta['trusted_company_domains'] = sorted(set(meta['trusted_company_domains']))
    meta['domain_evidence'] = list({row['domain']: row for row in meta['domain_evidence']}.values())
    if added:
        _set_origins(sources, evidence)
    return merged
