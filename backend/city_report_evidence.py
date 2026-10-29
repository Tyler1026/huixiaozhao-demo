"""Read originals from the authorized city's published research delivery only."""
import base64
import hashlib
import io
import json
import zipfile
from urllib.parse import urlsplit

from .topic_reports import TopicReportError
from .topic_research import select_source_paragraphs
from report_service.providers import validate_https_url
from report_service.full_contract import canonical_url, classify_source_type

MAX_ZIP = 30_000_000
MAX_EVIDENCE = 15_000_000


def _city_key(value):
    return value.strip().removesuffix('市') if isinstance(value,str) else ''


def package_research(document, city, topic, request_id, *, mode='draft'):
    if (not isinstance(document, dict) or not _city_key(city)
            or _city_key(document.get('city')) != _city_key(city)
            or document.get('synthetic') is not False):
        raise TopicReportError('city_package_mismatch', '城市研究材料与当前工作区不一致，请联系管理员核对发布版本。')
    result = {'city':city, 'topic':topic, 'status':'pending', 'sources':{},
              'evidence':[], 'errors':[], 'queries':[], 'automatic_research':False,
              'public_research':{'status':'city_package', 'requestId':request_id,
                                 'retrieval':'archive', 'network_requested':False}}
    city_label = _city_key(city)
    seen = set()
    for stage in (document.get('stages') or {}).values():
        if not isinstance(stage, dict):
            continue
        for row in stage.get('evidence') or []:
            if not isinstance(row, dict):
                continue
            text, url = row.get('excerpt'), row.get('url')
            if (not isinstance(text, str) or not 20 <= len(text) <= 120000
                    or city_label not in text or row.get('retrieval') not in ('exa_fulltext','fetched')):
                continue
            try:
                validate_https_url(url)
            except (TypeError, ValueError):
                continue
            if url in seen:
                continue
            paragraphs = select_source_paragraphs(text, topic, limit=4, mode=mode)
            if not paragraphs:
                continue
            sid = 'source_'+hashlib.sha256((canonical_url(url)+'\0'+text).encode()).hexdigest()[:20]
            meta = {'url':url, 'title':row.get('title',''), 'published_at':row.get('published',''),
                    'retrieved_at':row.get('retrieved_at',''), 'retrieval':'fetched',
                    'source_type':classify_source_type(urlsplit(url).hostname or ''),
                    'publisher_id':urlsplit(url).hostname, 'status':'source', 'archived':True,
                    'origin_id':sid, 'city':city, 'requestId':request_id}
            result['sources'][sid] = dict(meta, id=sid, fulltext=text,
                fulltext_sha256=hashlib.sha256(text.encode()).hexdigest())
            for paragraph in paragraphs:
                quote = paragraph['quote']
                eid = 'tr_'+hashlib.sha256((url+'\0'+quote).encode()).hexdigest()[:20]
                result['evidence'].append(dict(meta, **paragraph, id=eid, source_id=sid, excerpt=quote))
            seen.add(url)
    # Rank the complete package before applying the budget. Early economy
    # chapters must not crowd out the actual supply-chain research later on.
    result['evidence'].sort(key=lambda row: (
        row['source_type'] not in ('government','disclosure','company','research'),
        -row.get('relevance_score',0), row['id']))
    result['evidence'] = result['evidence'][:96 if mode == 'chain' else 48]
    used={row['source_id'] for row in result['evidence']}
    result['sources']={sid:row for sid,row in result['sources'].items() if sid in used}
    if not result['evidence']:
        raise TopicReportError('city_topic_evidence_missing', '当前城市材料包中未找到该方向的可引用原文，请在管理端补充对应原始来源。')
    return result


def load_city_package(context, state):
    """State is the server-authenticated scoped snapshot, never browser input."""
    projects = state.get('PROJECTS') or {}
    request_id = context['reportRequestId']
    project = next((projects.get(key) for key in (context['projectKey'],context['workspaceId'])
        if isinstance(projects.get(key),dict) and projects[key].get('reportRequestId') == request_id
        and _city_key(projects[key].get('city')) == _city_key(context['city'])
        and isinstance(projects[key].get('baseReportVersion'),dict)
        and projects[key]['baseReportVersion'].get('requestId') == request_id), None)
    if not request_id or not project:
        raise TopicReportError('city_package_missing', '当前城市尚未绑定已发布研究材料包，请在管理端发布后重试。')
    delivery = next((row for row in project.get('reportFiles',[]) if isinstance(row,dict)
                     and row.get('kind') == 'research'), None)
    if not delivery or not isinstance(delivery.get('b64'),str) or len(delivery['b64']) > MAX_ZIP*4//3+4:
        raise TopicReportError('city_package_missing', '当前城市完整研究附件缺失，请在管理端重新发布材料包。')
    try:
        payload = base64.b64decode(delivery['b64'],validate=True)
        if len(payload) > MAX_ZIP or hashlib.sha256(payload).hexdigest() != delivery.get('sha256'):
            raise ValueError('delivery checksum')
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            entries = [entry for entry in archive.infolist() if entry.filename == 'evidence.json']
            if len(entries) != 1 or entries[0].file_size > MAX_EVIDENCE:
                raise ValueError('evidence size')
            document = json.loads(archive.read(entries[0]))
    except (ValueError, KeyError, OSError, zipfile.BadZipFile, RuntimeError):
        raise TopicReportError('city_package_invalid', '当前城市研究附件校验失败，请联系管理员核对材料包。') from None
    return package_research(document,context['city'],context['topic'],request_id,
                            mode=context.get('_researchMode','draft'))
