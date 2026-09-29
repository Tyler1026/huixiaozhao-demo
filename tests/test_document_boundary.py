import ast
import importlib
import io
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

class DocumentBoundaryTests(unittest.TestCase):
    def test_parser_is_importable_without_server_startup(self):
        from backend import documents
        self.assertEqual(documents._extract_doc_text('a.txt','测试'.encode()),('测试',None))
        self.assertEqual(documents._extract_doc_text('a.doc',b'x'),('', '旧版 .doc 二进制格式不支持，请另存为 .docx 或 PDF 后再上传'))
    def test_parser_function_ast_matches_published_baseline(self):
        import subprocess
        from backend import documents
        baseline=subprocess.check_output(['git','show','21baa54c943d5b04d654aafe6ab5a06a323376cd:server.py'],cwd=ROOT,text=True)
        original=next(n for n in ast.parse(baseline).body if isinstance(n,ast.FunctionDef) and n.name=='_extract_doc_text')
        extracted=next(n for n in ast.parse(Path(documents.__file__).read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='_extract_doc_text')
        self.assertEqual(ast.dump(original),ast.dump(extracted))
