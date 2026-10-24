"""Public skin routes use the real HTTP handler and isolated account storage."""
import http.client
import unittest
from pathlib import Path

from test_auth_http import HttpFixture

ROOT = Path(__file__).resolve().parents[1]


class SkinRouteTests(unittest.TestCase):
    def test_landing_and_existing_workspace_links(self):
        with HttpFixture() as app:
            for route in ('/', '/welcome'):
                status, _, body = app.request('GET', route)
                self.assertEqual(status, 200)
                self.assertIn('AI 精准招商'.encode(), body)
                self.assertIn(b'/app?screen=login', body)
                self.assertNotIn(b'client.html?screen=', body)
            for route in ('/app', '/index.html', '/client.html'):
                status, _, body = app.request('GET', route)
                self.assertEqual(status, 200)
                self.assertEqual(body, (ROOT / 'index.html').read_bytes())
            self.assertEqual(app.request('GET', '/api/sync')[0], 401)

    def test_assets_video_range_and_private_file_boundary(self):
        with HttpFixture() as app:
            host, port = app.server.server_address

            def get(path, headers=None):
                connection = http.client.HTTPConnection(host, port, timeout=5)
                try:
                    connection.request('GET', path, headers=headers or {})
                    response = connection.getresponse()
                    return response.status, dict(response.getheaders()), response.read()
                finally:
                    connection.close()

            status, headers, body = get('/static/skin/tokens.css?v=1')
            self.assertEqual(status, 200)
            self.assertIn('text/css', headers['Content-Type'])
            self.assertIn(b'--', body)
            video = ROOT / 'frontend/public/skin/hero-city-loop.mp4'
            status, headers, body = get('/static/skin/hero-city-loop.mp4', {'Range': 'bytes=0-1023'})
            self.assertEqual(status, 206)
            self.assertEqual(headers['Content-Range'], f'bytes 0-1023/{video.stat().st_size}')
            self.assertEqual(body, video.read_bytes()[:1024])
            status, headers, body = get('/static/skin/hero-city-loop.mp4', {'Range': 'bytes=-32'})
            self.assertEqual(status, 206)
            self.assertEqual(body, video.read_bytes()[-32:])
            self.assertEqual(get('/static/skin/hero-city-loop.mp4', {'Range': 'bytes=999999999-'})[0], 416)
            for name in ('../server.py', '%2e%2e%2fserver.py', '%2fetc%2fpasswd', '%00.css', 'missing.png', 'secret.key'):
                self.assertEqual(get('/static/skin/' + name)[0], 404, name)
