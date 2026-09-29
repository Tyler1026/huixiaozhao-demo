"""Fail when extracted boundaries regain hidden runtime dependencies."""
import ast
import builtins
import json
import symtable
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

class DependencyContracts(unittest.TestCase):
    def test_html_response_has_only_builtin_globals(self):
        source=(ROOT/'backend/http_responses.py').read_text()
        table=symtable.symtable(source,'http_responses','exec')
        globals_used={symbol.get_name() for child in table.get_children() for symbol in child.get_symbols() if symbol.is_global() and symbol.is_referenced()}
        self.assertLessEqual(globals_used,set(dir(builtins)))

    def test_shared_helpers_have_only_declared_builtin_dependencies(self):
        import esprima
        contracts=json.loads((ROOT/'frontend/shared/contracts.json').read_text())
        for name in contracts:
            tree=esprima.parseScript((ROOT/'frontend/shared'/(name+'.js')).read_text()).toDict()
            function=tree['body'][0]
            self.assertEqual(function['type'],'FunctionDeclaration')
            allowed={name,'String'}|{p['name'] for p in function['params']}
            used=set()
            def visit(node,parent=None,key=None):
                if isinstance(node,list):
                    for item in node:visit(item,parent,key)
                elif isinstance(node,dict):
                    if node.get('type')=='Identifier':
                        if parent and parent.get('type')=='MemberExpression' and key=='property' and not parent.get('computed'):return
                        used.add(node['name'])
                    for k,value in node.items():
                        if isinstance(value,(dict,list)):visit(value,node,k)
            visit(function)
            self.assertLessEqual(used,allowed,name)

    def test_docker_contains_every_runtime_python_boundary(self):
        docker=(ROOT/'Dockerfile').read_text()
        self.assertIn('COPY backend/ ./backend/',docker)
        self.assertIn('scripts/build_frontend.py --check',docker)
        for path in (ROOT/'backend').glob('*.py'):
            compile(path.read_text(),str(path),'exec')
