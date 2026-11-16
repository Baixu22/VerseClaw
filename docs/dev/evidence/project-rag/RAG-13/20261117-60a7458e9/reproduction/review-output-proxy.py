import json
import os
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def start_proxy():
    log = Path(os.environ['RAG_REVIEW_PROXY_LOG'])

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def forward(self):
            body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
            record = {'path': self.path, 'method': self.command}
            if body and self.path.endswith('/responses'):
                data = json.loads(body)
                record.update(model=data.get('model'), maxOutputBefore=data.get('max_output_tokens'))
                data['max_output_tokens'] = 65536
                record['maxOutputAfter'] = data['max_output_tokens']
                body = json.dumps(data, ensure_ascii=False).encode('utf-8')
            headers = {key: value for key, value in self.headers.items()
                       if key.lower() not in ['host', 'content-length', 'connection', 'transfer-encoding']}
            request = urllib.request.Request('http://127.0.0.1:15721' + self.path,
                                             data=body if body else None, headers=headers, method=self.command)
            try:
                response = urllib.request.urlopen(request, timeout=1200)
            except urllib.error.HTTPError as error:
                response = error
            except Exception as error:
                self.send_error(502, type(error).__name__)
                record.update(status=502, errorType=type(error).__name__)
                with log.open('a', encoding='utf-8') as output:
                    output.write(json.dumps(record) + '\n')
                return
            with response:
                record['status'] = response.status
                with log.open('a', encoding='utf-8') as output:
                    output.write(json.dumps(record) + '\n')
                self.send_response(response.status)
                for key, value in response.headers.items():
                    if key.lower() not in ['connection', 'transfer-encoding']:
                        self.send_header(key, value)
                self.send_header('Connection', 'close')
                self.end_headers()
                try:
                    while True:
                        chunk = response.read1(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass

        do_POST = forward
        do_GET = forward
        do_DELETE = forward

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f'http://127.0.0.1:{server.server_port}/v1'
