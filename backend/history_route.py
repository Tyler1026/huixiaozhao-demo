"""Snapshot history HTTP adapter with explicit storage dependencies."""
import json
import os

def history(self,use_database,connect,file_path):
    try:
        from urllib.parse import urlparse, parse_qs
        qs = parse_qs(urlparse(self.path).query)
        want_ts = qs.get('ts', [None])[0]
        items = []
        if use_database:
            conn = connect(); cur = conn.cursor()
            if want_ts:
                cur.execute("SELECT ts,data FROM sync_history WHERE ts=%s", (int(want_ts),))
                row = cur.fetchone()
                cur.close(); conn.close()
                if row:
                    resp = json.dumps({'ok': True, 'ts': row[0], 'data': row[1]}).encode()
                else:
                    resp = json.dumps({'ok': False, 'error': 'snapshot not found'}).encode()
                self.send_response(200); self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(resp)))
                self.cors(); self.end_headers(); self.wfile.write(resp); return
            cur.execute("SELECT ts,length(data),created_at FROM sync_history ORDER BY ts DESC")
            for r in cur.fetchall():
                items.append({'ts': r[0], 'bytes': r[1], 'at': str(r[2])})
            cur.close(); conn.close()
        else:
            import glob
            for f in sorted(glob.glob(file_path + '.bak.*'), reverse=True):
                try:
                    ts = int(f.rsplit('.', 1)[-1])
                except Exception:
                    continue
                if want_ts and str(ts) != str(want_ts):
                    continue
                if want_ts:
                    with open(f, 'r', encoding='utf-8') as fh:
                        resp = json.dumps({'ok': True, 'ts': ts, 'data': fh.read()}).encode()
                    self.send_response(200); self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(resp)))
                    self.cors(); self.end_headers(); self.wfile.write(resp); return
                items.append({'ts': ts, 'bytes': os.path.getsize(f), 'at': f})
            if want_ts:
                resp = json.dumps({'ok': False, 'error': 'snapshot not found'}).encode()
                self.send_response(200); self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(resp)))
                self.cors(); self.end_headers(); self.wfile.write(resp); return
        resp = json.dumps({'ok': True, 'count': len(items), 'snapshots': items},
                          ensure_ascii=False).encode()
    except Exception as e:
        resp = json.dumps({'ok': False, 'error': str(e)}).encode()
    self.send_response(200); self.send_header('Content-Type', 'application/json')
    self.send_header('Content-Length', str(len(resp)))
    self.cors(); self.end_headers(); self.wfile.write(resp); return
