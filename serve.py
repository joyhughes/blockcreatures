#!/usr/bin/env python3
"""Static dev server that tells the browser never to cache, so edits to
src/*.js show up on a normal reload. Usage: python3 serve.py [port]"""
import http.server, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f'Block creatures at http://localhost:{port}')
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
