"""Original report download with explicit storage dependencies."""
import json

def report_file(self,use_database,read,file_path):
    import base64, urllib.parse
    qs = urllib.parse.parse_qs(self.path.split('?', 1)[1] if '?' in self.path else '')
    city = (qs.get('city') or [''])[0]
    kind = (qs.get('kind') or ['full'])[0]
    try:
        if use_database:
            store = json.loads(read() or '{}')
        else:
            with open(file_path, encoding='utf-8') as f2:
                store = json.loads(f2.read())
    except Exception:
        store = {}
    # 优先从 REPORT_REQUESTS（最近一条该城市 done 且带 files 的），回退到项目 reportFiles
    files = None
    done = [r for r in (store.get('REPORT_REQUESTS') or [])
            if isinstance(r, dict) and r.get('city') == city and r.get('files')]
    if done:
        files = done[-1]['files']
    if not files:
        for pv in (store.get('PROJECTS') or {}).values():
            if isinstance(pv, dict) and pv.get('city') == city and pv.get('reportFiles'):
                files = pv['reportFiles']; break
    meta = None
    if files:
        meta = next((m for m in files if m.get('kind') == kind), None) or files[0]
    if not meta or not meta.get('b64'):
        msg = json.dumps({'ok': False, 'error': '未找到该城市原始报告文件'}).encode()
        self.send_response(404); self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(msg)))
        self.cors(); self.end_headers(); self.wfile.write(msg); return
    try:
        blob = base64.b64decode(meta['b64'])
    except Exception:
        blob = b''
    fname = meta.get('name') or (city + '_报告.docx')
    fname_enc = urllib.parse.quote(fname)
    self.send_response(200)
    self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    self.send_header('Content-Disposition',
                     "attachment; filename*=UTF-8''" + fname_enc)
    self.send_header('Content-Length', str(len(blob)))
    self.cors(); self.end_headers(); self.wfile.write(blob)
    return
