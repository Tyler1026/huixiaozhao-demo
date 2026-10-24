"""Serve the public visual assets without exposing application or stored data."""
import mimetypes
import re
from pathlib import Path
from urllib.parse import unquote


def serve_skin_asset(handler, request_path, root):
    name = unquote(request_path.removeprefix('/static/skin/'))
    allowed = {'.css', '.js', '.png', '.svg', '.mp4', '.webp', '.jpg'}
    try:
        base = Path(root).resolve()
        target = (base / name).resolve()
        valid = (bool(name) and '/' not in name and '\\' not in name
                 and target.parent == base and target.suffix.lower() in allowed
                 and target.is_file())
    except (ValueError, OSError):
        valid = False
    if not valid:
        handler.send_error(404)
        return
    size = target.stat().st_size
    start, end = 0, size - 1
    requested_range = handler.headers.get('Range')
    if requested_range:
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested_range)
        try:
            if not match or not any(match.groups()):
                raise ValueError()
            first, last = match.groups()
            if first:
                start = int(first)
                end = min(int(last), size - 1) if last else size - 1
            else:
                suffix = int(last)
                if suffix <= 0:
                    raise ValueError()
                start = max(0, size - suffix)
            if start >= size or start > end:
                raise ValueError()
        except ValueError:
            handler.send_response(416)
            handler.send_header('Content-Range', f'bytes */{size}')
            handler.send_header('Content-Length', '0')
            handler.end_headers()
            return
    handler.send_response(206 if requested_range else 200)
    handler.send_header('Content-Type', mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
    handler.send_header('Content-Length', str(end - start + 1))
    handler.send_header('Accept-Ranges', 'bytes')
    handler.send_header('Cache-Control', 'public, max-age=3600')
    handler.send_header('X-Content-Type-Options', 'nosniff')
    if requested_range:
        handler.send_header('Content-Range', f'bytes {start}-{end}/{size}')
    handler.end_headers()
    with target.open('rb') as source:
        source.seek(start)
        remaining = end - start + 1
        while remaining:
            chunk = source.read(min(remaining, 128 * 1024))
            if not chunk:
                break
            handler.wfile.write(chunk)
            remaining -= len(chunk)
