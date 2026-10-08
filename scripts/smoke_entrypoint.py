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
            def request(path,body=None,headers=None):
                data=None if body is None else json.dumps(body).encode()
                with opener.open(urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=data,headers=headers or {}),timeout=3) as response:
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
                engine = json.loads(body)['report_engine']
                assert engine['engine'] == 'standalone' and engine['supervisor_running']
                assert not engine['configured'] and not engine['worker_running']
                for path,name in [('/','index.html'),('/ops','ops.html')]:
                    status,body=request(path);assert status==200 and body==(ROOT/name).read_bytes()
                _,body=request('/api/sync',{'PROJECTS':{'synthetic':{'city':'smoke'}}})
                assert json.loads(body)['ok'] is True
                _,body=request('/api/sync');assert json.loads(body)['PROJECTS']['synthetic']['city']=='smoke'
                report = {'id':'rrentrypoint', 'province':'隔离省', 'city':'隔离区', 'mode':'deep', 'status':'pending'}
                _,body=request('/api/sync', {'REPORT_REQUESTS':[report]})
                assert json.loads(body)['ok'] is True
                _,body=request('/api/sync');assert not json.loads(body)['REPORT_REQUESTS']
                _,body=request('/api/sync', headers={'X-HXZ-Report-Client':'website'})
                saved = json.loads(body)['REPORT_REQUESTS'][0]
                assert saved['engine'] == 'full-v1' and saved['status'] == 'pending'
                try:
                    request('/api/sync', {'REPORT_REQUESTS':[dict(report,status='running',claimTs=1)]})
                    raise AssertionError('legacy claim was accepted')
                except urllib.error.HTTPError as error:
                    assert error.code == 409 and json.loads(error.read())['rejected'] == 'server-owned-report'
                _,body=request('/api/extract-text',{'filename':'smoke.txt','fileB64':'eA=='})
                assert json.loads(body)['text']=='x'
                print('Actual entrypoint smoke passed: default independent ownership, legacy claim rejection, configuration wait without research, both pages, file-store write/read and text extraction.')
            finally:
                process.terminate()
                try:process.wait(timeout=5)
                except subprocess.TimeoutExpired:process.kill();process.wait()

if __name__=='__main__':main()
