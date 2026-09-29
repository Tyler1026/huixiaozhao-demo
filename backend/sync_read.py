"""Read-side sync compatibility adapter with explicit dependencies."""
import json

def read_sync(responder,use_database,read,file_path,clean):
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
            raw_str=json.dumps(cleaned,ensure_ascii=False)
        except Exception:
            pass
        data=raw_str.encode()
    except Exception as error:
        data=json.dumps({'error':str(error)}).encode()
    responder.send_response(200)
    responder.send_header('Content-Type','application/json; charset=utf-8')
    responder.send_header('Content-Length',str(len(data)))
    responder.cors();responder.end_headers();responder.wfile.write(data)
