"""Supplement a mandatory city package without replacing its originals."""
import copy

from .topic_chain import chain_source_catalog


def supplement_city_chain(base, extra, context):
    merged=copy.deepcopy(base)
    if any(extra.get(key)!=context.get(key) for key in ('city','topic')):
        merged['onlineSupplement']={'status':'scope_mismatch','added':0}
        return merged
    catalog=chain_source_catalog(extra,context,limit=96)
    existing={row['id'] for row in merged.get('evidence',[])}
    added=0
    city=context['city'].removesuffix('市')
    for row in extra.get('evidence',[]):
        if row.get('id') not in catalog or row['id'] in existing:
            continue
        sid=row['source_id'];source=extra['sources'][sid]
        previous=merged['sources'].get(sid)
        if previous and any(previous.get(key)!=source.get(key) for key in ('url','fulltext_sha256')):
            continue
        if len(merged['evidence'])>=192:
            break
        scope='city_related' if city in row['quote'] else 'industry_background'
        merged['sources'].setdefault(sid,dict(copy.deepcopy(source),source_scope=scope))
        merged['evidence'].append(dict(copy.deepcopy(row),source_scope=scope))
        existing.add(row['id']);added+=1
    merged['queries']=list(dict.fromkeys(base.get('queries',[])+extra.get('queries',[])))
    merged['onlineSupplement']={'status':extra.get('status','unavailable'),'added':added,
                                'errors':copy.deepcopy(extra.get('errors',[]))}
    return merged
