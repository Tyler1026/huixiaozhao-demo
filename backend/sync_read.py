"""Read-side sync compatibility adapter with explicit dependencies."""
import json

def read_sync(responder,use_database,read,file_path,clean,*,view=None,vary=None):
    try:
        if use_database:
            result=read()
            raw_str=result or '{}'
        else:
            try:
                with open(file_path,encoding='utf-8') as source:
                    raw_str=source.read()
            except FileNotFoundError:
                raw_str='{}'
        try:
            cleaned=clean(json.loads(raw_str) if raw_str else {})
            if view is not None:
                cleaned=view(cleaned)
            raw_str=json.dumps(cleaned,ensure_ascii=False)
        except Exception:
            if view is not None:
                raise
            pass
        data=raw_str.encode()
    except Exception as error:
        data=json.dumps({'error':'sync view unavailable' if view is not None else str(error)}).encode()
    responder.send_response(200)
    responder.send_header('Content-Type','application/json; charset=utf-8')
    responder.send_header('Content-Length',str(len(data)))
    if vary is not None:
        responder.send_header('Cache-Control','no-store')
        responder.send_header('Vary',vary)
    responder.cors();responder.end_headers();responder.wfile.write(data)
