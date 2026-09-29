"""Extract identical pure helpers at their original positions in the build order."""
import json
from pathlib import Path
import esprima
ROOT=Path(__file__).resolve().parents[1]
NAMES={'_kbItemFp','_clueNameKey','_isReusableClueId','_clueLegacyTombKey'}

def main():
    manifest_path=ROOT/'frontend/manifest.json'
    manifest=json.loads(manifest_path.read_text());shared=ROOT/'frontend/shared';shared.mkdir(exist_ok=True)
    definitions={};uses={}
    for page,entry in manifest.items():
        parts=[]
        for part in entry['parts']:
            path=ROOT/part
            if path.suffix!='.js':parts.append(part);continue
            source=path.read_text();tree=esprima.parseScript(source,{'range':True})
            selected=[n for n in tree.body if n.type=='FunctionDeclaration' and n.id.name in NAMES]
            if not selected:parts.append(part);continue
            position=0
            for i,node in enumerate(selected):
                name=node.id.name;body=source[node.range[0]:node.range[1]]
                if name in definitions and definitions[name]!=body:raise ValueError('nonidentical shared helper: '+name)
                definitions[name]=body;uses.setdefault(name,[]).append(page)
                before=path.with_name(path.stem+f'-part-{i:02d}.js')
                before.write_text(source[position:node.range[0]]);parts.append(str(before.relative_to(ROOT)))
                helper=shared/(name+'.js');helper.write_text(body);parts.append(str(helper.relative_to(ROOT)))
                position=node.range[1]
            after=path.with_name(path.stem+'-tail.js');after.write_text(source[position:]);parts.append(str(after.relative_to(ROOT)))
        entry['parts']=parts
    manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    (shared/'contracts.json').write_text(json.dumps({n:{'inputs':'function parameters only','dependencies':'JavaScript built-ins only','consumers':p} for n,p in uses.items()},indent=2)+'\n')
if __name__=='__main__':main()
