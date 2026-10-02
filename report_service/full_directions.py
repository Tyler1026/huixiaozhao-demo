"""Stable, evidence-associated direction identities shared across report stages."""
import unicodedata


def normalise_directions(values, evidence=None):
    from .full_contract import canonical_url
    if not isinstance(values, list) or len(values) != 3:
        raise ValueError('directions must contain exactly dir1, dir2 and dir3')
    result = {}
    names = set()
    refs = None if evidence is None else {canonical_url(e.get('url')) for e in evidence if isinstance(e, dict)}
    for entry in values:
        if not isinstance(entry, dict):
            raise ValueError('direction must be an object')
        ident, name, ref = entry.get('id'), entry.get('name'), entry.get('evidence_ref')
        if ident not in ('dir1','dir2','dir3') or ident in result:
            raise ValueError('direction IDs must be unique dir1/dir2/dir3')
        if not isinstance(name, str) or not name.strip() or len(name)>120:
            raise ValueError('direction name must be nonempty and bounded')
        normalized = ''.join(unicodedata.normalize('NFKC',name).split()).casefold()
        if normalized in names:
            raise ValueError('direction names must be distinct')
        if not isinstance(ref, str) or not canonical_url(ref) or (refs is not None and canonical_url(ref) not in refs):
            raise ValueError('direction evidence_ref must bind to retrieved evidence')
        names.add(normalized)
        result[ident] = {'id': ident, 'name': name.strip(), 'evidence_ref': ref}
    return [result[ident] for ident in ('dir1','dir2','dir3')]
