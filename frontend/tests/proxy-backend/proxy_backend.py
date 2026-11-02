from http.server import BaseHTTPRequestHandler, HTTPServer
import json


class ProxyProbeHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/"):
            status = 200
            payload = {"proxied": True, "path": self.path}
        else:
            status = 410
            payload = {"detail": "expired", "path": self.path}

        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        return


HTTPServer(("0.0.0.0", 8000), ProxyProbeHandler).serve_forever()
