"""One-time lossless source extraction. Production HTML remains byte-identical."""
import hashlib
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def split():
    target=ROOT/'frontend'
    if target.exists():
        raise SystemExit('frontend already exists; refusing overwrite')
    target.mkdir()
    manifest={}
    for name in ('index.html','ops.html'):
        raw=(ROOT/name).read_bytes()
        folder=target/Path(name).stem
        folder.mkdir()
        parts=[];position=0
        pattern=rb'<(script|style)\b[^>]*>(.*?)</\1\b[^>]*>'
        counts={'script':0,'style':0,'markup':0}
        def emit(kind,data,extension):
            counts[kind]+=1
            filename=f'{kind}-{counts[kind]:02d}.{extension}'
            (folder/filename).write_bytes(data)
            parts.append(str((folder/filename).relative_to(ROOT)))
        for match in re.finditer(pattern,raw,re.I|re.S):
            kind=match.group(1).decode().lower()
            # Tags stay markup: external scripts, attributes, ordering unchanged.
            emit('markup',raw[position:match.start(2)],'html')
            emit(kind,match.group(2),'js' if kind=='script' else 'css')
            position=match.end(2)
        emit('markup',raw[position:],'html')
        manifest[name]={'sha256':hashlib.sha256(raw).hexdigest(),'parts':parts}
    (target/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

if __name__=='__main__':split()
