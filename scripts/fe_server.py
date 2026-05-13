#!/usr/bin/env python3
"""
pre_ui — 5174 静态文件 + master 反代一体 server.

设计仿 agent-fe internal/feserver (Go httputil.ReverseProxy), 用 Python stdlib 等价实现:
- /api/v1/* → 反代到 http://127.0.0.1:19500/api/v1/*
- /healthz  → 反代到 http://127.0.0.1:19500/healthz
- 其他      → serve 项目根目录静态文件 (index.html / agents.html / shared/...)

为什么需要反代:
- 浏览器同 origin (5174 → 5174) 调 ./api/v1/*, 完全无 CORS / preflight
- 不依赖 agent-fe / feserver, pre_ui 自包含完整启动方案
- 学自 agent-fe/internal/feserver/proxy.go 的 ReverseProxy 形态

启动 (推荐用 fe_ctl.sh):
  bash scripts/fe_ctl.sh start

直接运行:
  python3 scripts/fe_server.py [--port 5174] [--bind 127.0.0.1] [--master http://127.0.0.1:19500]
"""
from __future__ import annotations
import argparse
import http.server
import os
import socketserver
import sys
import urllib.error
import urllib.request

DEFAULT_PORT = 5174
DEFAULT_BIND = "127.0.0.1"
DEFAULT_MASTER = "http://127.0.0.1:19500"
PROXY_PREFIXES = ("/api/v1/", "/api/v1", "/healthz")

# urllib 在某些用户环境会读 HTTP_PROXY/http_proxy 把 loopback 请求路给系统代理 (Surge / Clash 等),
# 即使 no_proxy 含 127.0.0.1 也不一定可靠. 用显式空 ProxyHandler 强制 direct.
_NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

# RFC 7230 hop-by-hop, 不透传
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "host",
}

# 反代上行 strip: hop-by-hop + 浏览器 origin/referer.
# fe_server 是反代, master 应视 fe_server 调用为可信 (同机), Origin 校验由 fe_server 自己负责
# (CSRF 防御在面向浏览器的这一层). 不 strip 会让 LAN IP origin 命中 master 白名单失败.
_STRIP_REQ = HOP_BY_HOP | {"origin", "referer"}

# 颜色 (与 fe_ctl.sh 对齐, 严禁红绿)
C_CYAN = "\033[36m"
C_YELLOW = "\033[33m"
C_BLUE = "\033[34m"
C_MAGENTA = "\033[35m"
C_DIM = "\033[2m"
C_RESET = "\033[0m"


def _color_for(status: int, mode: str) -> str:
    if status >= 500:
        return C_MAGENTA
    if status >= 400:
        return C_YELLOW
    if mode == "proxy":
        return C_BLUE
    return C_CYAN


def _build_handler(static_root: str, master_url: str):
    """工厂方法: 把 static_root / master_url 闭包进 handler."""

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=static_root, **kwargs)

        def _is_proxy_path(self) -> bool:
            # 取掉 query 比对 prefix
            p = self.path.split("?", 1)[0]
            for prefix in PROXY_PREFIXES:
                if p == prefix or p.startswith(prefix.rstrip("/") + "/") or p == prefix.rstrip("/"):
                    return True
            return False

        def _is_sse_path(self) -> bool:
            # SSE 流式端点 (master /api/v1/agents/<id>/transcript/stream).
            # urllib + resp.read() 会整包缓冲, 必须走单独的 read1 + flush 循环.
            p = self.path.split("?", 1)[0]
            return p.endswith("/transcript/stream")

        # --- 静默默认 stderr log, 用 log_request 自定义彩色 ---
        def log_message(self, fmt, *args):
            return

        def log_request(self, code="-", size="-"):
            try:
                c = int(code)
            except (TypeError, ValueError):
                c = 0
            mode = "proxy" if self._is_proxy_path() else "static"
            color = _color_for(c, mode)
            sys.stderr.write(
                f"{color}{c:>3} {self.command:<5}{C_RESET} {self.path} {C_DIM}({mode}){C_RESET}\n"
            )

        # --- proxy ---
        def _do_proxy(self):
            target_url = master_url.rstrip("/") + self.path
            method = self.command

            body = None
            cl = self.headers.get("Content-Length")
            if cl:
                try:
                    body = self.rfile.read(int(cl))
                except Exception:
                    body = b""

            fwd_headers = {}
            for k, v in self.headers.items():
                if k.lower() in _STRIP_REQ:
                    continue
                fwd_headers[k] = v

            req = urllib.request.Request(
                target_url, data=body, method=method, headers=fwd_headers
            )
            if self._is_sse_path():
                self._do_proxy_stream(req)
                return
            try:
                with _NO_PROXY_OPENER.open(req, timeout=20) as resp:
                    self._write_resp(resp.status, resp.headers, resp.read())
            except urllib.error.HTTPError as e:
                # 4xx/5xx 透传
                try:
                    body_e = e.read() or b""
                except Exception:
                    body_e = b""
                self._write_resp(e.code, e.headers, body_e)
            except urllib.error.URLError as e:
                msg = (
                    '{"error":"master unreachable",'
                    f'"detail":{repr(str(e.reason))[:200]}}}'
                ).encode()
                self._write_resp(502, None, msg, ct="application/json")
            except Exception as e:
                msg = (
                    '{"error":"proxy error",'
                    f'"detail":{repr(str(e))[:200]}}}'
                ).encode()
                self._write_resp(502, None, msg, ct="application/json")

        def _write_resp(self, status, src_headers, body: bytes, ct: str = None):
            self.send_response(status)
            wrote_ct = False
            if src_headers is not None:
                for k, v in src_headers.items():
                    lk = k.lower()
                    if lk in HOP_BY_HOP:
                        continue
                    if lk == "content-length":
                        continue  # 自重算
                    if lk == "content-type":
                        wrote_ct = True
                    self.send_header(k, v)
            if not wrote_ct and ct:
                self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except Exception:
                pass

        # --- streaming proxy (SSE) ---
        # urllib resp.read() 会阻塞到 EOF, 对 text/event-stream 无效;
        # 这里只 send headers 一次, 然后 read1 一片 flush 一片, 直到上游关闭或浏览器掉线.
        # 不发 Content-Length, 不复用连接 (Connection: close); HTTP/1.0 默认 close-after-body.
        def _do_proxy_stream(self, req):
            try:
                resp = _NO_PROXY_OPENER.open(req, timeout=None)
            except urllib.error.HTTPError as e:
                try:
                    body_e = e.read() or b""
                except Exception:
                    body_e = b""
                self._write_resp(e.code, e.headers, body_e)
                return
            except urllib.error.URLError as e:
                msg = (
                    '{"error":"master unreachable",'
                    f'"detail":{repr(str(e.reason))[:200]}}}'
                ).encode()
                self._write_resp(502, None, msg, ct="application/json")
                return
            except Exception as e:
                msg = (
                    '{"error":"proxy error",'
                    f'"detail":{repr(str(e))[:200]}}}'
                ).encode()
                self._write_resp(502, None, msg, ct="application/json")
                return

            try:
                self.send_response(resp.status)
                wrote_ct = False
                for k, v in resp.headers.items():
                    lk = k.lower()
                    if lk in HOP_BY_HOP:
                        continue
                    if lk == "content-length":
                        continue
                    if lk == "content-type":
                        wrote_ct = True
                    self.send_header(k, v)
                if not wrote_ct:
                    self.send_header("Content-Type", "text/event-stream")
                # X-Accel-Buffering: nginx/proxy hint 不缓冲 (即使前面再叠一层 reverse proxy)
                self.send_header("X-Accel-Buffering", "no")
                self.send_header("Cache-Control", "no-cache, no-transform")
                self.send_header("Connection", "close")
                self.end_headers()
                try:
                    self.wfile.flush()
                except Exception:
                    pass

                # 流式 pump: read1 一片就 flush 一片
                while True:
                    try:
                        chunk = resp.read1(4096)
                    except Exception:
                        break
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        break
            finally:
                try:
                    resp.close()
                except Exception:
                    pass
                # 流连接一次性, 不复用
                self.close_connection = True

        # --- methods ---
        def end_headers(self):
            # 静态资源加多重 no-cache 头, 覆盖各浏览器 quirk (Safari ignores no-store
            # 单独头, Firefox 偶尔 cache .js in-memory across reloads)
            if not self._is_proxy_path():
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
            super().end_headers()

        def do_GET(self):
            if self._is_proxy_path():
                self._do_proxy()
            else:
                super().do_GET()

        def do_POST(self):
            if self._is_proxy_path():
                self._do_proxy()
            else:
                self.send_error(405, "POST not allowed on static")

        def do_HEAD(self):
            if self._is_proxy_path():
                self._do_proxy()
            else:
                super().do_HEAD()

        def do_OPTIONS(self):
            # 同 origin 浏览器不发 OPTIONS, 兜底 204
            self.send_response(204)
            self.end_headers()

    return Handler


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    p = argparse.ArgumentParser(
        description="pre_ui 5174 静态文件 + master 反代一体 server"
    )
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--bind", default=DEFAULT_BIND)
    p.add_argument(
        "--master",
        default=DEFAULT_MASTER,
        help="master 反代目标 (默认 http://127.0.0.1:19500)",
    )
    p.add_argument(
        "--root",
        default=None,
        help="静态根目录 (默认: scripts/.. = 项目根)",
    )
    args = p.parse_args()

    if args.root:
        static_root = os.path.abspath(args.root)
    else:
        static_root = os.path.dirname(
            os.path.dirname(os.path.abspath(__file__))
        )

    handler_cls = _build_handler(static_root, args.master)
    httpd = ThreadedHTTPServer((args.bind, args.port), handler_cls)

    sys.stderr.write(f"{C_MAGENTA}━━━ pre_ui server ━━━{C_RESET}\n")
    sys.stderr.write(f"{C_BLUE}[info]{C_RESET} listen      : {args.bind}:{args.port}\n")
    sys.stderr.write(f"{C_BLUE}[info]{C_RESET} static root : {static_root}\n")
    sys.stderr.write(
        f"{C_BLUE}[info]{C_RESET} proxy paths : {' '.join(PROXY_PREFIXES)} → {args.master}\n"
    )
    sys.stderr.write(
        f"{C_CYAN}[ok]{C_RESET} ready. open http://{args.bind}:{args.port}/agents.html\n"
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write(f"\n{C_BLUE}[info]{C_RESET} stopping (Ctrl+C)\n")
        httpd.server_close()


if __name__ == "__main__":
    main()
