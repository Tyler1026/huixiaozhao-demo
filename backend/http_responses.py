"""Response adapters with explicit dependencies; no application globals."""

def serve_html(responder, path):
    """Serve original HTML bytes/headers; caller owns route selection and CORS."""
    try:
        with open(path, 'rb') as source:
            data = source.read()
        responder.send_response(200)
        responder.send_header('Content-Type', 'text/html; charset=utf-8')
        responder.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        responder.send_header('Content-Length', str(len(data)))
        responder.cors()
        responder.end_headers()
        responder.wfile.write(data)
    except FileNotFoundError:
        responder.send_error(404, 'HTML not found')
