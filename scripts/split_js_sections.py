"""Split at top-level section boundaries without changing a single source byte."""
import json
import re
from pathlib import Path
import esprima

ROOT=Path(__file__).resolve().parents[1]

def split():
    manifest_path=ROOT/'frontend/manifest.json'
    manifest=json.loads(manifest_path.read_text())
    inventory={}
    for page,entry in manifest.items():
        parts=[]
        for part in entry['parts']:
            path=ROOT/part
            if path.suffix!='.js' or path.stat().st_size<100000:
                parts.append(part);continue
            source=path.read_text();tree=esprima.parseScript(source,{'range':True,'loc':True})
            boundaries=[0]
            labels=['bootstrap-helpers']
            for match in re.finditer(r'^/\*\s*={3,}([^\n]+)',source,re.M):
                point=match.start()
                if point and not any(n.range[0]<point<n.range[1] for n in tree.body):
                    boundaries.append(point);labels.append(match.group(1).strip('= */'))
            boundaries.append(len(source))
            directory=path.parent/(path.stem+'-sections')
            if directory.exists():raise ValueError('section output already exists')
            directory.mkdir()
            combined=[];rows=[]
            for i,(a,b) in enumerate(zip(boundaries,boundaries[1:])):
                body=source[a:b]
                esprima.parseScript(body)
                target=directory/f'{i:02d}.js';target.write_text(body)
                name=str(target.relative_to(ROOT));parts.append(name);combined.append(body)
                nodes=[n for n in tree.body if a<=n.range[0]<b]
                rows.append({'source':name,'responsibility':labels[i],'lines':[source.count('\n',0,a)+1,source.count('\n',0,b)+1],
                             'declarations':[n.id.name for n in nodes if n.type=='FunctionDeclaration'],
                             'top_level_effects':[n.type for n in nodes if n.type not in ('FunctionDeclaration','VariableDeclaration')]})
            assert ''.join(combined).encode()==path.read_bytes()
            inventory[part]=rows
        entry['parts']=parts
    manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    (ROOT/'frontend/sections.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':split()
