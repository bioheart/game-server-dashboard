#!/usr/bin/env python3
"""
Game Server Dashboard Backend
Lightweight Web GUI for monitoring and controlling game servers via systemd.
Zero external dependencies (Python 3 standard library only).
"""

import os
import sys
import json
import time
import shutil
import socket
import re
import subprocess
import threading
import secrets
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")

# ==============================================================================
# Authentication & Session Management
# ==============================================================================
_sessions = {}  # token -> {"user": username, "expires_at": float}
_session_lock = threading.Lock()

def verify_linux_password(username, password):
    """
    Authenticate against Linux OS user account using PAM or spwd/crypt.
    """
    if not username or not password:
        return False

    # 1. Attempt PAM authentication (Debian python3-pam)
    try:
        import PAM
        def pam_conv(auth, query_list, userData):
            resp = []
            for query, q_type in query_list:
                if q_type in (PAM.PAM_PROMPT_ECHO_OFF, PAM.PAM_PROMPT_ECHO_ON):
                    resp.append((password, 0))
                else:
                    resp.append(("", 0))
            return resp

        auth = PAM.pam()
        auth.start("login")
        auth.set_item(PAM.PAM_USER, username)
        auth.set_item(PAM.PAM_CONV, pam_conv)
        auth.authenticate()
        auth.acct_mgmt()
        return True
    except Exception:
        pass

    # 2. Fallback to spwd + crypt (Debian 12 yescrypt / standard shadow)
    try:
        import spwd
        import crypt
        sp = spwd.getspnam(username)
        hashed = sp.sp_pwdp
        if hashed and hashed not in ("*", "!", "x"):
            return crypt.crypt(password, hashed) == hashed
    except Exception:
        pass

    return False

def get_token_from_handler(handler):
    """Extract session token from Cookie or Authorization header"""
    cookie_str = handler.headers.get("Cookie", "")
    for piece in cookie_str.split(";"):
        piece = piece.strip()
        if piece.startswith("session_token="):
            return piece.split("=", 1)[1].strip()
    auth_hdr = handler.headers.get("Authorization", "")
    if auth_hdr.startswith("Bearer "):
        return auth_hdr[7:].strip()
    return None

def get_current_user(handler):
    """Return authenticated username if valid session exists, else None"""
    cfg = load_config()
    auth_cfg = cfg.get("auth", {})
    if not auth_cfg.get("enabled", True):
        return "admin"

    token = get_token_from_handler(handler)
    if not token:
        return None

    now = time.time()
    with _session_lock:
        sess = _sessions.get(token)
        if sess:
            if sess["expires_at"] > now:
                return sess["user"]
            else:
                del _sessions[token]
    return None

# Global CPU tracker
_last_cpu_time = 0
_last_cpu_idle = 0
_last_cpu_total = 0

def get_host_ip():
    """Attempt to find primary LAN IP of the host"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        # Doesn't actually connect, just determines routing
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

DEFAULT_CONFIG = {
    "server": {
        "host": "0.0.0.0",
        "port": 8080,
        "title": "Game Server Dashboard"
    },
    "auth": {
        "enabled": True,
        "allowed_users": ["bioheart", "root"],
        "session_ttl_hours": 72
    },
    "games": [
        {
            "id": "necesse",
            "name": "Necesse",
            "service": "necesse",
            "port": 14159,
            "protocol": "UDP",
            "category": "game",
            "description": "Necesse Dedicated Server (bioheart-server)",
            "icon": "sword"
        },
        {
            "id": "playit",
            "name": "Playit.gg Tunnel",
            "service": "playit",
            "port": None,
            "protocol": "",
            "category": "tunnel",
            "description": "Playit Tunnel Agent for public access",
            "icon": "network"
        }
    ]
}

def load_config():
    if not os.path.exists(CONFIG_FILE):
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading config: {e}, using default")
        return DEFAULT_CONFIG

def save_config(cfg):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Error saving config: {e}")
        return False

def get_system_metrics():
    global _last_cpu_idle, _last_cpu_total, _last_cpu_time
    
    # 1. CPU calculation
    cpu_percent = 0.0
    try:
        with open("/proc/stat", "r") as f:
            line = f.readline()
            if line.startswith("cpu "):
                fields = [float(x) for x in line.split()[1:8]]
                idle = fields[3] + fields[4]  # idle + iowait
                total = sum(fields)
                if _last_cpu_total > 0:
                    diff_idle = idle - _last_cpu_idle
                    diff_total = total - _last_cpu_total
                    if diff_total > 0:
                        cpu_percent = round(100.0 * (1.0 - (diff_idle / diff_total)), 1)
                _last_cpu_idle = idle
                _last_cpu_total = total
    except Exception:
        pass

    # 2. RAM calculation
    ram_total_mb = 0
    ram_used_mb = 0
    ram_percent = 0.0
    try:
        with open("/proc/meminfo", "r") as f:
            mem = {}
            for line in f:
                parts = line.split(":")
                if len(parts) == 2:
                    key = parts[0].strip()
                    val = parts[1].strip().split()[0]
                    mem[key] = int(val)
            total_kb = mem.get("MemTotal", 0)
            avail_kb = mem.get("MemAvailable", mem.get("MemFree", 0))
            used_kb = max(0, total_kb - avail_kb)
            ram_total_mb = round(total_kb / 1024)
            ram_used_mb = round(used_kb / 1024)
            if total_kb > 0:
                ram_percent = round((used_kb / total_kb) * 100, 1)
    except Exception:
        pass

    # 3. Disk calculation
    disk_total_gb = 0
    disk_used_gb = 0
    disk_percent = 0.0
    try:
        usage = shutil.disk_usage("/")
        disk_total_gb = round(usage.total / (1024**3), 1)
        disk_used_gb = round(usage.used / (1024**3), 1)
        disk_percent = round((usage.used / usage.total) * 100, 1)
    except Exception:
        pass

    # 4. Host Uptime
    uptime_str = "Unknown"
    uptime_seconds = 0
    try:
        with open("/proc/uptime", "r") as f:
            uptime_seconds = float(f.readline().split()[0])
            days = int(uptime_seconds // 86400)
            hours = int((uptime_seconds % 86400) // 3600)
            mins = int((uptime_seconds % 3600) // 60)
            if days > 0:
                uptime_str = f"{days}d {hours}h {mins}m"
            elif hours > 0:
                uptime_str = f"{hours}h {mins}m"
            else:
                uptime_str = f"{mins}m"
    except Exception:
        pass

    hostname = socket.gethostname()

    return {
        "hostname": hostname,
        "host_ip": get_host_ip(),
        "cpu_percent": cpu_percent,
        "ram_total_mb": ram_total_mb,
        "ram_used_mb": ram_used_mb,
        "ram_percent": ram_percent,
        "disk_total_gb": disk_total_gb,
        "disk_used_gb": disk_used_gb,
        "disk_percent": disk_percent,
        "uptime": uptime_str,
        "uptime_seconds": uptime_seconds
    }

def get_service_status(service_name):
    """Query systemctl for detailed service status"""
    # Clean service name
    service_name = service_name.strip()
    if not service_name.endswith(".service"):
        unit_name = f"{service_name}.service"
    else:
        unit_name = service_name

    cmd = [
        "systemctl", "show", unit_name,
        "-p", "ActiveState,SubState,ActiveEnterTimestamp,MainPID,MemoryCurrent,CPUUsageNSec,Description,UnitFileState,LoadState"
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        out = res.stdout
    except Exception as e:
        return {
            "status": "unknown",
            "substate": "error",
            "error": str(e),
            "is_active": False,
            "pid": 0,
            "memory_mb": 0,
            "uptime_str": "-",
            "unit_file_state": "unknown"
        }

    props = {}
    for line in out.strip().split("\n"):
        if "=" in line:
            k, v = line.split("=", 1)
            props[k] = v

    load_state = props.get("LoadState", "not-found")
    if load_state == "not-found":
        return {
            "status": "not-found",
            "substate": "not-found",
            "is_active": False,
            "pid": 0,
            "memory_mb": 0,
            "uptime_str": "-",
            "unit_file_state": "not-found"
        }

    active_state = props.get("ActiveState", "inactive") # active, inactive, failed, activating, deactivating
    sub_state = props.get("SubState", "dead")
    pid = int(props.get("MainPID", "0") or "0")
    
    # Memory
    mem_raw = props.get("MemoryCurrent", "0")
    mem_mb = 0.0
    if mem_raw.isdigit() and int(mem_raw) > 0 and int(mem_raw) < 18446744073709551615:
        mem_mb = round(int(mem_raw) / (1024 * 1024), 1)
    elif pid > 0:
        # Fallback to /proc/<pid>/status VmRSS
        try:
            with open(f"/proc/{pid}/status", "r") as f:
                for line in f:
                    if line.startswith("VmRSS:"):
                        kb = int(line.split()[1])
                        mem_mb = round(kb / 1024, 1)
                        break
        except Exception:
            pass

    # Uptime duration
    uptime_str = "-"
    enter_ts = props.get("ActiveEnterTimestamp", "")
    if active_state == "active" and enter_ts:
        try:
            # Format: Tue 2026-10-06 21:12:40 +07 or similar
            # Use subprocess date to parse reliably or regex
            m = re.search(r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})", enter_ts)
            if m:
                ts_str = m.group(1)
                # Parse local time
                start_struct = time.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
                diff_sec = max(0, int(time.time() - time.mktime(start_struct)))
                days = diff_sec // 86400
                hrs = (diff_sec % 86400) // 3600
                mins = (diff_sec % 3600) // 60
                secs = diff_sec % 60
                if days > 0:
                    uptime_str = f"{days}d {hrs}h {mins}m"
                elif hrs > 0:
                    uptime_str = f"{hrs}h {mins}m"
                elif mins > 0:
                    uptime_str = f"{mins}m {secs}s"
                else:
                    uptime_str = f"{secs}s"
        except Exception:
            uptime_str = "Active"

    return {
        "status": active_state,
        "substate": sub_state,
        "is_active": (active_state == "active"),
        "pid": pid,
        "memory_mb": mem_mb,
        "uptime_str": uptime_str,
        "active_since": enter_ts,
        "unit_file_state": props.get("UnitFileState", "unknown")
    }

# ==============================================================================
# Tunnel Latency / Ping Tracker
# ==============================================================================
_ping_cache = {}  # host -> {"ms": float or None, "status": str, "updated": float}
_monitored_hosts = set()
_ping_lock = threading.Lock()

def measure_host_ping(host):
    """
    Measure ICMP round-trip latency to a target host or domain.
    Prefers IPv4 for Playit Anycast to get accurate edge routing.
    Returns latency in milliseconds (float) or None if unreachable.
    """
    if not host:
        return None
    if ":" in host:
        host = host.split(":")[0]
    host = host.strip()
    if not host:
        return None

    try:
        # Try IPv4 ping first (-4, 1 packet, 2s deadline)
        cmd = ["ping", "-4", "-c", "1", "-W", "2", host]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
        if res.returncode != 0:
            # Fallback to standard ping
            cmd = ["ping", "-c", "1", "-W", "2", host]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=3)

        if res.returncode == 0:
            m = re.search(r"time=([\d\.]+)\s*ms", res.stdout)
            if m:
                return round(float(m.group(1)), 1)
            m2 = re.search(r"rtt [^=]+=\s*[\d\.]+/([\d\.]+)/", res.stdout)
            if m2:
                return round(float(m2.group(1)), 1)
        return None
    except Exception:
        return None

def _update_single_ping(host):
    ms = measure_host_ping(host)
    with _ping_lock:
        if ms is not None:
            status = "good" if ms < 60 else ("fair" if ms < 130 else "high")
            _ping_cache[host] = {"ms": ms, "status": status, "updated": time.time()}
        else:
            _ping_cache[host] = {"ms": None, "status": "offline", "updated": time.time()}

def register_ping_host(host):
    """Register host for periodic background ping tracking"""
    if not host:
        return
    if ":" in host:
        host = host.split(":")[0]
    host = host.strip()
    if not host:
        return

    is_new = False
    with _ping_lock:
        if host not in _monitored_hosts:
            _monitored_hosts.add(host)
            is_new = True
            if host not in _ping_cache:
                _ping_cache[host] = {"ms": None, "status": "measuring", "updated": 0}

    if is_new:
        threading.Thread(target=_update_single_ping, args=(host,), daemon=True).start()

def get_cached_ping(host):
    """Retrieve current cached ping for a host (returns dict or None)"""
    if not host:
        return None
    if ":" in host:
        host = host.split(":")[0]
    host = host.strip()
    with _ping_lock:
        if host in _ping_cache:
            return dict(_ping_cache[host])
    register_ping_host(host)
    return {"ms": None, "status": "measuring", "updated": 0}

def _ping_monitor_loop():
    """Background daemon thread updating latency every 12 seconds"""
    while True:
        try:
            with _ping_lock:
                hosts = list(_monitored_hosts)

            for h in hosts:
                _update_single_ping(h)
                time.sleep(0.3)
        except Exception:
            pass
        time.sleep(12)

def get_playit_details():
    """Query playitd IPC socket for live tunnel, address, and latency information"""
    sock_path = "/run/playit/playitd.sock"
    if not os.path.exists(sock_path):
        return None
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(0.6)
        s.connect(sock_path)
        _ = s.recv(4096)  # consume initial hello frame
        req = {
            "ipc_version": 2,
            "request_id": 1,
            "request": {"type": "subscribe"}
        }
        s.sendall(json.dumps(req).encode() + b"\n")
        data = b""
        while b"\n" not in data:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
        s.close()

        parsed = json.loads(data.decode("utf-8"))
        snapshot = parsed.get("data", {}).get("response", {}).get("data", {}).get("snapshot", {})
        lifecycle = snapshot.get("lifecycle", {}).get("data", {})
        stats = snapshot.get("stats", {})

        tunnels = []
        for tun in lifecycle.get("tunnels", []):
            display_addr = tun.get("display_address")
            host = display_addr.split(":")[0] if display_addr else None
            tun_ping = get_cached_ping(host) if host else None
            tunnels.append({
                "display_address": display_addr,
                "destination": tun.get("destination"),
                "is_disabled": tun.get("is_disabled", False),
                "ping": tun_ping
            })

        return {
            "agent_id": lifecycle.get("agent_id"),
            "account_status": lifecycle.get("account_status"),
            "tunnels": tunnels,
            "stats": stats
        }
    except Exception:
        return None

def get_game_players(game_id, service_name, is_active):
    """Detect active players and max slots for game server"""
    if not is_active:
        return {"online": 0, "max": 0, "players": []}

    clean_id = (game_id or "").lower()
    clean_svc = (service_name or "").lower()

    if "necesse" in clean_id or "necesse" in clean_svc:
        log_path = "/home/gameserver/.config/Necesse/latest-server-log.txt"
        cfg_path = "/home/gameserver/.config/Necesse/cfg/server.cfg"

        max_slots = 10
        if os.path.exists(cfg_path):
            try:
                with open(cfg_path, "r", encoding="utf-8", errors="ignore") as f:
                    m = re.search(r"slots\s*=\s*(\d+)", f.read())
                    if m:
                        max_slots = int(m.group(1))
            except Exception:
                pass

        online_players = {}

        if os.path.exists(log_path):
            try:
                with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        # Client connected
                        m_conn = re.search(r'Client\s+"([^"]+)"\s+connected on slot\s+(\d+)/(\d+)', line)
                        if m_conn:
                            cid = m_conn.group(1)
                            max_slots = int(m_conn.group(3))
                            online_players[cid] = cid

                        # Associate actual character / player name
                        m_name = re.search(r'Migrated\s+([A-Za-z0-9_]+)\s+stats', line)
                        if m_name and online_players:
                            latest_id = list(online_players.keys())[-1]
                            online_players[latest_id] = m_name.group(1)

                        # Player disconnected: e.g. Player 76561198073842457 ("Menggang") disconnected
                        m_disc = re.search(r'Player\s+([0-9]+)\s+\("([^"]+)"\)\s+disconnected', line)
                        if m_disc:
                            cid = m_disc.group(1)
                            if cid in online_players:
                                del online_players[cid]
                            else:
                                uname = m_disc.group(2)
                                for k, v in list(online_players.items()):
                                    if v == uname:
                                        del online_players[k]

                        if "due to empty server" in line:
                            online_players.clear()
            except Exception:
                pass

        return {
            "online": len(online_players),
            "max": max_slots,
            "players": list(online_players.values())
        }

    return {"online": 0, "max": 0, "players": []}

def is_port_listening(port, protocol="TCP"):
    """Check if given port is currently open and listening"""
    if not port:
        return None
    try:
        port_num = int(port)
        proto_flag = "-u" if protocol.upper() == "UDP" else "-t"
        # -H flag suppresses the header row in ss
        res = subprocess.run(["ss", "-H", proto_flag, "-l", "-n", f"sport = :{port_num}"], capture_output=True, text=True, timeout=2)
        out = res.stdout.strip()
        return len(out) > 0
    except Exception:
        return None

def check_service_exists(service_name):
    """Check if a systemd unit exists"""
    clean_name = service_name.strip()
    if not clean_name.endswith(".service"):
        clean_name += ".service"
    try:
        res = subprocess.run(["systemctl", "list-unit-files", clean_name], capture_output=True, text=True, timeout=3)
        return clean_name in res.stdout
    except Exception:
        return False

def sanitize_service_name(name):
    """Ensure service name only contains alphanumeric, dashes, dots, underscores"""
    if not re.match(r"^[a-zA-Z0-9_\-\.]+$", name):
        raise ValueError("Invalid service name characters")
    return name

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def end_headers(self):
        # Prevent caching for API responses
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        # Auth status check
        if path == "/api/auth/me":
            user = get_current_user(self)
            self.send_json({
                "authenticated": bool(user),
                "username": user or ""
            })
            return

        # Security: protect all other /api/* endpoints
        if path.startswith("/api/"):
            user = get_current_user(self)
            if not user:
                self.send_json({"error": "กรุณาเข้าสู่ระบบก่อนใช้งาน", "require_login": True}, 401)
                return

        if path == "/api/status":
            cfg = load_config()
            system_info = get_system_metrics()
            playit_info = get_playit_details()

            # Map destination ports to playit display address and latency
            port_to_tunnel = {}
            port_to_tunnel_ping = {}
            if playit_info and playit_info.get("tunnels"):
                for tun in playit_info["tunnels"]:
                    dest = tun.get("destination", "")
                    if ":" in dest:
                        p = dest.split(":")[-1]
                        if p.isdigit():
                            port_num = int(p)
                            port_to_tunnel[port_num] = tun.get("display_address")
                            port_to_tunnel_ping[port_num] = tun.get("ping")

            games_status = []
            for g in cfg.get("games", []):
                svc_status = get_service_status(g["service"])
                port = g.get("port")
                protocol = g.get("protocol", "TCP")
                port_listening = is_port_listening(port, protocol) if port else None
                players = get_game_players(g.get("id"), g.get("service"), svc_status.get("is_active"))

                game_data = {
                    **g,
                    **svc_status,
                    "port_listening": port_listening,
                    "public_tunnel": port_to_tunnel.get(port) if port else None,
                    "public_tunnel_ping": port_to_tunnel_ping.get(port) if port else None,
                    "players": players
                }

                if g["service"] == "playit" or g.get("category") == "tunnel":
                    game_data["playit_details"] = playit_info

                games_status.append(game_data)

            self.send_json({
                "system": system_info,
                "title": cfg.get("server", {}).get("title", "Game Server Dashboard"),
                "games": games_status,
                "playit": playit_info,
                "timestamp": int(time.time())
            })
            return

        elif path == "/api/logs":
            service = query.get("service", [""])[0]
            lines = query.get("lines", ["50"])[0]
            try:
                lines_int = min(max(int(lines), 10), 300)
            except ValueError:
                lines_int = 50

            if not service:
                self.send_json({"error": "Service parameter missing"}, 400)
                return

            try:
                service = sanitize_service_name(service)
                if not service.endswith(".service"):
                    service_unit = f"{service}.service"
                else:
                    service_unit = service

                # Check if playit has its own dedicated log file
                if (service == "playit" or service == "playit.service") and os.path.exists("/var/log/playit/playit.log"):
                    cmd = ["tail", "-n", str(lines_int), "/var/log/playit/playit.log"]
                    res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                    output = res.stdout if res.stdout else res.stderr
                else:
                    cmd = ["journalctl", "-u", service_unit, "-n", str(lines_int), "--no-pager"]
                    res = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
                    output = res.stdout if res.stdout else res.stderr

                self.send_json({
                    "service": service,
                    "lines": lines_int,
                    "logs": output
                })
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
            return

        elif path == "/api/detect-services":
            # Search for available custom game services in systemd
            candidates = []
            try:
                search_dirs = ["/etc/systemd/system", "/lib/systemd/system"]
                for d in search_dirs:
                    if os.path.exists(d):
                        for f in os.listdir(d):
                            if f.endswith(".service"):
                                candidates.append(f[:-8])
            except Exception:
                pass
            self.send_json({"candidates": sorted(list(set(candidates)))})
            return

        elif path == "/" or path == "":
            self.path = "/index.html"
            return super().do_GET()

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            self.send_json({"error": "Invalid JSON body"}, 400)
            return

        if path == "/api/auth/login":
            username = str(payload.get("username", "")).strip()
            password = str(payload.get("password", ""))

            if not username or not password:
                self.send_json({"error": "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน"}, 400)
                return

            cfg = load_config()
            auth_cfg = cfg.get("auth", {})
            allowed = auth_cfg.get("allowed_users", ["bioheart", "root"])

            # Check if username allowed
            if allowed and username not in allowed:
                time.sleep(0.5)
                self.send_json({"error": f"ชื่อผู้ใช้ '{username}' ไม่มีสิทธิ์เข้าใช้งานระบบ"}, 403)
                return

            # Verify password against Linux OS
            if not verify_linux_password(username, password):
                time.sleep(0.5)
                self.send_json({"error": "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"}, 401)
                return

            token = secrets.token_hex(32)
            ttl_hours = auth_cfg.get("session_ttl_hours", 72)
            ttl_seconds = int(ttl_hours * 3600)
            expires_at = time.time() + ttl_seconds

            with _session_lock:
                _sessions[token] = {
                    "user": username,
                    "expires_at": expires_at
                }

            body = json.dumps({"success": True, "username": username, "token": token}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            cookie_val = f"session_token={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={ttl_seconds}"
            self.send_header("Set-Cookie", cookie_val)
            self.end_headers()
            self.wfile.write(body)
            return

        elif path == "/api/auth/logout":
            token = get_token_from_handler(self)
            if token:
                with _session_lock:
                    _sessions.pop(token, None)

            body = json.dumps({"success": True}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Set-Cookie", "session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax")
            self.end_headers()
            self.wfile.write(body)
            return

        # Security: Any other POST endpoint requires authentication
        user = get_current_user(self)
        if not user:
            self.send_json({"error": "กรุณาเข้าสู่ระบบก่อนใช้งาน", "require_login": True}, 401)
            return

        if path == "/api/action":
            service = payload.get("service", "").strip()
            action = payload.get("action", "").strip()

            if not service or not action:
                self.send_json({"error": "Missing service or action"}, 400)
                return

            allowed_actions = ["start", "stop", "restart", "enable", "disable"]
            if action not in allowed_actions:
                self.send_json({"error": f"Invalid action. Allowed: {', '.join(allowed_actions)}"}, 400)
                return

            try:
                service = sanitize_service_name(service)
                if not service.endswith(".service"):
                    unit_name = f"{service}.service"
                else:
                    unit_name = service

                cmd = ["systemctl", action, unit_name]
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
                if res.returncode == 0:
                    time.sleep(0.5)  # brief pause for systemd state transition
                    updated_status = get_service_status(service)
                    self.send_json({
                        "success": True,
                        "message": f"Service '{service}' {action}ed successfully",
                        "status": updated_status
                    })
                else:
                    self.send_json({
                        "success": False,
                        "error": res.stderr.strip() or f"Failed to {action} service"
                    }, 500)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
            return

        elif path == "/api/games/add":
            name = payload.get("name", "").strip()
            service = payload.get("service", "").strip()
            port = payload.get("port")
            protocol = payload.get("protocol", "UDP").strip().upper()
            description = payload.get("description", "").strip()
            icon = payload.get("icon", "gamepad").strip()
            category = payload.get("category", "game").strip()

            if not name or not service:
                self.send_json({"error": "Game name and service name are required"}, 400)
                return

            try:
                service = sanitize_service_name(service)
                if service.endswith(".service"):
                    service = service[:-8]
            except ValueError as e:
                self.send_json({"error": str(e)}, 400)
                return

            cfg = load_config()
            game_id = re.sub(r"[^a-zA-Z0-9_\-]", "", service.lower())

            # Check if duplicate ID
            for g in cfg.get("games", []):
                if g["id"] == game_id or g["service"] == service:
                    self.send_json({"error": f"Game or service '{service}' already exists"}, 400)
                    return

            port_val = None
            if port is not None and str(port).strip():
                try:
                    port_val = int(port)
                except ValueError:
                    self.send_json({"error": "Port must be a valid number"}, 400)
                    return

            new_game = {
                "id": game_id,
                "name": name,
                "service": service,
                "port": port_val,
                "protocol": protocol,
                "category": category,
                "description": description,
                "icon": icon
            }

            cfg.setdefault("games", []).append(new_game)
            if save_config(cfg):
                self.send_json({"success": True, "game": new_game})
            else:
                self.send_json({"error": "Failed to save configuration"}, 500)
            return

        elif path == "/api/games/edit":
            game_id = payload.get("id", "").strip()
            if not game_id:
                self.send_json({"error": "Game ID required"}, 400)
                return

            cfg = load_config()
            found = False
            for g in cfg.get("games", []):
                if g["id"] == game_id:
                    if "name" in payload and payload["name"].strip():
                        g["name"] = payload["name"].strip()
                    if "port" in payload:
                        p = payload["port"]
                        g["port"] = int(p) if (p is not None and str(p).strip()) else None
                    if "protocol" in payload:
                        g["protocol"] = payload["protocol"].strip().upper()
                    if "description" in payload:
                        g["description"] = payload["description"].strip()
                    if "icon" in payload:
                        g["icon"] = payload["icon"].strip()
                    if "category" in payload:
                        g["category"] = payload["category"].strip()
                    found = True
                    break

            if not found:
                self.send_json({"error": "Game not found"}, 404)
                return

            if save_config(cfg):
                self.send_json({"success": True})
            else:
                self.send_json({"error": "Failed to save changes"}, 500)
            return

        elif path == "/api/games/delete":
            game_id = payload.get("id", "").strip()
            if not game_id:
                self.send_json({"error": "Game ID required"}, 400)
                return

            cfg = load_config()
            orig_len = len(cfg.get("games", []))
            cfg["games"] = [g for g in cfg.get("games", []) if g["id"] != game_id]

            if len(cfg["games"]) == orig_len:
                self.send_json({"error": "Game ID not found"}, 404)
                return

            if save_config(cfg):
                self.send_json({"success": True})
            else:
                self.send_json({"error": "Failed to delete game"}, 500)
            return

        self.send_json({"error": "Endpoint not found"}, 404)

def run():
    # Start background ping monitoring thread
    ping_thread = threading.Thread(target=_ping_monitor_loop, daemon=True)
    ping_thread.start()

    cfg = load_config()
    server_cfg = cfg.get("server", {})
    host = server_cfg.get("host", "0.0.0.0")
    port = int(server_cfg.get("port", 8080))

    server_address = (host, port)
    httpd = ThreadedHTTPServer(server_address, DashboardHandler)
    print(f"🚀 Game Server Dashboard running on http://{host}:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dashboard server...")
        httpd.server_close()

if __name__ == "__main__":
    run()
