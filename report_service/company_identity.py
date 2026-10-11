"""Conservative identities for new candidate slots, not fuzzy company matching.

Parent companies, subsidiaries and geographic branches remain distinct. Only
explicit record annotations and an explicitly declared business-owner alias
are treated as the same subject. Persisted checkpoint names are never changed.
"""
import re
import unicodedata


_RECORD_NOTE = re.compile(r'\((?:融资)?(?:交叉)?核验记录\)$')
_BUSINESS_NOTE = re.compile(r'\([^()]{1,24}(?:业务|技术补充|能力补充)\)$')


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
