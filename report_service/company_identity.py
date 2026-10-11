"""Conservative identities for new candidate slots, not fuzzy company matching.

Parent companies, subsidiaries and geographic branches remain distinct. Only
explicit record annotations and an explicitly declared business-owner alias
are treated as the same subject. Persisted checkpoint names are never changed.
"""
import re
import unicodedata


_RECORD_NOTE = re.compile(r'\((?:融资)?(?:交叉)?核验记录\)$')
_BUSINESS_NOTE = re.compile(r'\([^()]{1,24}(?:业务|技术补充|能力补充)\)$')
_LEGAL_ABBREVIATION = re.compile(
    r'^(?P<base>[^()]+(?:股份有限公司|有限责任公司|有限公司))'
    r'\((?P<note>[^()]{2,40})\)$')
_ABBREVIATION_LABEL = re.compile(r'^(?:以下简称|简称)\s*[:：]?\s*')
_RELATION_NOTE = re.compile(
    r'业务|事业部|部门|子公司|母公司|分公司|分厂|基地|项目|中心|分支|隶属|所属|'
    r'控股|参股|持股|集团|股份|公司|股票|证券|代码|板块|领域|分部')
_AMBIGUOUS_SHORT_NOTE = re.compile(
    r'省|市|区|县|州|镇|乡|旗|盟|地区|北京|天津|上海|重庆|河北|山西|辽宁|吉林|'
    r'黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|'
    r'云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门|'
    r'新能源|新材料|半导体|智能制造|风电|核电|光伏|电力|能源|电子|通信|'
    r'材料|装备|制造|技术|科技')


def company_identity(company, known=()):
    name = company.get('name', '') if isinstance(company, dict) else ''
    name = unicodedata.normalize('NFKC', name).strip()
    name = _RECORD_NOTE.sub('', name).strip()
    # “Shanghai Electric (fusion equipment business)” is not a second company
    # only when its own record explicitly names the already saved owner.
    if _BUSINESS_NOTE.search(name):
        notes = ' '.join(str(company.get(field, '')) for field in ('rationale', 'uncertainty', 'reason'))
        for saved in known:
            owner = unicodedata.normalize('NFKC', str(saved.get('name', ''))).strip()
            if owner and re.search(r'(?:该业务主体为|业务主体为|业务所属主体为|业务属于)' + re.escape(owner), notes):
                return owner
    return name


def candidate_identity(company, known=(), evidence=()):
    """Compare explicit legal-name abbreviations only before a new slot is saved.

    This does not rename records or change the identities used by assembly,
    selection, or scoring. An unlabelled bracket needs an exact known legal
    name plus a distinctive internal name fragment; ambiguous fragments need
    an explicit abbreviation declaration in their own retrieved source.
    Business units, ownership notes, and stock codes stay separate.
    """
    identity = company_identity(company, known)
    match = _LEGAL_ABBREVIATION.fullmatch(identity)
    if not match:
        return identity
    base, note = match.group('base'), match.group('note')
    labelled = bool(_ABBREVIATION_LABEL.match(note))
    abbreviation = _ABBREVIATION_LABEL.sub('', note).strip(' \t“”"‘’')
    if (not re.fullmatch(r'[A-Za-z\u3400-\u9fff]{2,24}', abbreviation)
            or _RELATION_NOTE.search(abbreviation)):
        return identity
    if labelled:
        return base
    if abbreviation not in base or base not in {
            company_identity(item, known) for item in known}:
        return identity
    if (re.fullmatch(r'[\u3400-\u9fff]{3,12}', abbreviation)
            and not base.startswith(abbreviation)
            and not _AMBIGUOUS_SHORT_NOTE.search(abbreviation)):
        return base

    from .full_contract import canonical_url
    ref = canonical_url(company.get('url'))
    if not ref:
        return identity
    declaration = re.compile(
        re.escape(base) + r'\(\s*(?:以下简称|简称)\s*[:：]?\s*[“"‘]?'
        + re.escape(abbreviation) + r'[”"’]?\s*\)')
    for source in evidence:
        if (not isinstance(source, dict) or canonical_url(source.get('url')) != ref
                or not isinstance(source.get('excerpt'), str)):
            continue
        from .full_contract import _evidence_observations
        for _, excerpt in _evidence_observations(source):
            if declaration.search(unicodedata.normalize('NFKC', excerpt)):
                return base
    return identity
