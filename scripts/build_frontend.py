"""Build the original wire-format pages from ordered source parts."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def build(check=False):
    manifest=json.loads((ROOT/'frontend/manifest.json').read_text())
    for name,entry in manifest.items():
        if name not in ('index.html','ops.html'):raise ValueError('invalid output')
        chunks=[]
        for part in entry['parts']:
            path=(ROOT/part).resolve()
            if ROOT/'frontend' not in path.parents:raise ValueError('invalid source path')
            chunks.append(path.read_bytes())
        body=b''.join(chunks)
        output=ROOT/name
        if check:
            if output.read_bytes()!=body:raise ValueError(name+' differs from generated sources')
        else:
            output.write_bytes(body)
        print(name,hashlib.sha256(body).hexdigest())

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true')
    build(parser.parse_args().check)
