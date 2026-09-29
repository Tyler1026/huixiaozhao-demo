"""Run the actual entrypoint with an empty environment and temporary file store."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]

def main():
    with tempfile.TemporaryDirectory(prefix='hxz-entrypoint-') as folder:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        env={'PATH':os.environ.get('PATH',''),'PORT':str(port),'SYNC_PATH':str(Path(folder)/'synthetic.json'),'PYTHONUNBUFFERED':'1','HOME':folder}
        with open(Path(folder)/'server.log','w+') as log:
            process=subprocess.Popen([sys.executable,str(ROOT/'server.py')],cwd=ROOT,env=env,stdout=log,stderr=log)
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            def request(path,body=None):
                data=None if body is None else json.dumps(body).encode()
                with opener.open(urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=data),timeout=3) as response:
                    return response.status,response.read()
            try:
                deadline=time.monotonic()+15
                while True:
                    if process.poll() is not None:raise RuntimeError('entrypoint exited')
                    try:
                        _,body=request('/health');break
                    except OSError:
                        if time.monotonic()>deadline:raise
                        time.sleep(.1)
                assert json.loads(body)['key'] is False
                for path,name in [('/','index.html'),('/ops','ops.html')]:
                    status,body=request(path);assert status==200 and body==(ROOT/name).read_bytes()
                _,body=request('/api/sync',{'PROJECTS':{'synthetic':{'city':'smoke'}}})
                assert json.loads(body)['ok'] is True
                _,body=request('/api/sync');assert json.loads(body)['PROJECTS']['synthetic']['city']=='smoke'
                _,body=request('/api/extract-text',{'filename':'smoke.txt','fileB64':'eA=='})
                assert json.loads(body)['text']=='x'
                print('Actual entrypoint smoke passed: both pages, no AI key, synthetic file-store write/read, text extraction.')
            finally:
                process.terminate()
                try:process.wait(timeout=5)
                except subprocess.TimeoutExpired:process.kill();process.wait()

if __name__=='__main__':main()
