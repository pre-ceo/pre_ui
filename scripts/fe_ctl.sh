#!/usr/bin/env bash
# scripts/fe_ctl.sh — 用 tmux 长驻 pre_ui 静态 server, 提供 start/stop/status/logs/restart
# Modeled after pre's bus_ctl.sh, keeps the workflow consistent.
#
# 用法:
#   bash scripts/fe_ctl.sh start            # 启动静态 server
#   bash scripts/fe_ctl.sh stop             # 停止
#   bash scripts/fe_ctl.sh restart
#   bash scripts/fe_ctl.sh status
#   bash scripts/fe_ctl.sh logs             # 最近 200 行
#   bash scripts/fe_ctl.sh logs -f          # 实时 attach (Ctrl+B D 退出不杀进程)
#   bash scripts/fe_ctl.sh attach
#
# 环境变量:
#   PREUI_PORT      静态 server 端口 (默认 5174)
#   PREUI_BIND      监听地址 (默认 127.0.0.1)
#   PREUI_SESSION   tmux session 名 (默认 preui-static)

set -euo pipefail

PORT="${PREUI_PORT:-5174}"
BIND="${PREUI_BIND:-127.0.0.1}"
MASTER="${PREUI_MASTER:-http://127.0.0.1:19500}"
SESSION="${PREUI_SESSION:-preui-static}"
PRE_FE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------- 颜色 (cyan/yellow/blue/magenta, 严禁红绿) ----------
C_CYAN='\033[36m'
C_YELLOW='\033[33m'
C_BLUE='\033[34m'
C_MAGENTA='\033[35m'
C_DIM='\033[2m'
C_RESET='\033[0m'

info()  { printf "${C_BLUE}[info]${C_RESET} %s\n" "$*"; }
ok()    { printf "${C_CYAN}[ok]${C_RESET} %s\n" "$*"; }
warn()  { printf "${C_YELLOW}[warn]${C_RESET} %s\n" "$*"; }
emph()  { printf "${C_MAGENTA}[!]${C_RESET} %s\n" "$*"; }
dim()   { printf "${C_DIM}%s${C_RESET}\n" "$*"; }

require_tmux() {
    command -v tmux >/dev/null 2>&1 || { emph "tmux not found, please install (brew install tmux)"; exit 1; }
}

session_exists() {
    tmux has-session -t "$1" 2>/dev/null
}

port_listening() {
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

port_owner_pid() {
    lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1
}

# ---------- start ----------
cmd_start() {
    require_tmux
    if session_exists "$SESSION"; then
        warn "$SESSION already running"
        cmd_status
        return 0
    fi
    if port_listening "$PORT"; then
        local pid; pid=$(port_owner_pid "$PORT")
        warn "port $PORT already listening (PID $pid). 先 stop 或 kill, 再 start."
        return 1
    fi
    info "starting pre_ui server in tmux session [$SESSION]"
    info "  cwd:    $PRE_FE_DIR"
    info "  cmd:    python3 scripts/fe_server.py --port $PORT --bind $BIND --master $MASTER"
    info "  static: $PRE_FE_DIR/*"
    info "  proxy:  /api/v1/* /healthz → $MASTER"
    tmux new-session -d -s "$SESSION" -c "$PRE_FE_DIR" \
        "python3 scripts/fe_server.py --port $PORT --bind $BIND --master $MASTER"
    # 等端口监听 (静态 server 通常 < 1s)
    local i=0
    while ! port_listening "$PORT"; do
        sleep 0.25
        i=$((i+1))
        if [[ $i -ge 20 ]]; then
            emph "port $PORT not listening after 5s — check logs:"
            tmux capture-pane -t "$SESSION" -p -S -50 || true
            return 1
        fi
    done
    ok "pre_ui server listening on $BIND:$PORT"
    info "浏览器打开: http://$BIND:$PORT/agents.html"
    info "  · 静态文件 + /api 反代同 origin, 浏览器无 CORS"
    info "  · 改 token 在 settings.html, 默认 pre"
}

# ---------- stop ----------
cmd_stop() {
    require_tmux
    if session_exists "$SESSION"; then
        info "stopping $SESSION"
        # 先 Ctrl+C 让 python http.server 优雅退, 再 kill-session
        tmux send-keys -t "$SESSION" C-c 2>/dev/null || true
        sleep 1
        tmux kill-session -t "$SESSION" 2>/dev/null || true
        ok "$SESSION stopped"
    else
        dim "$SESSION not running"
    fi
}

# ---------- restart ----------
cmd_restart() {
    cmd_stop
    sleep 1
    cmd_start
}

# ---------- status ----------
cmd_status() {
    require_tmux
    printf "${C_MAGENTA}━━━ pre_ui server status ━━━${C_RESET}\n"
    if session_exists "$SESSION"; then
        ok "tmux session: $SESSION (alive)"
    else
        dim "tmux session: $SESSION (down)"
    fi
    if port_listening "$PORT"; then
        local pid; pid=$(port_owner_pid "$PORT")
        ok "port $BIND:$PORT listening (PID $pid)"
        # 静态探活
        local first_line
        first_line=$(curl -sS -m 2 "http://$BIND:$PORT/index.html" 2>/dev/null | head -1 | tr -d '\r' || true)
        if [[ "$first_line" == "<!DOCTYPE html>" ]]; then
            ok "static probe : index.html responds OK"
        else
            warn "static probe : index.html unexpected first line: ${first_line:0:60}"
        fi
        # 反代探活 (通过 5174 调到 master /healthz)
        local hz; hz=$(curl -sS -m 3 "http://$BIND:$PORT/healthz" 2>/dev/null | head -1 | tr -d '\r' || true)
        if [[ "$hz" == "pre master ok" ]]; then
            ok "proxy probe  : /healthz → master ok"
        else
            warn "proxy probe  : /healthz unexpected: ${hz:0:60}"
        fi
        # master 直连状态 (帮助用户判断是 master 挂了还是反代挂了)
        if curl -sS -m 2 "$MASTER/healthz" >/dev/null 2>&1; then
            ok "master direct: $MASTER reachable"
        else
            warn "master direct: $MASTER unreachable (反代会回 502)"
        fi
        # 文件统计
        local html_count js_count css_count
        html_count=$(find "$PRE_FE_DIR" -maxdepth 1 -name '*.html' -type f | wc -l | tr -d ' ')
        js_count=$(find "$PRE_FE_DIR/js" "$PRE_FE_DIR/shared" -name '*.js' -type f 2>/dev/null | wc -l | tr -d ' ')
        css_count=$(find "$PRE_FE_DIR/css" "$PRE_FE_DIR/shared" -name '*.css' -type f 2>/dev/null | wc -l | tr -d ' ')
        info "served files : $html_count html, $js_count js, $css_count css"
    else
        dim "port $BIND:$PORT not listening"
    fi
    info "URL: http://$BIND:$PORT/agents.html"
}

# ---------- logs ----------
cmd_logs() {
    require_tmux
    if ! session_exists "$SESSION"; then
        warn "$SESSION not running"
        return 1
    fi
    if [[ "${1:-}" == "-f" ]]; then
        info "attaching to $SESSION (Ctrl+B then D to detach without stopping)"
        tmux attach-session -t "$SESSION"
    else
        # 显示最近 200 行
        tmux capture-pane -t "$SESSION" -p -S -200
    fi
}

# ---------- attach ----------
cmd_attach() {
    require_tmux
    if ! session_exists "$SESSION"; then
        warn "$SESSION not running, start it first"
        return 1
    fi
    info "attaching to $SESSION (Ctrl+B then D to detach)"
    tmux attach-session -t "$SESSION"
}

# ---------- usage ----------
usage() {
    cat <<EOF
pre_ui fe_ctl.sh — tmux 监管静态 server (5174)

用法:
  bash $0 start                启动 (tmux 后台 session, 等端口监听)
  bash $0 stop                 停止 (Ctrl+C → 1s → kill-session)
  bash $0 restart
  bash $0 status               session/port/content 探活 + 文件统计
  bash $0 logs                 最近 200 行
  bash $0 logs -f              实时 attach (Ctrl+B D 退出不杀)
  bash $0 attach               同 logs -f

环境变量:
  PREUI_PORT     端口 (默认 5174)
  PREUI_BIND     监听地址 (默认 127.0.0.1)
  PREUI_MASTER   反代目标 master URL (默认 http://127.0.0.1:19500)
  PREUI_SESSION  tmux session 名 (默认 preui-static)

部署形态 (self-proxy):
  浏览器 5174 (同 origin, 无 CORS)
    → 静态文件: 项目根 *.html / js/ / css/ / shared/
    → /api/v1/* /healthz: 反代到 master 19500
  pre_ui 自包含, 不依赖 agent-fe / feserver.
EOF
}

# ---------- 入口 ----------
cmd="${1:-}"
shift || true
case "$cmd" in
    start)   cmd_start ;;
    stop)    cmd_stop ;;
    restart) cmd_restart ;;
    status)  cmd_status ;;
    logs)    cmd_logs "$@" ;;
    attach)  cmd_attach ;;
    -h|--help|help|"") usage ;;
    *)       emph "unknown command: $cmd"; usage; exit 1 ;;
esac
