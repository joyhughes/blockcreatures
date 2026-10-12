#!/usr/bin/env python3
"""Static dev server that tells the browser never to cache, so edits to
src/*.js show up on a normal reload. It also serves runs/index.json, a
listing of the run files in runs/ (newest first) for the app's Runs menu,
always current; on GitHub Pages the committed one (tools/runsindex.mjs) is used.
Usage: python3 serve.py [port]"""
import http.server, json, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] == '/runs/index.json':
            runs = []
            for f in os.listdir('runs') if os.path.isdir('runs') else []:
                p = os.path.join('runs', f)
                if f.endswith('.json') and f not in ('index.json', 'baseline.json') and os.path.isfile(p):
                    st = os.stat(p)
                    runs.append({'file': f, 'mtime': st.st_mtime, 'size': st.st_size})
            runs.sort(key=lambda r: -r['mtime'])
            body = json.dumps(runs).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f'Block creatures at http://localhost:{port}')
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
