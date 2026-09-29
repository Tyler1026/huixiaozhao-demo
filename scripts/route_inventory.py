"""Generate source-derived route conditions without importing server configuration."""
import ast
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def inventory():
    tree=ast.parse((ROOT/'server.py').read_text())
    handler=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Handler')
    rows=[]
    for method in handler.body:
        if not isinstance(method,ast.FunctionDef) or method.name not in ('do_GET','do_POST','do_OPTIONS'):continue
        for node in ast.walk(method):
            if not isinstance(node,ast.If):continue
            condition=ast.unparse(node.test)
            if not any(isinstance(x,ast.Constant) and isinstance(x.value,str) and x.value.startswith('/') for x in ast.walk(node.test)):continue
            calls=sorted({ast.unparse(x.func) for statement in node.body for x in ast.walk(statement) if isinstance(x,ast.Call)})
            delegated='handle_sync' in calls or 'serve_html' in calls
            rows.append({'method':method.name.removeprefix('do_'),'line':node.lineno,'condition':condition,'calls':calls,'status':'delegated; see tests' if delegated else 'pending boundary characterization'})
    return sorted(rows,key=lambda r:r['line'])

if __name__=='__main__':
    output=ROOT/'docs/route-inventory.json'
    output.write_text(json.dumps(inventory(),ensure_ascii=False,indent=2)+'\n')
    print(f'{len(inventory())} path conditions inventoried in {output}')
