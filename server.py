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
import ipaddress
import urllib.request
import smtplib
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
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

def get_cookie_value(handler, cookie_name):
    """Extract a specific cookie value from Cookie header"""
    cookie_str = handler.headers.get("Cookie", "")
    for piece in cookie_str.split(";"):
        piece = piece.strip()
        if piece.startswith(f"{cookie_name}="):
            return piece.split("=", 1)[1].strip()
    return None

def get_token_from_handler(handler):
    """Extract session token from Cookie or Authorization header"""
    token = get_cookie_value(handler, "session_token")
    if token:
        return token
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
    "wol": {
        "enabled": True,
        "devices": [
            {
                "id": "pc",
                "name": "PC ของฉัน (Gaming PC)",
                "mac": "D8-5E-D3-49-AF-47",
                "ip": "192.168.1.163",
                "broadcast": "192.168.1.255",
                "port": 9,
                "description": "Windows Gaming / Main PC"
            }
        ]
    },
    "notification": {
        "enabled": True,
        "email": {
            "recipient": "bioheart.kalel@gmail.com",
            "smtp_host": "smtp.gmail.com",
            "smtp_port": 587,
            "use_tls": True,
            "sender_email": "bioheart.darklight@gmail.com",
            "sender_password": "",
            "sender_name": "Game Server Security Alert"
        }
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

# ==============================================================================
# Security, Login Logging & Email Notification
# ==============================================================================
DATA_DIR = os.path.join(BASE_DIR, "data")
KNOWN_DEVICES_FILE = os.path.join(DATA_DIR, "known_devices.json")
LOGIN_HISTORY_FILE = os.path.join(DATA_DIR, "login_history.json")
_security_lock = threading.Lock()

def ensure_data_dir():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
    except Exception:
        pass

def load_known_devices():
    ensure_data_dir()
    if not os.path.exists(KNOWN_DEVICES_FILE):
        return {}
    try:
        with open(KNOWN_DEVICES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[Security] Error loading known devices: {e}")
        return {}

def save_known_devices(devices):
    ensure_data_dir()
    try:
        with open(KNOWN_DEVICES_FILE, "w", encoding="utf-8") as f:
            json.dump(devices, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"[Security] Error saving known devices: {e}")
        return False

def load_login_history():
    ensure_data_dir()
    if not os.path.exists(LOGIN_HISTORY_FILE):
        return []
    try:
        with open(LOGIN_HISTORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[Security] Error loading login history: {e}")
        return []

def save_login_history(history):
    ensure_data_dir()
    try:
        if len(history) > 500:
            history = history[:500]
        with open(LOGIN_HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"[Security] Error saving login history: {e}")
        return False

def get_client_ip(handler):
    """Extract real client IP considering reverse proxy headers or socket address"""
    for hdr in ["CF-Connecting-IP", "X-Forwarded-For", "X-Real-IP"]:
        val = handler.headers.get(hdr)
        if val:
            ip = val.split(",")[0].strip()
            if ip:
                return ip
    if hasattr(handler, "client_address") and handler.client_address:
        return handler.client_address[0]
    return "127.0.0.1"

def is_private_ip(ip_str):
    if not ip_str or ip_str in ("127.0.0.1", "::1", "localhost"):
        return True
    try:
        ip_obj = ipaddress.ip_address(ip_str)
        return ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local
    except ValueError:
        return False

def get_mac_for_ip(ip):
    """
    Look up MAC address from ARP cache (/proc/net/arp or `ip neigh`).
    Works for any device on the same local subnet (LAN).
    """
    if not ip or ip in ("127.0.0.1", "::1", "localhost"):
        return "Loopback (เครื่องเซิร์ฟเวอร์)"

    # 1. Look in /proc/net/arp
    try:
        if os.path.exists("/proc/net/arp"):
            with open("/proc/net/arp", "r", encoding="utf-8") as f:
                for line in f.readlines()[1:]:
                    parts = line.split()
                    if len(parts) >= 4 and parts[0] == ip:
                        mac = parts[3].strip().upper()
                        if mac and mac != "00:00:00:00:00:00":
                            return mac
    except Exception:
        pass

    # 2. Look in `ip neigh show <ip>`
    try:
        out = subprocess.check_output(["ip", "neigh", "show", ip], stderr=subprocess.DEVNULL, text=True, timeout=1.0)
        match = re.search(r"lladdr\s+([0-9a-fA-F:]{17})", out)
        if match:
            return match.group(1).upper()
    except Exception:
        pass

    if is_private_ip(ip):
        return "N/A (LAN)"
    return "N/A (ภายนอกเครือข่าย / ผ่าน Router)"

def get_geo_location(ip):
    """
    Query country and city for public IP. For private/LAN IPs returns Local Network.
    """
    if is_private_ip(ip):
        return {
            "country": "เครือข่ายภายในบ้าน (LAN)",
            "city": "Local Subnet",
            "region": "Home LAN",
            "isp": "Local Area Network",
            "is_local": True
        }

    try:
        url = f"http://ip-api.com/json/{ip}?fields=status,country,countryCode,regionName,city,isp,org"
        req = urllib.request.Request(url, headers={"User-Agent": "GameDashboard-Security/1.0"})
        with urllib.request.urlopen(req, timeout=2.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("status") == "success":
                country = data.get("country", "Unknown")
                country_code = data.get("countryCode", "")
                city = data.get("city", "")
                region = data.get("regionName", "")
                isp = data.get("isp") or data.get("org", "")
                display_country = f"{country} ({country_code})" if country_code else country
                if country_code == "TH":
                    display_country = "ประเทศไทย (Thailand)"
                return {
                    "country": display_country,
                    "city": city or region or "ไม่ระบุเมือง",
                    "region": region,
                    "isp": isp,
                    "is_local": False
                }
    except Exception as e:
        print(f"[Security] GeoIP lookup failed for {ip}: {e}")

    return {
        "country": "อินเทอร์เน็ตภายนอก (WAN)",
        "city": "Unknown",
        "region": "Unknown",
        "isp": "Unknown",
        "is_local": False
    }

def parse_user_agent(ua):
    """Parse user agent string to identify OS, browser, and device type"""
    if not ua:
        return {"os": "Unknown OS", "browser": "Unknown Browser", "device": "Unknown", "summary": "Unknown Device"}

    os_name = "Other OS"
    if "Windows NT 10.0" in ua or "Windows NT 11.0" in ua:
        os_name = "Windows 10/11"
    elif "Windows NT" in ua:
        os_name = "Windows"
    elif "iPhone" in ua:
        os_name = "iOS (iPhone)"
    elif "iPad" in ua:
        os_name = "iOS (iPad)"
    elif "Android" in ua:
        os_name = "Android"
    elif "Macintosh" in ua or "Mac OS X" in ua:
        os_name = "macOS"
    elif "Linux" in ua:
        os_name = "Linux"

    browser = "Other Browser"
    if "Edg/" in ua:
        browser = "Microsoft Edge"
    elif "Chrome/" in ua and "Edg/" not in ua:
        browser = "Google Chrome"
    elif "Firefox/" in ua:
        browser = "Mozilla Firefox"
    elif "Safari/" in ua and "Chrome/" not in ua:
        browser = "Apple Safari"
    elif "Opera" in ua or "OPR/" in ua:
        browser = "Opera"

    device_type = "Desktop"
    if "Mobile" in ua or "Android" in ua or "iPhone" in ua:
        device_type = "Mobile"
    elif "Tablet" in ua or "iPad" in ua:
        device_type = "Tablet"

    summary = f"{os_name} • {browser} ({device_type})"
    return {
        "os": os_name,
        "browser": browser,
        "device": device_type,
        "summary": summary
    }

def record_login_attempt(username, success, ip, mac, device_id, device_name, ua_str, geo_info, reason=""):
    now_ts = time.time()
    time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ua_info = parse_user_agent(ua_str)
    record = {
        "id": f"log_{secrets.token_hex(6)}",
        "timestamp": now_ts,
        "time_str": time_str,
        "username": username,
        "status": "success" if success else "failed",
        "reason": reason,
        "device_id": device_id,
        "device_name": device_name or ua_info["summary"],
        "ip": ip,
        "mac": mac,
        "country": geo_info.get("country", "Unknown"),
        "city": geo_info.get("city", "Unknown"),
        "is_new_device": False,
        "ua_summary": ua_info["summary"],
        "user_agent": ua_str
    }
    with _security_lock:
        hist = load_login_history()
        hist.insert(0, record)
        save_login_history(hist)

def send_security_alert_email(login_entry, is_test=False):
    """
    Send an email notification about new device login.
    """
    cfg = load_config()
    notif = cfg.get("notification", {})
    if not notif.get("enabled", True):
        return False, "ระบบแจ้งเตือนถูกปิดการใช้งานไว้ใน config"

    email_cfg = notif.get("email", {})
    recipient = email_cfg.get("recipient", "bioheart.kalel@gmail.com")
    smtp_host = email_cfg.get("smtp_host", "smtp.gmail.com")
    smtp_port = int(email_cfg.get("smtp_port", 587))
    use_tls = email_cfg.get("use_tls", True)
    sender_email = email_cfg.get("sender_email", "bioheart.kalel@gmail.com")
    sender_password = email_cfg.get("sender_password", "").strip()
    sender_name = email_cfg.get("sender_name", "Game Server Security Alert")

    if not sender_password:
        msg = "ยังไม่ได้ระบุรหัสผ่านส่งอีเมล (Gmail App Password) ในการตั้งค่า"
        print(f"[Security] {msg}")
        return False, msg

    username = login_entry.get("username", "Unknown")
    device_name = login_entry.get("device_name", "Unknown Device")
    client_ip = login_entry.get("ip", "Unknown")
    client_mac = login_entry.get("mac", "N/A")
    country = login_entry.get("country", "Unknown")
    city = login_entry.get("city", "")
    time_str = login_entry.get("time_str", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    ua_summary = login_entry.get("ua_summary", "Unknown Browser")

    location_display = f"{country} ({city})" if city and city != "เครือข่ายภายในบ้าน" and city != "Local Subnet" else country

    if is_test:
        subject = f"🔔 [Game Server] ทดสอบระบบแจ้งเตือนความปลอดภัย Email: {device_name}"
        header_title = "ทดสอบการส่งการแจ้งเตือนความปลอดภัย"
        banner_badge = "TEST NOTIFICATION"
        banner_color = "#3b82f6"
    else:
        subject = f"🚨 [Game Server] แจ้งเตือน: มีการ Login จากอุปกรณ์ใหม่ ({device_name})"
        header_title = "ตรวจพบการเข้าสู่ระบบจากอุปกรณ์ใหม่"
        banner_badge = "NEW DEVICE LOGIN"
        banner_color = "#f59e0b"

    html_content = f"""<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{subject}</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #0b0f19; font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif; color: #f1f5f9;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #111827; border: 1px solid #1f293d; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); padding: 24px 28px; border-bottom: 1px solid #1f293d;">
      <div style="margin-bottom: 10px;">
        <span style="background-color: {banner_color}; color: #ffffff; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: bold; letter-spacing: 0.5px;">
          {banner_badge}
        </span>
      </div>
      <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #ffffff; line-height: 1.3;">
        {header_title}
      </h1>
      <p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8;">
        Game Server Dashboard • ระบบรักษาความปลอดภัย
      </p>
    </div>

    <!-- Body Content -->
    <div style="padding: 24px 28px;">
      <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
        เรียนคุณ <strong>{username}</strong>,<br>
        ระบบตรวจพบว่ามีการเข้าสู่ระบบ (Login) เข้าสู่ <strong>Game Server Dashboard</strong> ด้วยอุปกรณ์ที่ยังไม่เคยถูกบันทึกไว้ในระบบ:
      </p>

      <!-- Details Table -->
      <div style="background-color: #0b0f19; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; width: 140px;">👤 บัญชีผู้ใช้:</td>
            <td style="padding: 8px 0; color: #f8fafc; font-weight: 600;">{username}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; border-top: 1px solid #1e293b;">💻 ชื่อเครื่อง / อุปกรณ์:</td>
            <td style="padding: 8px 0; color: #38bdf8; font-weight: 600; border-top: 1px solid #1e293b;">{device_name}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; border-top: 1px solid #1e293b;">🌐 IP Address:</td>
            <td style="padding: 8px 0; color: #f8fafc; font-family: monospace; font-weight: 600; border-top: 1px solid #1e293b;">{client_ip}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; border-top: 1px solid #1e293b;">🏷️ MAC Address:</td>
            <td style="padding: 8px 0; color: #a855f7; font-family: monospace; font-weight: 600; border-top: 1px solid #1e293b;">{client_mac}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; border-top: 1px solid #1e293b;">📍 ประเทศ / ตำแหน่ง:</td>
            <td style="padding: 8px 0; color: #34d399; font-weight: 600; border-top: 1px solid #1e293b;">{location_display}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; border-top: 1px solid #1e293b;">🔍 เบราว์เซอร์ & ระบบ:</td>
            <td style="padding: 8px 0; color: #cbd5e1; border-top: 1px solid #1e293b;">{ua_summary}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; border-top: 1px solid #1e293b;">🕒 วันที่และเวลา:</td>
            <td style="padding: 8px 0; color: #f8fafc; border-top: 1px solid #1e293b;">{time_str}</td>
          </tr>
        </table>
      </div>

      <!-- Advisory Boxes -->
      <div style="background-color: rgba(16, 185, 129, 0.08); border-left: 4px solid #10b981; border-radius: 4px; padding: 12px 16px; margin-bottom: 12px;">
        <p style="margin: 0; font-size: 12px; color: #a7f3d0; line-height: 1.5;">
          ✅ <strong>หากนี่คือการเข้าสู่ระบบของคุณเอง:</strong> คุณสามารถเพิกเฉยต่อข้อความนี้ได้ ระบบได้จดจำอุปกรณ์นี้ไว้แล้ว และจะไม่ส่งการแจ้งเตือนซ้ำสำหรับอุปกรณ์นี้
        </p>
      </div>

      <div style="background-color: rgba(239, 68, 68, 0.08); border-left: 4px solid #ef4444; border-radius: 4px; padding: 12px 16px;">
        <p style="margin: 0; font-size: 12px; color: #fca5a5; line-height: 1.5;">
          ⚠️ <strong>หากคุณไม่ได้เป็นผู้เข้าสู่ระบบ:</strong> กรุณาเข้าสู่ระบบผ่านเซิร์ฟเวอร์ และทำการเปลี่ยนรหัสผ่านผู้ใช้ Linux ทันทีเพื่อความปลอดภัย
        </p>
      </div>

    </div>

    <!-- Footer -->
    <div style="background-color: #0b0f19; padding: 16px 28px; border-top: 1px solid #1f293d; text-align: center; font-size: 11px; color: #64748b;">
      อีเมลนี้ถูกส่งโดยอัตโนมัติจาก Game Server Dashboard บนเซิร์ฟเวอร์ของคุณ<br>
      ส่งไปยัง: {recipient}
    </div>

  </div>
</body>
</html>"""

    plain_text = f"""[Game Server Security Alert]
{header_title}
--------------------------------------------------
ผู้ใช้: {username}
ชื่อเครื่อง/อุปกรณ์: {device_name}
IP Address: {client_ip}
MAC Address: {client_mac}
ตำแหน่ง/ประเทศ: {location_display}
เบราว์เซอร์: {ua_summary}
วันเวลา: {time_str}

* หากคุณเป็นผู้เข้าใช้งานเอง: สามารถเพิกเฉยต่ออีเมลฉบับนี้ได้
* หากไม่ใช่คุณ: โปรดรีบเปลี่ยนรหัสผ่านเซิร์ฟเวอร์ทันที
--------------------------------------------------
"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = recipient

    part1 = MIMEText(plain_text, "plain", "utf-8")
    part2 = MIMEText(html_content, "html", "utf-8")
    msg.attach(part1)
    msg.attach(part2)

    try:
        if smtp_port == 465:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=12)
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=12)
            if use_tls:
                server.starttls()
        server.login(sender_email, sender_password)
        server.send_message(msg)
        server.quit()
        print(f"[Security] Alert email sent successfully to {recipient} for device '{device_name}'")
        return True, "ส่งอีเมลแจ้งเตือนสำเร็จ"
    except Exception as e:
        err_msg = f"ไม่สามารถส่งอีเมลได้ ({e})"
        print(f"[Security] Failed to send email to {recipient}: {e}")
        return False, err_msg

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
        # Try IPv4 ping first (-4, 2 packets, 2s deadline) to smooth out jitter
        cmd = ["ping", "-4", "-c", "2", "-W", "2", host]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=4)
        if res.returncode == 0:
            m = re.search(r"rtt [^=]+=\s*[\d\.]+/([\d\.]+)/", res.stdout)
            if m:
                return round(float(m.group(1)), 1)
            m = re.search(r"time=([\d\.]+)\s*ms", res.stdout)
            if m:
                return round(float(m.group(1)), 1)

        # Fallback to single packet IPv4
        cmd = ["ping", "-4", "-c", "1", "-W", "2", host]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
        if res.returncode == 0:
            m = re.search(r"time=([\d\.]+)\s*ms", res.stdout)
            if m:
                return round(float(m.group(1)), 1)

        # Fallback to standard ping ONLY for non-Playit hosts (Playit IPv6 routes to US at 220ms)
        if "ply.gg" not in host.lower():
            cmd = ["ping", "-c", "1", "-W", "2", host]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
            if res.returncode == 0:
                m = re.search(r"time=([\d\.]+)\s*ms", res.stdout)
                if m:
                    return round(float(m.group(1)), 1)
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

# ==============================================================================
# Wake-on-LAN (WOL) Management
# ==============================================================================

def format_mac(mac):
    """Normalize MAC address into standard AA:BB:CC:DD:EE:FF format"""
    cleaned = re.sub(r"[^0-9a-fA-F]", "", str(mac))
    if len(cleaned) == 12:
        return ":".join(cleaned[i:i+2] for i in range(0, 12, 2)).upper()
    return str(mac).upper()

def send_wol_magic_packet(mac_address, broadcast_ip="192.168.1.255", port=9):
    """
    Send Wake-on-LAN magic packet to target MAC address via UDP broadcast.
    Magic packet structure: 6 bytes of 0xFF followed by MAC address repeated 16 times (102 bytes total).
    Sends multiple UDP packets across target broadcast subnet and global broadcast (ports 9 & 7).
    """
    cleaned_mac = re.sub(r"[^0-9a-fA-F]", "", str(mac_address))
    if len(cleaned_mac) != 12:
        raise ValueError(f"รูปแบบ MAC Address ไม่ถูกต้อง: '{mac_address}' (ต้องเป็นเลขฐาน 16 จำนวน 12 หลัก)")

    mac_bytes = bytes.fromhex(cleaned_mac)
    magic_packet = b"\xff" * 6 + mac_bytes * 16

    destinations = []
    # 1. Target Subnet broadcast (e.g., 192.168.1.255)
    if broadcast_ip:
        destinations.append((broadcast_ip, port))
        destinations.append((broadcast_ip, 7 if port == 9 else 9))
    # 2. Global broadcast fallback
    destinations.append(("255.255.255.255", port))
    destinations.append(("255.255.255.255", 7 if port == 9 else 9))

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    try:
        # Transmit 3 burst packets with 50ms interval to ensure arrival
        for _ in range(3):
            for dest_ip, dest_port in destinations:
                try:
                    sock.sendto(magic_packet, (dest_ip, dest_port))
                except Exception:
                    pass
            time.sleep(0.05)
    finally:
        sock.close()
    return True

def find_ip_by_mac(target_mac, default_ip=None):
    """
    Auto-detect current IPv4 address from ARP / Neighbor cache using target MAC address.
    Gracefully handles dynamic DHCP IP changes without requiring manual reconfiguration.
    """
    if not target_mac:
        return default_ip
    clean_target = re.sub(r"[^0-9a-fA-F]", "", str(target_mac)).lower()
    if len(clean_target) != 12:
        return default_ip

    candidates = []

    # 1. Query `ip -4 neigh show` which tracks REACHABLE / STALE / FAILED states
    try:
        res = subprocess.run(["ip", "-4", "neigh", "show"], capture_output=True, text=True, timeout=1.5)
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                parts = line.strip().split()
                if len(parts) >= 5 and "lladdr" in parts:
                    idx = parts.index("lladdr")
                    if idx + 1 < len(parts):
                        ip = parts[0]
                        mac = parts[idx + 1]
                        state = parts[idx + 2] if idx + 2 < len(parts) else ""
                        if re.sub(r"[^0-9a-fA-F]", "", mac).lower() == clean_target and state != "FAILED":
                            if state == "REACHABLE":
                                candidates.insert(0, ip)
                            else:
                                candidates.append(ip)
    except Exception:
        pass

    # 2. Check /proc/net/arp as secondary fallback
    if not candidates:
        try:
            if os.path.exists("/proc/net/arp"):
                with open("/proc/net/arp", "r", encoding="utf-8", errors="ignore") as f:
                    for line in f.readlines()[1:]:
                        parts = line.split()
                        if len(parts) >= 4:
                            ip, _, flags, mac = parts[0], parts[1], parts[2], parts[3]
                            if re.sub(r"[^0-9a-fA-F]", "", mac).lower() == clean_target and flags == "0x2":
                                candidates.append(ip)
        except Exception:
            pass

    # 3. If default_ip is among candidates and responds, keep it
    if default_ip and default_ip in candidates:
        if measure_host_ping(default_ip) is not None:
            return default_ip

    # 4. Probe candidates to verify which one responds to ICMP ping
    for ip in candidates:
        if measure_host_ping(ip) is not None:
            return ip

    return candidates[0] if candidates else default_ip

def _delayed_ping_check(ip, mac=None):
    """Periodically ping target IP after WOL to detect when the PC finishes booting"""
    target_ip = ip
    for interval in [4, 4, 5, 5, 6, 8, 10]:
        time.sleep(interval)
        if mac:
            resolved = find_ip_by_mac(mac, target_ip)
            if resolved:
                target_ip = resolved
        if not target_ip:
            continue
        ms = measure_host_ping(target_ip)
        with _ping_lock:
            if ms is not None:
                status = "good" if ms < 60 else ("fair" if ms < 130 else "high")
                _ping_cache[target_ip] = {"ms": ms, "status": status, "updated": time.time()}
                break
            else:
                _ping_cache[target_ip] = {"ms": None, "status": "offline", "updated": time.time()}

def get_wol_devices():
    """Retrieve list of configured Wake-on-LAN devices with real-time MAC resolution and ping status"""
    cfg = load_config()
    wol_cfg = cfg.get("wol", {})
    devices = wol_cfg.get("devices", [])

    if not devices:
        devices = [
            {
                "id": "pc",
                "name": "PC ของฉัน (Gaming PC)",
                "mac": "D8-5E-D3-49-AF-47",
                "ip": "192.168.1.107",
                "broadcast": "192.168.1.255",
                "port": 9,
                "description": "Windows Gaming / Main PC"
            }
        ]

    result = []
    config_updated = False
    for dev in devices:
        mac = dev.get("mac", "")
        configured_ip = dev.get("ip", "")

        # Dynamically auto-resolve active IP from MAC via ARP/neighbor cache
        live_ip = find_ip_by_mac(mac, configured_ip) if mac else configured_ip
        ip = live_ip or configured_ip

        # If a live IP was discovered and differs from config, keep config in sync
        if live_ip and configured_ip != live_ip:
            dev["ip"] = live_ip
            config_updated = True

        ping_info = None
        is_online = False
        if ip:
            ping_info = get_cached_ping(ip)
            if ping_info and ping_info.get("status") in ("good", "fair", "high"):
                is_online = True

        web_port = dev.get("web_port", 8080)
        web_url = dev.get("web_url")
        if not web_url and ip and ip != "-":
            web_url = f"http://{ip}:{web_port}" if web_port else f"http://{ip}"

        result.append({
            **dev,
            "ip": ip,
            "mac_formatted": format_mac(mac),
            "web_port": web_port,
            "web_url": web_url,
            "is_online": is_online,
            "ping": ping_info
        })

    if config_updated:
        try:
            cfg["wol"]["devices"] = devices
            save_config(cfg)
        except Exception:
            pass

    return result

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
                "wol": get_wol_devices(),
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

        elif path == "/api/wol/devices":
            self.send_json({"devices": get_wol_devices()})
            return

        elif path == "/api/security/history":
            with _security_lock:
                history = load_login_history()
                devices_dict = load_known_devices()
                devices = list(devices_dict.values())
                devices.sort(key=lambda d: d.get("last_login", 0), reverse=True)

            cfg = load_config()
            notif = cfg.get("notification", {})
            email_cfg = notif.get("email", {})
            has_password = bool(email_cfg.get("sender_password", "").strip())
            safe_email_cfg = {
                "enabled": notif.get("enabled", True),
                "recipient": email_cfg.get("recipient", "bioheart.kalel@gmail.com"),
                "sender_email": email_cfg.get("sender_email", "bioheart.kalel@gmail.com"),
                "has_password": has_password,
                "smtp_host": email_cfg.get("smtp_host", "smtp.gmail.com"),
                "smtp_port": email_cfg.get("smtp_port", 587)
            }

            self.send_json({
                "history": history,
                "devices": devices,
                "config": safe_email_cfg
            })
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
            client_device_id = str(payload.get("device_id", "")).strip()
            client_device_name = str(payload.get("device_name", "")).strip()

            if not client_device_id:
                client_device_id = get_cookie_value(self, "dashboard_device_id") or ""
            if not client_device_id:
                client_device_id = "dev_" + secrets.token_hex(8)

            client_ip = get_client_ip(self)
            client_mac = get_mac_for_ip(client_ip)
            ua_str = self.headers.get("User-Agent", "")
            ua_info = parse_user_agent(ua_str)
            geo_info = get_geo_location(client_ip)

            device_name = client_device_name or ua_info["summary"]

            if not username or not password:
                self.send_json({"error": "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน"}, 400)
                return

            cfg = load_config()
            auth_cfg = cfg.get("auth", {})
            allowed = auth_cfg.get("allowed_users", ["bioheart", "root"])

            # Check if username allowed
            if allowed and username not in allowed:
                time.sleep(0.5)
                record_login_attempt(username, False, client_ip, client_mac, client_device_id, device_name, ua_str, geo_info, "ชื่อผู้ใช้ไม่มีสิทธิ์เข้าใช้งาน")
                self.send_json({"error": f"ชื่อผู้ใช้ '{username}' ไม่มีสิทธิ์เข้าใช้งานระบบ"}, 403)
                return

            # Verify password against Linux OS
            if not verify_linux_password(username, password):
                time.sleep(0.5)
                record_login_attempt(username, False, client_ip, client_mac, client_device_id, device_name, ua_str, geo_info, "รหัสผ่านไม่ถูกต้อง")
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

            now_ts = time.time()
            time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            is_new_device = False

            with _security_lock:
                known_devices = load_known_devices()
                if client_device_id not in known_devices:
                    is_new_device = True
                    known_devices[client_device_id] = {
                        "device_id": client_device_id,
                        "device_name": device_name,
                        "first_login": now_ts,
                        "first_login_str": time_str,
                        "last_login": now_ts,
                        "last_login_str": time_str,
                        "last_ip": client_ip,
                        "last_mac": client_mac,
                        "country": geo_info["country"],
                        "city": geo_info["city"],
                        "username": username,
                        "ua_summary": ua_info["summary"]
                    }
                    save_known_devices(known_devices)
                else:
                    known_devices[client_device_id]["last_login"] = now_ts
                    known_devices[client_device_id]["last_login_str"] = time_str
                    known_devices[client_device_id]["last_ip"] = client_ip
                    known_devices[client_device_id]["last_mac"] = client_mac
                    known_devices[client_device_id]["country"] = geo_info["country"]
                    known_devices[client_device_id]["city"] = geo_info["city"]
                    if client_device_name:
                        known_devices[client_device_id]["device_name"] = client_device_name
                    save_known_devices(known_devices)

            login_record = {
                "id": f"log_{secrets.token_hex(6)}",
                "timestamp": now_ts,
                "time_str": time_str,
                "username": username,
                "status": "success",
                "device_id": client_device_id,
                "device_name": device_name,
                "ip": client_ip,
                "mac": client_mac,
                "country": geo_info["country"],
                "city": geo_info["city"],
                "is_new_device": is_new_device,
                "ua_summary": ua_info["summary"],
                "user_agent": ua_str
            }

            with _security_lock:
                history = load_login_history()
                history.insert(0, login_record)
                save_login_history(history)

            if is_new_device:
                threading.Thread(target=send_security_alert_email, args=(login_record, False), daemon=True).start()

            resp_data = {
                "success": True,
                "username": username,
                "token": token,
                "device_id": client_device_id,
                "is_new_device": is_new_device
            }
            body = json.dumps(resp_data, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            cookie_val = f"session_token={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={ttl_seconds}"
            self.send_header("Set-Cookie", cookie_val)
            device_cookie = f"dashboard_device_id={client_device_id}; Path=/; Max-Age=31536000; SameSite=Lax"
            self.send_header("Set-Cookie", device_cookie)
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

        elif path == "/api/wol/wake":
            device_id = payload.get("id", "").strip()
            cfg = load_config()
            wol_devices = cfg.get("wol", {}).get("devices", [])

            target = None
            if device_id:
                for d in wol_devices:
                    if d.get("id") == device_id:
                        target = d
                        break

            # Fallback if device not found by ID: use first configured device or payload params
            mac = payload.get("mac") or (target.get("mac") if target else None)
            ip = payload.get("ip") or (target.get("ip") if target else None)
            broadcast = payload.get("broadcast") or (target.get("broadcast") if target else "192.168.1.255")
            port = int(payload.get("port") or (target.get("port") if target else 9))
            name = (target.get("name") if target else None) or payload.get("name") or "PC"

            if not mac:
                if wol_devices:
                    target = wol_devices[0]
                    mac = target.get("mac")
                    ip = target.get("ip")
                    broadcast = target.get("broadcast", "192.168.1.255")
                    name = target.get("name", "PC")
                else:
                    mac = "D8-5E-D3-49-AF-47"
                    ip = "192.168.1.107"
                    broadcast = "192.168.1.255"

            # Auto-resolve live IP by MAC if available
            if mac:
                live_ip = find_ip_by_mac(mac, ip)
                if live_ip:
                    ip = live_ip

            try:
                send_wol_magic_packet(mac, broadcast_ip=broadcast, port=port)
                formatted_mac = format_mac(mac)

                # Register host for ping checks and start delayed boot monitor
                if ip:
                    register_ping_host(ip)
                threading.Thread(target=_delayed_ping_check, args=(ip, mac), daemon=True).start()

                self.send_json({
                    "success": True,
                    "message": f"ส่งสัญญาณ Wake-on-LAN ไปยัง {name} ({formatted_mac}) เรียบร้อยแล้ว",
                    "mac": formatted_mac,
                    "ip": ip,
                    "timestamp": time.time()
                })
            except Exception as e:
                self.send_json({"error": str(e)}, 400)
            return

        elif path == "/api/wol/ping":
            ip = payload.get("ip", "").strip()
            mac = payload.get("mac", "").strip()
            device_id = payload.get("device_id", "").strip()

            devices = get_wol_devices()
            target_dev = None
            if device_id:
                target_dev = next((d for d in devices if d.get("id") == device_id), None)
            elif mac:
                clean_m = re.sub(r"[^0-9a-fA-F]", "", mac).lower()
                target_dev = next((d for d in devices if re.sub(r"[^0-9a-fA-F]", "", d.get("mac", "")).lower() == clean_m), None)

            if target_dev:
                mac = target_dev.get("mac", mac)
                configured_ip = target_dev.get("ip", ip)
                resolved = find_ip_by_mac(mac, configured_ip)
                ip = resolved or configured_ip
            elif mac and not ip:
                ip = find_ip_by_mac(mac, "")
            elif not ip and devices:
                ip = devices[0].get("ip", "")

            if not ip:
                self.send_json({"error": "IP address required"}, 400)
                return

            ms = measure_host_ping(ip)
            with _ping_lock:
                if ms is not None:
                    status = "good" if ms < 60 else ("fair" if ms < 130 else "high")
                    _ping_cache[ip] = {"ms": ms, "status": status, "updated": time.time()}
                else:
                    _ping_cache[ip] = {"ms": None, "status": "offline", "updated": time.time()}

            self.send_json({
                "ip": ip,
                "ms": ms,
                "is_online": (ms is not None),
                "status": _ping_cache[ip]["status"]
            })
            return

        elif path == "/api/wol/edit":
            cfg = load_config()
            wol_cfg = cfg.setdefault("wol", {"enabled": True, "devices": []})
            devices = wol_cfg.setdefault("devices", [])

            dev_id = payload.get("id", "pc").strip()
            name = payload.get("name", "").strip()
            mac = payload.get("mac", "").strip()
            ip = payload.get("ip", "").strip()
            broadcast = payload.get("broadcast", "192.168.1.255").strip()
            port = payload.get("port", 9)
            description = payload.get("description", "").strip()
            web_port = payload.get("web_port", 8080)
            try:
                web_port = int(web_port) if web_port else 8080
            except Exception:
                web_port = 8080
            web_url = payload.get("web_url", "").strip()

            if mac:
                cleaned_mac = re.sub(r"[^0-9a-fA-F]", "", mac)
                if len(cleaned_mac) != 12:
                    self.send_json({"error": "MAC Address ไม่ถูกต้อง (ต้องเป็นเลขฐาน 16 จำนวน 12 หลัก)"}, 400)
                    return
                mac = format_mac(cleaned_mac)

            found = False
            for dev in devices:
                if dev.get("id") == dev_id:
                    if name: dev["name"] = name
                    if mac: dev["mac"] = mac
                    if ip: dev["ip"] = ip
                    if broadcast: dev["broadcast"] = broadcast
                    if port: dev["port"] = int(port)
                    if description is not None: dev["description"] = description
                    dev["web_port"] = web_port
                    if web_url:
                        dev["web_url"] = web_url
                    elif "web_url" in dev and not web_url:
                        dev.pop("web_url", None)
                    found = True
                    break

            if not found:
                new_dev = {
                    "id": dev_id,
                    "name": name or "PC ของฉัน (Gaming PC)",
                    "mac": mac or "D8-5E-D3-49-AF-47",
                    "ip": ip or "192.168.1.163",
                    "broadcast": broadcast or "192.168.1.255",
                    "port": int(port) if port else 9,
                    "description": description or "Windows Gaming / Main PC",
                    "web_port": web_port
                }
                if web_url:
                    new_dev["web_url"] = web_url
                devices.append(new_dev)

            if save_config(cfg):
                self.send_json({"success": True, "devices": get_wol_devices()})
            else:
                self.send_json({"error": "Failed to save configuration"}, 500)
            return

        elif path == "/api/security/test-email":
            cfg = load_config()
            notif = cfg.get("notification", {})
            email_cfg = notif.get("email", {})
            pwd = email_cfg.get("sender_password", "").strip()
            if not pwd:
                self.send_json({
                    "success": False,
                    "error": "ยังไม่ได้ระบุรหัสผ่านส่งอีเมล (Gmail App Password) ในการตั้งค่า กรุณากรอกรหัสผ่าน 16 หลักก่อนทดสอบ"
                }, 400)
                return

            client_ip = get_client_ip(self)
            client_mac = get_mac_for_ip(client_ip)
            ua_str = self.headers.get("User-Agent", "")
            ua_info = parse_user_agent(ua_str)
            geo_info = get_geo_location(client_ip)

            test_record = {
                "username": user,
                "device_name": f"{ua_info['summary']} (Test Run)",
                "ip": client_ip,
                "mac": client_mac,
                "country": geo_info["country"],
                "city": geo_info["city"],
                "ua_summary": ua_info["summary"],
                "time_str": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "is_new_device": True
            }

            success, msg = send_security_alert_email(test_record, is_test=True)
            if success:
                self.send_json({"success": True, "message": f"ส่งอีเมลทดสอบไปยัง {email_cfg.get('recipient')} สำเร็จแล้ว!"})
            else:
                self.send_json({"success": False, "error": msg}, 500)
            return

        elif path == "/api/security/config":
            recipient = payload.get("recipient", "").strip()
            sender_email = payload.get("sender_email", "").strip()
            sender_password = payload.get("sender_password", "")
            enabled = payload.get("enabled", True)

            cfg = load_config()
            notif = cfg.setdefault("notification", {})
            email_cfg = notif.setdefault("email", {})

            if recipient:
                email_cfg["recipient"] = recipient
            if sender_email:
                email_cfg["sender_email"] = sender_email
            if sender_password is not None and sender_password.strip() != "":
                # Remove spaces if user copied like "xxxx xxxx xxxx xxxx"
                email_cfg["sender_password"] = sender_password.strip().replace(" ", "")
            notif["enabled"] = bool(enabled)

            if save_config(cfg):
                self.send_json({"success": True, "message": "บันทึกการตั้งค่าการแจ้งเตือนเรียบร้อยแล้ว"})
            else:
                self.send_json({"error": "Failed to save configuration"}, 500)
            return

        elif path == "/api/security/devices/delete":
            dev_id = payload.get("device_id", "").strip()
            if not dev_id:
                self.send_json({"error": "Device ID is required"}, 400)
                return

            with _security_lock:
                devices = load_known_devices()
                if dev_id in devices:
                    del devices[dev_id]
                    save_known_devices(devices)
                    self.send_json({"success": True, "message": "ลบอุปกรณ์ออกจากรายการอุปกรณ์ที่เชื่อถือแล้ว"})
                else:
                    self.send_json({"error": "Device not found"}, 404)
            return

        elif path == "/api/security/clear-history":
            with _security_lock:
                save_login_history([])
            self.send_json({"success": True, "message": "ล้างประวัติการเข้าสู่ระบบเรียบร้อยแล้ว"})
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
