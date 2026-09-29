"""Extraction HTTP adapter; parser is supplied by the composition root."""
import base64
import json

def extract_text(self,raw,parser):
    try:
        body = json.loads(raw)
        filename = body.get('filename', '') or 'upload'
        file_b64 = body.get('fileB64', '') or ''
        if not file_b64:
            resp = json.dumps({'ok': False, 'error': '缺少文件内容'}, ensure_ascii=False).encode('utf-8')
        else:
            try:
                _fb = base64.b64decode(file_b64)
            except Exception as _e:
                _fb = None
                resp = json.dumps({'ok': False, 'error': '文件解码失败：' + str(_e)},
                                  ensure_ascii=False).encode('utf-8')
            if _fb is not None:
                _txt, _err = parser(filename, _fb)
                if _err:
                    resp = json.dumps({'ok': False, 'error': _err}, ensure_ascii=False).encode('utf-8')
                else:
                    resp = json.dumps({'ok': True, 'text': _txt, 'chars': len(_txt)},
                                      ensure_ascii=False).encode('utf-8')
    except Exception as e:
        resp = json.dumps({'ok': False, 'error': '解析异常：' + str(e)},
                          ensure_ascii=False).encode('utf-8')
    self.send_response(200)
    self.send_header('Content-Type', 'application/json; charset=utf-8')
    self.send_header('Content-Length', str(len(resp)))
    self.cors(); self.end_headers(); self.wfile.write(resp)
    return
