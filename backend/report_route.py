"""Original report download with explicit storage dependencies."""
import json

def report_file(self,use_database,read,file_path):
    import base64, urllib.parse
    qs = urllib.parse.parse_qs(self.path.split('?', 1)[1] if '?' in self.path else '')
    city = (qs.get('city') or [''])[0]
    kind = (qs.get('kind') or ['full'])[0]
    request_id = (qs.get('requestId') or [''])[0]
    def error(status, message):
        body = json.dumps({'ok': False, 'error': message}, ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.cors(); self.end_headers(); self.wfile.write(body)
    try:
        if use_database:
            stored = read()
            if stored is None:
                raise OSError('storage unavailable')
            store = json.loads(stored)
        else:
            with open(file_path, encoding='utf-8') as f2:
                store = json.loads(f2.read())
        if not isinstance(store, dict):
            raise ValueError('invalid storage')
    except Exception:
        return error(503, '报告存储暂不可用，请稍后重试')
    # 优先从 REPORT_REQUESTS（最近一条该城市 done 且带 files 的），回退到项目 reportFiles
    files = None
    requests = [r for r in (store.get('REPORT_REQUESTS') or []) if isinstance(r, dict)]
    if request_id:
        selected = [r for r in requests if r.get('id') == request_id and r.get('city') == city]
        if len(selected) != 1:
            return error(404, '未找到该报告申请')
        if selected[0].get('status') != 'done':
            return error(409, '该报告申请尚未完成')
        files = selected[0].get('files')
        # An explicit request never falls back to another report for its city.
        meta = next((m for m in (files or []) if isinstance(m, dict) and m.get('kind') == kind), None)
    else:
        meta = None
    done = [r for r in requests if r.get('city') == city and r.get('files')
            and r.get('status', 'done') == 'done']
    if done and not request_id:
        files = done[-1]['files']
    if not files and not request_id:
        for pv in (store.get('PROJECTS') or {}).values():
            if isinstance(pv, dict) and pv.get('city') == city and pv.get('reportFiles'):
                files = pv['reportFiles']; break
    if files and not request_id:
        meta = next((m for m in files if m.get('kind') == kind), None) or files[0]
    if not meta or not meta.get('b64'):
        msg = json.dumps({'ok': False, 'error': '未找到该城市原始报告文件'}).encode()
        self.send_response(404); self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(msg)))
        self.cors(); self.end_headers(); self.wfile.write(msg); return
    try:
        blob = base64.b64decode(''.join(meta['b64'].split()), validate=True)
        if not blob:
            raise ValueError('empty artifact')
    except Exception:
        return error(503, '报告文件校验失败，请稍后重试')
    fname = meta.get('name') or (city + '_报告.docx')
    fname_enc = urllib.parse.quote(fname)
    self.send_response(200)
    self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    self.send_header('Content-Disposition',
                     "attachment; filename*=UTF-8''" + fname_enc)
    self.send_header('Content-Length', str(len(blob)))
    self.cors(); self.end_headers(); self.wfile.write(blob)
    return
