"""Bounded classification of *new* standard policy-check batches.

This is an excerpt/field binding guard, not a legal-validity classifier. It
does not run during loading, recovery or historical whole-stage validation.
No network, current-date inference, missing condition or second source is
manufactured here. Unknown fields remain explicitly unknown.
"""
from __future__ import annotations

import copy
import hashlib
import html
import re
from urllib.parse import urlsplit

from .full_contract import _evidence_observations, canonical_url

MAX_CHECKS = 64
MAX_QUOTE = 2400
FIELD_NAMES = ('issuer', 'beneficiary', 'benefit', 'conditions', 'validity', 'region')
_DOCUMENT = re.compile(r'办法|细则|通知|意见|方案|规定|条例|目录|清单|决定|公告|政策|指引')
_NON_DOCUMENT = re.compile(r'统计公报|统计年鉴|工作总结|情况通报|工作动态|新闻报道|活动简报')
_SECONDARY = re.compile(r'解读|问答|新闻|报道|建议.*答复')
_PROJECT_DECISION = re.compile(r'(?:节能报告|环境影响报告|环境影响评价|环评).*(?:批复|审查意见)'
                               r'|(?:项目|工程).*(?:核准批复|备案证明)')
_TOOL = re.compile(r'奖励|补助|补贴|贴息|资助|减免|担保贷款|申报|申请|不得|应当|必须')
_RULE = re.compile(
    r'(?:对|凡|符合|满足|经)[^。！？]{0,180}(?:企业|主体|机构|单位|项目|城市群|个人|申请人|人才|毕业生)'
    r'[^。！？]{0,180}(?:给予|可|享受|应当|须|不得|最高|不超过)'
    r'|(?:申报|申请|补助|奖励|补贴|贴息|资助|减免|担保贷款|资金)[^。！？]{0,160}'
    r'(?:须|必须|应当|不得|最高|不超过)')
_PAST = re.compile(r'累计(?:发放|兑现|拨付|支付)|已累计|已(?:给予|发放|兑现|拨付|支付)|'
                   r'已(?:向|对)[^。！？]{0,80}(?:给予|发放)|共(?:向|对)\d|'
                   r'完成投资|签约\d|开展\d|举办\d|接待\d|最高获奖[^。！？]{0,40}(?:得到|获得)')
_CUMULATIVE = re.compile(r'累计(?:(?:向|对)[^。！？]{0,40}?)?(?:给予|补助|奖励|资助)')
_VALIDITY = re.compile(r'有效期|有效至|试行期|施行|实施|执行期限|执行期|申报时间|申报期限|受理时间|受理期限|截止')
_SUBJECT = re.compile(r'企业|个人|机构|单位|项目|城市群|人员|人才|毕业生|申请人|高校|社团|合作社|农户|主体')
_ISSUER = re.compile(r'政府|厅|局|委员会|部门|办公室|人大')
_REGION = re.compile(r'全国|全省|全市|本省|本市|本区|本县|境内|境外|省|市|自治区|地区|区|县')
_CONDITION = re.compile(r'符合|经|须|应|不得|达到|且|完成|认定|注册|申报|申请|验收|不超过|不高于|不重复|设立|满|具备|持有')


class PolicyCheckError(ValueError):
    """Only a static code is exposed; no model text or source content."""


def _compact(value):
    return re.sub(r'\s+', '', value) if isinstance(value, str) else ''


def _official(url):
    if not isinstance(url, str):
        return False
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or '').lower()
        return (parsed.scheme == 'https' and not parsed.username and not parsed.password
                and (host == 'gov.cn' or host.endswith('.gov.cn')))
    except (TypeError, ValueError):
        return False


def _observations(evidence, url):
    """Keep source observations separate, including their own title metadata."""
    if not _official(url):
        return []
    result = []
    for item in evidence if isinstance(evidence, list) else []:
        if not isinstance(item, dict) or item.get('url') != url:
            continue
        if not isinstance(item.get('excerpt'), str):
            continue
        for metadata, text in _evidence_observations(item):
            title = str(metadata.get('title', ''))
            if (isinstance(text, str) and not _SECONDARY.search(title)
                    and not _PROJECT_DECISION.search(title)):
                result.append((metadata.get('title', ''), text))
    return result


def _whole_span(quote, body):
    """Require whole saved paragraphs, not a clipped benefit sentence.

    Adjacent conditions in the same paragraph cannot be cut at a full stop.
    Conditions elsewhere in the complete legal document remain outside this
    excerpt guard's guarantee and are explicitly disclosed in every record.
    """
    indices = [i for i, char in enumerate(body) if not char.isspace()]
    dense, wanted = _compact(body), _compact(quote)
    start = dense.find(wanted)
    if start < 0:
        return False
    end = start + len(wanted)
    before_break = start > 0 and '\n' in body[indices[start - 1] + 1:indices[start]]
    after_break = end < len(dense) and '\n' in body[indices[end - 1] + 1:indices[end]]
    return (start == 0 or before_break) and (end == len(dense) or after_break)


def _owns_span(document, quote, body):
    """Do not carry an earlier document title across another attachment/title.

    Explicit mixed-document boundaries are rejected conservatively. This is
    not a parser for arbitrary legal document structure.
    """
    indices = [i for i, char in enumerate(body) if not char.isspace()]
    wanted = _compact(quote)
    start = _compact(body).find(wanted)
    end = indices[start + len(wanted) - 1] + 1
    owner = True  # the caller already matched this observation's title/header
    for line in body[:end].splitlines():
        line = line.strip()
        if not line or len(line) > 200 or re.search(r'[。！？；]', line):
            continue
        dense = _compact(line)
        fragment = re.sub(r'^.*?[《]|[》].*$', '', dense)
        if _compact(document) in dense or (len(fragment) >= 4 and fragment in _compact(document)):
            owner = True
        elif re.match(r'^[（(]?附件[一二三四五六七八九十\d]*', dense):
            owner = False
        elif _DOCUMENT.search(line) and not re.search(r'[，,]', line):
            owner = False
    return owner


def _document_names(title, body):
    """Exact title identities, not an arbitrary suffix containing '办法'."""
    title = html.unescape(re.sub(r'<[^>]+>', '', str(title))).strip()
    names = [re.split(r'_| - |\s{2,}', title, maxsplit=1)[0].strip()]
    names.extend(re.findall(r'《([^》]+)》', title + '\n' + body[:350]))
    return {_compact(name) for name in names if name}


def _bind(clause, source, evidence):
    if not isinstance(clause, dict):
        raise PolicyCheckError('policy_clause_schema_missing')
    document = clause.get('document_name')
    quote = clause.get('quote')
    if (not isinstance(document, str) or not 4 <= len(document) <= 180
            or not _DOCUMENT.search(document) or _NON_DOCUMENT.search(document)):
        raise PolicyCheckError('policy_document_unidentified')
    if (not isinstance(quote, str) or not 16 <= len(quote) <= MAX_QUOTE
            or not _TOOL.search(quote) or not _RULE.search(quote) or _PAST.search(quote)):
        raise PolicyCheckError('policy_check_not_normative_clause')
    for match in _CUMULATIVE.finditer(quote):
        if not re.match(r'(?:不超过|最高|不高于)', quote[match.end():]):
            raise PolicyCheckError('policy_check_not_normative_clause')
    for title, body in _observations(evidence, source):
        # A title may identify the document, never supply a missing operative
        # clause or a beneficiary/condition absent from the actual body.
        if _compact(document) not in _document_names(title, body):
            continue
        if not _whole_span(quote, body):
            continue
        if not _owns_span(document, quote, body):
            raise PolicyCheckError('policy_clause_document_ownership_ambiguous')
        fields, missing = {}, []
        for name in FIELD_NAMES:
            value = clause.get(name)
            if value in (None, ''):
                fields[name] = None
                missing.append(name)
                continue
            minimum = 2 if name == 'region' else 4
            if not isinstance(value, str) or not minimum <= len(value) <= 400:
                raise PolicyCheckError('policy_field_invalid')
            context = quote if name in {'beneficiary', 'benefit', 'conditions'} else body
            if _compact(value) not in _compact(context):
                raise PolicyCheckError('policy_field_not_in_same_observation')
            fields[name] = value
        if fields['benefit'] and not _TOOL.search(fields['benefit']):
            raise PolicyCheckError('policy_benefit_not_operative')
        if fields['validity'] and not _VALIDITY.search(fields['validity']):
            raise PolicyCheckError('policy_validity_not_operative_period')
        for name, pattern in (('issuer', _ISSUER), ('beneficiary', _SUBJECT),
                              ('conditions', _CONDITION), ('region', _REGION)):
            if fields[name] and not pattern.search(fields[name]):
                raise PolicyCheckError('policy_field_not_specific')
        return {'schema_version': 1, 'classification': 'normative_clause',
                'document_name': document, 'quote': quote, **fields,
                'source': source, 'source_sha256': hashlib.sha256(body.encode()).hexdigest(),
                'status': 'fields_located' if not missing else 'pending',
                'missing_fields': missing,
                'field_binding_only': True, 'legal_completeness_confirmed': False,
                'limitation': '仅绑定已存原文；法律位阶、现行效力、完整文件遗漏条件及个案资格仍须核实。'}
    raise PolicyCheckError('policy_clause_not_in_saved_official_observation')


def prepare_policy_checks(raw, evidence):
    """Validate every new policy record before generic numeric grounding.

    No invalid record is silently dropped while its narrative survives. The
    existing >=3 policy quota still applies after this guard. A declaration
    named classification/status in model JSON is deliberately ignored.
    """
    if not isinstance(raw, list) or len(raw) > MAX_CHECKS:
        raise PolicyCheckError('policy_checks_invalid_batch')
    prepared, bindings, seen = [], [], set()
    for item in raw:
        if not isinstance(item, dict) or item.get('category') != 'policy':
            raise PolicyCheckError('policy_batch_contains_other_category')
        source = item.get('source')
        binding = _bind(item.get('policy_clause'), source, evidence)
        # Exact normative wording prevents a genuine subsidy quote from being
        # attached to an unrelated event/statistic claim. No semantic rewrite.
        if _compact(item.get('claim')) != _compact(binding['quote']):
            raise PolicyCheckError('policy_claim_differs_from_clause')
        key = (canonical_url(source), _compact(binding['document_name']), _compact(binding['quote']))
        if key in seen:
            raise PolicyCheckError('policy_duplicate_clause')
        seen.add(key)
        copied = copy.deepcopy(item)
        copied['source_quote'] = binding['quote']
        copied['region'] = binding['region'] or ''
        cross = copied.get('cross_source')
        if cross:
            cross_binding = _bind(copied.get('cross_policy_clause'), cross, evidence)
            if (cross_binding['document_name'] != binding['document_name']
                    or any(cross_binding[field] != binding[field] for field in FIELD_NAMES)
                    or _compact(cross_binding['quote']) != _compact(binding['quote'])):
                raise PolicyCheckError('policy_cross_source_different_clause')
            copied['cross_source_quote'] = cross_binding['quote']
        else:
            copied['cross_source'] = ''
            copied['cross_source_quote'] = ''
        prepared.append(copied)
        bindings.append(binding)
    return prepared, bindings


def attach_policy_bindings(checks, bindings):
    """Keep generic source status separate from unproven legal completeness."""
    if len(checks) != len(bindings):
        raise PolicyCheckError('policy_grounding_dropped_clause')
    for check, binding in zip(checks, bindings):
        if (_compact(check.get('claim')) != _compact(binding['quote'])
                or check.get('source') != binding['source']):
            raise PolicyCheckError('policy_grounding_changed_bound_clause')
        check['policy_clause_validation'] = copy.deepcopy(binding)
        # Even two copied passages do not verify current eligibility. Missing
        # fields are visible in the verdict consumed by the Word renderer.
        if binding['missing_fields']:
            check['verdict'] = '待核实：规范性条款可定位，但适用要素不完整'
            check['support_gap'] = ('政策缺失字段：' + '、'.join(binding['missing_fields'])
                                    + '；' + check.get('support_gap', ''))
        else:
            check['verdict'] = check.get('verdict', '待核实') + '；现行政策适用与完整文件仍待核'
    return checks


POLICY_CHECK_PROMPT = (
    '本批policy只能核验规范性政策的优惠/申报条件/限制/有效期，不得用招商活动次数、'
    '人次、工业产量产值、企业订单或项目投资统计充当政策条款，不能靠category标签冒充。'
    '每项必须增加policy_clause对象：document_name（已给官方原文中的完整文件名）、'
    'quote（对应官方HTTPS来源正文中的完整规范性自然段，不得只截第一句优惠而遗漏同段条件）、'
    'issuer、beneficiary、benefit、conditions、validity、region。'
    'claim必须逐字等于quote，不能另加活动/统计数字。beneficiary/benefit/conditions须逐字来自quote；'
    'issuer/validity/region须逐字来自同一原始摘录；缺字段用null并明确待核，不填“无条件”“长期有效”等猜测。'
    '不能拼接同URL的不同原始摘录，也不能把标题当条款。有效期是政策条款期限，不能用网页发布日期替代。'
    'source_quote由上述quote给出；没有第二官方原文时cross_source留空。'
    '若有第二来源，须增加同schema的cross_policy_clause且它支持同一文件、同一条款和相同字段。'
    '所有来源必须是本次实际提供的官方HTTPS；媒体或企业转载仅为线索。'
    '仍须至少3条不同的真实政策条款；不足就如实说明，不能改用活动统计填数。'
    '正文只能讨论这些具体政策条款及其缺口，不得宣称当前可申领或已完成资格核验。'
)
