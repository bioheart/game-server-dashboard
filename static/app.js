/**
 * Game Server Dashboard Frontend Logic
 */

let currentFilter = 'all';
let currentGamesData = [];
let latestPlayitDetails = null;
let hostIp = '127.0.0.1';
let pollTimer = null;
let pollIntervalMs = 4000;
let activeLogService = null;
let logPollTimer = null;
let currentWolDevices = [];
let wakingDevices = {};

// Icons dictionary
const ICONS = {
  sword: `<svg class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.828 2.828a2 2 0 01-2.828 0L3 13.586a2 2 0 010-2.828l2.828-2.828a2 2 0 012.828 0L12 11.293m0 0l2.828-2.828a2 2 0 012.828 0L20.414 11.293a2 2 0 010 2.828l-2.828 2.828a2 2 0 01-2.828 0L12 14.121z"/></svg>`,
  cube: `<svg class="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>`,
  shield: `<svg class="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>`,
  network: `<svg class="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>`,
  gamepad: `<svg class="w-6 h-6 text-purple-400" fill="currentColor" viewBox="0 0 24 24"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>`
};

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupAuthEventListeners();
  setupWolEventListeners();
  setupSecurityEventListeners();
  checkAuth();
});

// Device Identification Helpers
function getOrCreateDeviceId() {
  let id = localStorage.getItem('dashboard_device_id');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    localStorage.setItem('dashboard_device_id', id);
  }
  return id;
}

function getClientDeviceInfo() {
  const ua = navigator.userAgent || '';
  let os = 'Unknown OS';
  if (/Windows NT 10.0|Windows NT 11.0/i.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/iPhone/i.test(ua)) os = 'iPhone (iOS)';
  else if (/iPad/i.test(ua)) os = 'iPad (iPadOS)';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Google Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Mozilla Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Apple Safari';
  else if (/Opera|OPR\//i.test(ua)) browser = 'Opera';

  const isMobile = /Mobi|Android|iPhone/i.test(ua);
  const typeStr = isMobile ? 'Mobile' : 'Desktop';

  return {
    os,
    browser,
    type: typeStr,
    name: `${os} • ${browser} (${typeStr})`
  };
}

// ==============================================================================
// Authentication & Session Handlers
// ==============================================================================
function setupAuthEventListeners() {
  // Login form submission
  const loginForm = document.getElementById('form-login');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameInput = document.getElementById('login-username');
      const passwordInput = document.getElementById('login-password');
      const errorAlert = document.getElementById('login-error-alert');
      const errorText = document.getElementById('login-error-text');
      const submitBtn = document.getElementById('btn-login-submit');
      const btnText = document.getElementById('btn-login-text');
      const spinner = document.getElementById('btn-login-spinner');

      const username = usernameInput ? usernameInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';

      if (!username || !password) return;

      submitBtn.disabled = true;
      btnText.textContent = 'กำลังตรวจสอบ...';
      spinner.classList.remove('hidden');
      errorAlert.classList.add('hidden');

      const devId = getOrCreateDeviceId();
      const devInfo = getClientDeviceInfo();

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            password,
            device_id: devId,
            device_name: devInfo.name
          })
        });
        const data = await res.json();

        if (res.ok && data.success) {
          showToast(`เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ${data.username}`, 'success');
          if (data.is_new_device) {
            showToast('🔔 บันทึกอุปกรณ์นี้ในระบบแล้ว และส่งการแจ้งเตือนทาง Email ให้เรียบร้อย', 'info');
          }
          showDashboard(data.username);
        } else {
          errorText.textContent = data.error || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
          errorAlert.classList.remove('hidden');
          if (passwordInput) passwordInput.focus();
        }
      } catch (err) {
        errorText.textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
        errorAlert.classList.remove('hidden');
      } finally {
        submitBtn.disabled = false;
        btnText.textContent = 'เข้าสู่ระบบ';
        spinner.classList.add('hidden');
      }
    });
  }

  // Toggle password visibility
  const btnToggle = document.getElementById('btn-toggle-password');
  const passInput = document.getElementById('login-password');
  if (btnToggle && passInput) {
    btnToggle.addEventListener('click', () => {
      const isPass = passInput.type === 'password';
      passInput.type = isPass ? 'text' : 'password';
      btnToggle.classList.toggle('text-indigo-400', isPass);
    });
  }

  // Logout button (Desktop & Mobile)
  const logoutHandler = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {}
    showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
    showLoginView();
  };

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', logoutHandler);

  const btnLogoutMobile = document.getElementById('btn-logout-mobile');
  if (btnLogoutMobile) btnLogoutMobile.addEventListener('click', logoutHandler);
}

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated) {
        showDashboard(data.username);
        return;
      }
    }
  } catch (err) {
    console.warn('Could not check auth status:', err);
  }
  showLoginView();
}

function showDashboard(username) {
  const loginView = document.getElementById('login-view');
  const dashboardView = document.getElementById('dashboard-view');
  const userElem = document.getElementById('auth-username');
  const userElemMobile = document.getElementById('auth-username-mobile');

  if (loginView) {
    loginView.classList.add('hidden');
    loginView.classList.remove('flex');
  }
  if (dashboardView) {
    dashboardView.classList.remove('hidden');
  }
  if (username) {
    if (userElem) userElem.textContent = username;
    if (userElemMobile) userElemMobile.textContent = username;
  }
  fetchStatus();
  startPolling();
}

function showLoginView() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const loginView = document.getElementById('login-view');
  const dashboardView = document.getElementById('dashboard-view');
  const passInput = document.getElementById('login-password');
  const errorAlert = document.getElementById('login-error-alert');

  if (dashboardView) {
    dashboardView.classList.add('hidden');
  }
  if (loginView) {
    loginView.classList.remove('hidden');
    loginView.classList.add('flex');
  }
  if (errorAlert) {
    errorAlert.classList.add('hidden');
  }
  if (passInput) {
    passInput.value = '';
    setTimeout(() => passInput.focus(), 80);
  }
}

function setupEventListeners() {
  // Manual refresh
  document.getElementById('btn-refresh').addEventListener('click', () => {
    fetchStatus();
    showToast('รีเฟรชข้อมูลแล้ว', 'info');
  });

  // Polling selector
  document.getElementById('refresh-interval-select').addEventListener('change', (e) => {
    pollIntervalMs = parseInt(e.target.value);
    startPolling();
  });

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('active', 'text-white', 'bg-indigo-600/30', 'border', 'border-indigo-500/30');
        b.classList.add('text-slate-400');
      });
      btn.classList.add('active', 'text-white', 'bg-indigo-600/30', 'border', 'border-indigo-500/30');
      btn.classList.remove('text-slate-400');
      currentFilter = btn.dataset.filter;
      renderGames(currentGamesData);
    });
  });

  // Add Game modal
  const modalAdd = document.getElementById('modal-add-game');
  document.getElementById('btn-add-game').addEventListener('click', () => {
    modalAdd.classList.remove('hidden');
    modalAdd.classList.add('flex');
    document.getElementById('add-game-name').focus();
  });
  document.getElementById('btn-close-add').addEventListener('click', () => {
    modalAdd.classList.add('hidden');
    modalAdd.classList.remove('flex');
  });
  document.getElementById('btn-cancel-add').addEventListener('click', () => {
    modalAdd.classList.add('hidden');
    modalAdd.classList.remove('flex');
  });

  // Add Game form submit
  document.getElementById('form-add-game').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('add-game-name').value.trim();
    const service = document.getElementById('add-game-service').value.trim();
    const port = document.getElementById('add-game-port').value.trim();
    const protocol = document.getElementById('add-game-protocol').value;
    const desc = document.getElementById('add-game-desc').value.trim();
    const icon = document.getElementById('add-game-icon').value;

    try {
      const res = await fetch('/api/games/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, service, port: port ? parseInt(port) : null, protocol, description: desc, icon })
      });
      if (res.status === 401) {
        showLoginView();
        showToast('กรุณาเข้าสู่ระบบก่อนดำเนินการ', 'warning');
        return;
      }
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`เพิ่ม "${name}" สำเร็จ`, 'success');
        modalAdd.classList.add('hidden');
        modalAdd.classList.remove('flex');
        document.getElementById('form-add-game').reset();
        fetchStatus();
      } else {
        showToast(data.error || 'ไม่สามารถเพิ่มเกมได้', 'error');
      }
    } catch (err) {
      showToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    }
  });

  // Detect service button
  document.getElementById('btn-detect-service').addEventListener('click', async () => {
    const feedback = document.getElementById('add-service-feedback');
    feedback.textContent = 'กำลังตรวจสอบ services ในระบบ...';
    try {
      const res = await fetch('/api/detect-services');
      const data = await res.json();
      const input = document.getElementById('add-game-service').value.trim();
      if (input) {
        const found = data.candidates && data.candidates.some(c => c.toLowerCase() === input.toLowerCase());
        if (found) {
          feedback.innerHTML = `<span class="text-emerald-400">✓ พบ service "${input}" ในระบบ systemd</span>`;
        } else {
          feedback.innerHTML = `<span class="text-amber-400">⚠️ ยังไม่พบ "${input}.service" ในระบบ (สามารถเพิ่มไว้ก่อนได้)</span>`;
        }
      } else {
        feedback.textContent = `พบ ${data.candidates.length} services ในระบบ`;
      }
    } catch (e) {
      feedback.textContent = 'ไม่สามารถดึงข้อมูล service ได้';
    }
  });

  // Log modal close
  const modalLogs = document.getElementById('modal-logs');
  document.getElementById('btn-close-logs').addEventListener('click', closeLogModal);
  modalLogs.addEventListener('click', (e) => {
    if (e.target === modalLogs) closeLogModal();
  });

  // Log refresh button
  document.getElementById('btn-refresh-logs').addEventListener('click', () => {
    if (activeLogService) fetchLogs(activeLogService);
  });

  // Log copy button
  const btnCopyLogs = document.getElementById('btn-copy-logs');
  if (btnCopyLogs) {
    btnCopyLogs.addEventListener('click', (e) => {
      const content = document.getElementById('log-modal-content').innerText;
      copyToClipboard(content, e.currentTarget, 'คัดลอก Logs ลง Clipboard แล้ว');
    });
  }

  // Header IP copy button
  const btnCopyHeaderIp = document.getElementById('btn-copy-header-ip');
  if (btnCopyHeaderIp) {
    btnCopyHeaderIp.addEventListener('click', (e) => {
      const ip = document.getElementById('header-ip').textContent.trim();
      copyToClipboard(ip, e.currentTarget, `คัดลอก IP เครื่อง "${ip}" แล้ว`);
    });
  }

  // Playit modal close
  const modalPlayit = document.getElementById('modal-playit');
  document.getElementById('btn-close-playit').addEventListener('click', closePlayitModal);
  modalPlayit.addEventListener('click', (e) => {
    if (e.target === modalPlayit) closePlayitModal();
  });
  document.getElementById('btn-playit-logs-shortcut').addEventListener('click', () => {
    closePlayitModal();
    openLogModal('playit', 'Playit.gg');
  });

  // Confirm modal cancel
  const modalConfirm = document.getElementById('modal-confirm');
  document.getElementById('btn-cancel-confirm').addEventListener('click', () => {
    modalConfirm.classList.add('hidden');
    modalConfirm.classList.remove('flex');
  });
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (pollIntervalMs > 0) {
    pollTimer = setInterval(fetchStatus, pollIntervalMs);
  }
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.status === 401) {
      showLoginView();
      return;
    }
    if (!res.ok) throw new Error('API response not ok');
    const data = await res.json();
    
    // Update Host info
    updateHostMetrics(data.system);
    
    // Save playit info
    latestPlayitDetails = data.playit || null;

    // Update Games list
    currentGamesData = data.games || [];
    renderGames(currentGamesData);

    // Update Wake-on-LAN Devices
    if (data.wol) {
      currentWolDevices = data.wol;
      renderWolDevices(currentWolDevices);
    }

  } catch (err) {
    console.error('Failed to fetch status:', err);
  }
}

function updateHostMetrics(sys) {
  if (!sys) return;
  hostIp = sys.host_ip || hostIp;
  document.getElementById('header-hostname').textContent = sys.hostname || 'VM 102 (game-server)';
  document.getElementById('header-ip').textContent = hostIp;

  // CPU
  document.getElementById('metric-cpu-text').textContent = `${sys.cpu_percent}%`;
  document.getElementById('metric-cpu-bar').style.width = `${Math.min(100, sys.cpu_percent)}%`;

  // RAM
  document.getElementById('metric-ram-text').textContent = `${sys.ram_used_mb} MB`;
  document.getElementById('metric-ram-bar').style.width = `${Math.min(100, sys.ram_percent)}%`;
  document.getElementById('metric-ram-sub').textContent = `${sys.ram_used_mb} / ${sys.ram_total_mb} MB (${sys.ram_percent}%)`;

  // Disk
  document.getElementById('metric-disk-text').textContent = `${sys.disk_used_gb} GB`;
  document.getElementById('metric-disk-bar').style.width = `${Math.min(100, sys.disk_percent)}%`;
  document.getElementById('metric-disk-sub').textContent = `${sys.disk_used_gb} / ${sys.disk_total_gb} GB (${sys.disk_percent}%)`;

  // Uptime
  document.getElementById('metric-uptime').textContent = sys.uptime || '-';
}

function renderGames(games) {
  const container = document.getElementById('games-grid');
  
  // Update counts
  const total = games.length;
  const onlineCount = games.filter(g => g.is_active).length;
  const offlineCount = total - onlineCount;

  document.getElementById('total-badge').textContent = `${total} รายการ`;
  document.getElementById('count-online').textContent = onlineCount;
  document.getElementById('count-offline').textContent = offlineCount;

  // Filter
  let filtered = games;
  if (currentFilter === 'active') {
    filtered = games.filter(g => g.is_active);
  } else if (currentFilter === 'inactive') {
    filtered = games.filter(g => !g.is_active);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center bg-slate-900/40 border border-slate-800/80 rounded-2xl">
        <svg class="w-12 h-12 text-slate-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
        <p class="text-slate-400 font-medium">ไม่พบ Game Server ในหมวดหมู่นี้</p>
        <p class="text-xs text-slate-500 mt-1">คลิกปุ่ม "เพิ่มเกมใหม่" ด้านบนเพื่อเริ่มติดตาม server</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(game => createGameCardHTML(game)).join('');
}

function createGameCardHTML(game) {
  const isActive = game.is_active;
  const isFailed = game.status === 'failed';
  const isTransitioning = game.status === 'activating' || game.status === 'deactivating';
  const iconSvg = ICONS[game.icon] || ICONS.gamepad;
  const isPlayit = (game.service === 'playit' || game.category === 'tunnel');

  // Status Badge
  let badgeColor = 'bg-slate-800 text-slate-400 border-slate-700';
  let badgeDot = 'bg-slate-500';
  let statusText = 'Offline';

  if (isActive) {
    badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    badgeDot = 'bg-emerald-400 pulse-emerald';
    statusText = 'Online';
  } else if (game.status === 'not-found') {
    badgeColor = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    badgeDot = 'bg-amber-400';
    statusText = 'No Service File';
  } else if (isFailed) {
    badgeColor = 'bg-rose-500/10 text-rose-400 border-rose-500/30';
    badgeDot = 'bg-rose-400';
    statusText = 'Failed';
  } else if (isTransitioning) {
    badgeColor = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    badgeDot = 'bg-amber-400 animate-spin';
    statusText = game.status;
  }

  // Connect string
  const connectAddr = game.port ? `${hostIp}:${game.port}` : null;

  // Player count data
  const players = game.players || { online: 0, max: 0, players: [] };
  const hasPlayers = isActive && players.online > 0;

  // Playit tunnels count
  const playitTunnels = game.playit_details?.tunnels || [];
  const playitTunnelCount = playitTunnels.length;

  // Tunnel Ping calculation
  const tunnelPing = isPlayit ? (playitTunnels.length > 0 ? playitTunnels[0].ping : null) : game.public_tunnel_ping;
  let pingText = '-';
  let pingColorClass = 'text-slate-500';
  let pingDot = '';

  if (isActive) {
    if (!tunnelPing) {
      if (isPlayit || game.public_tunnel) {
        pingText = '...';
        pingColorClass = 'text-slate-400 animate-pulse';
      } else {
        pingText = 'LAN';
        pingColorClass = 'text-slate-400';
      }
    } else if (tunnelPing.status === 'measuring') {
      pingText = '...';
      pingColorClass = 'text-slate-400 animate-pulse';
    } else if (tunnelPing.ms === null || tunnelPing.status === 'offline') {
      pingText = 'Timeout';
      pingColorClass = 'text-rose-400';
      pingDot = 'bg-rose-500';
    } else {
      pingText = `${tunnelPing.ms} ms`;
      if (tunnelPing.ms < 60) {
        pingColorClass = 'text-emerald-400';
        pingDot = 'bg-emerald-400';
      } else if (tunnelPing.ms < 130) {
        pingColorClass = 'text-amber-400';
        pingDot = 'bg-amber-400';
      } else {
        pingColorClass = 'text-rose-400';
        pingDot = 'bg-rose-400';
      }
    }
  }

  return `
    <div class="game-card bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between backdrop-blur-sm relative group" data-service="${game.service}">
      
      <!-- Top Row: Icon, Title, Status Badge -->
      <div>
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center p-2.5 shadow-inner">
              ${iconSvg}
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-bold text-base text-white tracking-tight">${escapeHtml(game.name)}</h3>
                <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50">
                  ${escapeHtml(game.service)}
                </span>
              </div>
              <p class="text-xs text-slate-400 mt-0.5 line-clamp-1">${escapeHtml(game.description || 'ไม่มีคำอธิบาย')}</p>
            </div>
          </div>

          <!-- Status badge -->
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${badgeColor}">
              <span class="w-2 h-2 rounded-full ${badgeDot}"></span>
              ${statusText}
            </span>
          </div>
        </div>

        <!-- Metric badges inside card (6 columns) -->
        <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 py-3 border-y border-slate-800/80 my-3 text-xs">
          
          <!-- Memory -->
          <div class="bg-slate-950/40 rounded-lg p-2 border border-slate-800/40">
            <span class="text-[10px] text-slate-500 block uppercase font-semibold">RAM</span>
            <span class="font-mono font-bold text-white truncate block">${isActive ? (game.memory_mb ? `${game.memory_mb} MB` : '< 1 MB') : '-'}</span>
          </div>

          <!-- Port / Connect -->
          <div class="bg-slate-950/40 rounded-lg p-2 border border-slate-800/40">
            <span class="text-[10px] text-slate-500 block uppercase font-semibold">Port</span>
            <span class="font-mono font-bold ${game.port_listening ? 'text-emerald-400' : 'text-slate-300'} truncate block">
              ${game.port ? `${game.port}` : (isPlayit ? 'Agent' : 'None')}
            </span>
          </div>

          <!-- Players Online (active / full) -->
          <div class="bg-slate-950/40 rounded-lg p-2 border border-slate-800/40">
            <span class="text-[10px] text-slate-500 block uppercase font-semibold">ผู้เล่น (Slots)</span>
            <span class="font-mono font-bold ${hasPlayers ? 'text-emerald-400' : 'text-slate-300'} truncate block">
              ${isActive ? (isPlayit ? (game.playit_details?.stats?.active_udp ? `${game.playit_details.stats.active_udp} sess` : '0 sess') : `${players.online} / ${players.max || 10}`) : '-'}
            </span>
            ${(hasPlayers && players.players.length > 0) ? `
              <span class="text-[10px] text-emerald-400 truncate block mt-0.5" title="${players.players.join(', ')}">
                ${escapeHtml(players.players.join(', '))}
              </span>
            ` : ''}
          </div>

          <!-- Process PID -->
          <div class="bg-slate-950/40 rounded-lg p-2 border border-slate-800/40">
            <span class="text-[10px] text-slate-500 block uppercase font-semibold">PID</span>
            <span class="font-mono text-slate-300 font-medium truncate block">${game.pid > 0 ? game.pid : '-'}</span>
          </div>

          <!-- Uptime -->
          <div class="bg-slate-950/40 rounded-lg p-2 border border-slate-800/40">
            <span class="text-[10px] text-slate-500 block uppercase font-semibold">Uptime</span>
            <span class="font-mono text-slate-300 font-medium truncate block">${game.uptime_str || '-'}</span>
          </div>

          <!-- Ping (Edge Latency) -->
          <div class="bg-slate-950/40 rounded-lg p-2 border border-slate-800/40">
            <span class="text-[10px] text-slate-500 block uppercase font-semibold">Ping</span>
            <span class="font-mono font-bold ${pingColorClass} flex items-center gap-1.5 truncate">
              ${pingDot ? `<span class="w-1.5 h-1.5 rounded-full ${pingDot} shrink-0"></span>` : ''}
              <span>${pingText}</span>
            </span>
          </div>

        </div>

        <!-- SPECIAL PLAYIT CARD VIEW: Clean summary with modal trigger -->
        ${isPlayit ? `
          <div class="mb-3 space-y-2">
            <button onclick="openPlayitModal()" class="w-full py-2.5 px-3.5 rounded-xl bg-cyan-950/40 hover:bg-cyan-900/40 text-cyan-300 border border-cyan-500/30 text-xs font-semibold flex items-center justify-between transition group/btn">
              <span class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                <span>ดูรายละเอียด Tunnels & IP (${playitTunnelCount} Active)</span>
              </span>
              <span class="text-xs text-cyan-400 font-mono flex items-center gap-1 group-hover/btn:translate-x-0.5 transition-transform">
                คลิกดูข้อมูล ➔
              </span>
            </button>
          </div>
        ` : ''}

        <!-- Connection Address Bars (for game servers) -->
        ${(!isPlayit && (connectAddr || game.public_tunnel)) ? `
          <div class="space-y-1.5 mb-3 font-mono text-xs">
            ${game.public_tunnel ? `
              <!-- Playit Public Address (Internet / Friends) -->
              <div class="flex items-center justify-between bg-emerald-950/40 rounded-lg px-3 py-2 border border-emerald-500/30">
                <span class="text-emerald-400 font-semibold flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  Playit IP:
                </span>
                <div class="flex items-center gap-1.5 sm:gap-2">
                  <span class="text-emerald-300 font-bold select-all cursor-pointer hover:underline" onclick="copyToClipboard(this.innerText.trim(), this.nextElementSibling)" title="คลิกเพื่อคัดลอก">${escapeHtml(game.public_tunnel)}</span>
                  <button onclick="copyToClipboard(this.getAttribute('data-copy'), this)" data-copy="${escapeHtml(game.public_tunnel)}" title="คัดลอก Playit IP" class="text-emerald-400 hover:text-white p-1.5 rounded-md hover:bg-emerald-900/60 active:scale-90 transition flex items-center justify-center min-w-[28px] min-h-[28px] touch-manipulation cursor-pointer">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                  </button>
                </div>
              </div>
            ` : ''}

            ${connectAddr ? `
              <!-- Local LAN Address -->
              <div class="flex items-center justify-between bg-slate-950/60 rounded-lg px-3 py-1.5 border border-slate-800/60">
                <span class="text-slate-400 flex items-center gap-1.5">
                  <svg class="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
                  Local LAN:
                </span>
                <div class="flex items-center gap-1.5 sm:gap-2">
                  <span class="text-indigo-300 font-medium select-all cursor-pointer hover:underline" onclick="copyToClipboard(this.innerText.trim(), this.nextElementSibling)" title="คลิกเพื่อคัดลอก">${connectAddr}</span>
                  <button onclick="copyToClipboard(this.getAttribute('data-copy'), this)" data-copy="${escapeHtml(connectAddr)}" title="คัดลอก Local LAN Address" class="text-slate-400 hover:text-white p-1.5 rounded-md hover:bg-slate-800 active:scale-90 transition flex items-center justify-center min-w-[28px] min-h-[28px] touch-manipulation cursor-pointer">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                  </button>
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}

      </div>

      <!-- Action Buttons Row -->
      <div class="flex items-center justify-between gap-2 pt-2">
        <div class="flex items-center gap-2">
          <!-- Start / Stop Button (with Confirmation Modal) -->
          ${isActive ? `
            <button onclick="confirmAction('${game.service}', 'stop', '${escapeHtml(game.name)}')" class="btn-action flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold transition">
              <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clip-rule="evenodd"/></svg>
              ปิด (Stop)
            </button>
            <button onclick="confirmAction('${game.service}', 'restart', '${escapeHtml(game.name)}')" class="btn-action flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold transition">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
              รีสตาร์ท
            </button>
          ` : `
            <button onclick="confirmAction('${game.service}', 'start', '${escapeHtml(game.name)}')" class="btn-action flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/25 text-xs font-semibold transition">
              <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/></svg>
              เปิด (Start)
            </button>
          `}
        </div>

        <div class="flex items-center gap-1.5">
          <!-- View Logs Button -->
          <button onclick="openLogModal('${game.service}', '${escapeHtml(game.name)}')" title="ดู Logs" class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 text-xs font-mono transition">
            <svg class="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            Logs
          </button>

          <!-- Remove Game Button -->
          <button onclick="confirmDeleteGame('${game.id}', '${escapeHtml(game.name)}')" title="นำออกจาก Dashboard" class="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>

      </div>

    </div>
  `;
}

// Confirmation modal for ALL actions (Start, Stop, Restart)
function confirmAction(service, action, gameName) {
  const modal = document.getElementById('modal-confirm');
  const title = document.getElementById('confirm-title');
  const desc = document.getElementById('confirm-desc');
  const btn = document.getElementById('btn-do-confirm');
  const iconWrap = document.getElementById('confirm-icon-wrap');

  if (iconWrap) {
    if (action === 'start') {
      iconWrap.className = 'w-10 h-10 rounded-full flex items-center justify-center bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      iconWrap.innerHTML = `<svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
    } else if (action === 'stop') {
      iconWrap.className = 'w-10 h-10 rounded-full flex items-center justify-center bg-rose-500/10 text-rose-400 border border-rose-500/20';
      iconWrap.innerHTML = `<svg class="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/></svg>`;
    } else {
      iconWrap.className = 'w-10 h-10 rounded-full flex items-center justify-center bg-amber-500/10 text-amber-400 border border-amber-500/20';
      iconWrap.innerHTML = `<svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>`;
    }
  }

  if (action === 'start') {
    title.textContent = `ยืนยันการเปิดเซิร์ฟเวอร์ "${gameName}"`;
    desc.textContent = `ระบบจะส่งคำสั่งเริ่มต้นการทำงานของ "${gameName}" ผ่าน systemctl`;
    btn.className = 'px-4 py-2 rounded-lg font-medium text-xs text-white transition bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/25 cursor-pointer';
    btn.textContent = 'ยืนยันเปิดเซิร์ฟเวอร์';
  } else if (action === 'stop') {
    title.textContent = `ยืนยันการปิดเซิร์ฟเวอร์ "${gameName}"`;
    desc.textContent = `หากปิดเซิร์ฟเวอร์ ผู้เล่นทุกคนในเกมจะหลุดจากการเชื่อมต่อทันที`;
    btn.className = 'px-4 py-2 rounded-lg font-medium text-xs text-white transition bg-rose-600 hover:bg-rose-500 shadow-rose-600/25 cursor-pointer';
    btn.textContent = 'ยืนยันปิดเซิร์ฟเวอร์';
  } else if (action === 'restart') {
    title.textContent = `ยืนยันการรีสตาร์ท "${gameName}"`;
    desc.textContent = `เซิร์ฟเวอร์จะหยุดและเริ่มทำงานใหม่ ผู้เล่นจะหลุดชั่วคราวและใช้เวลา 10-30 วินาที`;
    btn.className = 'px-4 py-2 rounded-lg font-medium text-xs text-white transition bg-amber-600 hover:bg-amber-500 shadow-amber-600/25 cursor-pointer';
    btn.textContent = 'ยืนยันรีสตาร์ท';
  }

  btn.onclick = () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    executeAction(service, action, gameName);
  };

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

async function executeAction(service, action, gameName) {
  showToast(`กำลัง ${action} "${gameName}"...`, 'info');
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, action })
    });
    if (res.status === 401) {
      showLoginView();
      showToast('กรุณาเข้าสู่ระบบก่อนดำเนินการ', 'warning');
      return;
    }
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`ดำเนินการ "${gameName}" สำเร็จ!`, 'success');
      fetchStatus();
    } else {
      showToast(data.error || 'เกิดข้อผิดพลาดในการดำเนินการ', 'error');
    }
  } catch (e) {
    showToast('ไม่สามารถเชื่อมต่อกับ Server ได้', 'error');
  }
}

// Confirm Delete Game
function confirmDeleteGame(gameId, gameName) {
  const modal = document.getElementById('modal-confirm');
  const title = document.getElementById('confirm-title');
  const desc = document.getElementById('confirm-desc');
  const btn = document.getElementById('btn-do-confirm');
  const iconWrap = document.getElementById('confirm-icon-wrap');

  if (iconWrap) {
    iconWrap.className = 'w-10 h-10 rounded-full flex items-center justify-center bg-rose-500/10 text-rose-400 border border-rose-500/20';
    iconWrap.innerHTML = `<svg class="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>`;
  }

  title.textContent = `นำ "${gameName}" ออกจาก Dashboard?`;
  desc.textContent = `การนำออกจะไม่ลบไฟล์เกมหรือ service ในเครื่อง เพียงแค่หยุดแสดงผลใน Dashboard เท่านั้น`;
  btn.className = 'px-4 py-2 rounded-lg font-medium text-xs text-white transition bg-rose-600 hover:bg-rose-500 shadow-rose-600/25 cursor-pointer';
  btn.textContent = 'นำออกจากหน้าจอ';

  btn.onclick = async () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    try {
      const res = await fetch('/api/games/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: gameId })
      });
      if (res.status === 401) {
        showLoginView();
        showToast('กรุณาเข้าสู่ระบบก่อนดำเนินการ', 'warning');
        return;
      }
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`นำ "${gameName}" ออกจาก Dashboard แล้ว`, 'info');
        fetchStatus();
      } else {
        showToast(data.error || 'เกิดข้อผิดพลาดในการลบ', 'error');
      }
    } catch (e) {
      showToast('ไม่สามารถเชื่อมต่อเพื่อลบได้', 'error');
    }
  };

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

// Playit Details Modal Logic
function openPlayitModal() {
  const modal = document.getElementById('modal-playit');
  const details = latestPlayitDetails;

  const countBadge = document.getElementById('playit-modal-count');
  const tunnelsContainer = document.getElementById('playit-modal-tunnels');
  const statusBadge = document.getElementById('playit-modal-status');
  const agentText = document.getElementById('playit-modal-agent');
  const trafficText = document.getElementById('playit-modal-traffic');
  const connsText = document.getElementById('playit-modal-conns');

  if (details) {
    statusBadge.textContent = details.account_status || 'Verified';
    if (details.agent_id) {
      agentText.innerHTML = `<span class="select-all font-mono">${escapeHtml(details.agent_id)}</span> <button onclick="copyToClipboard(this.getAttribute('data-copy'), this)" data-copy="${escapeHtml(details.agent_id)}" title="คัดลอก Agent ID" class="text-slate-400 hover:text-white p-0.5 rounded hover:bg-slate-800 transition inline-flex items-center align-middle ml-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg></button>`;
    } else {
      agentText.textContent = '-';
    }
    
    const tunnels = details.tunnels || [];
    countBadge.textContent = `${tunnels.length} รายการ`;

    if (tunnels.length > 0) {
      tunnelsContainer.innerHTML = tunnels.map(t => `
        <div class="bg-slate-950/80 rounded-xl p-3 border border-slate-800 space-y-1.5 font-mono text-xs">
          <div class="flex items-center justify-between">
            <span class="text-emerald-400 font-bold select-all text-sm cursor-pointer hover:underline" onclick="copyToClipboard(this.innerText.trim(), this.parentElement.querySelector('button'))" title="คลิกเพื่อคัดลอก">${escapeHtml(t.display_address)}</span>
            <button onclick="copyToClipboard(this.getAttribute('data-copy'), this)" data-copy="${escapeHtml(t.display_address)}" title="คัดลอก Tunnel Address" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white text-xs font-sans flex items-center gap-1.5 transition touch-manipulation cursor-pointer">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
              <span>Copy IP</span>
            </button>
          </div>
          <div class="flex items-center justify-between text-slate-400 text-[11px] pt-1.5 border-t border-slate-800/60 font-sans">
            <span>Local Target: <span class="text-indigo-300 font-semibold font-mono">${escapeHtml(t.destination)}</span></span>
            <div class="flex items-center gap-2">
              ${renderPingBadge(t.ping, true)}
              <span class="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">Active</span>
            </div>
          </div>
        </div>
      `).join('');
    } else {
      tunnelsContainer.innerHTML = `<div class="text-slate-500 text-xs italic py-2">ยังไม่มี tunnel ถูกสร้างในบัญชี playit.gg</div>`;
    }

    if (details.stats) {
      const inKb = (details.stats.bytes_in / 1024).toFixed(1);
      const outMb = (details.stats.bytes_out / 1024 / 1024).toFixed(2);
      trafficText.textContent = `${inKb} KB in / ${outMb} MB out`;
      connsText.textContent = `${details.stats.active_udp || 0} active UDP session(s)`;
    } else {
      trafficText.textContent = '-';
      connsText.textContent = '-';
    }
  } else {
    tunnelsContainer.innerHTML = `<div class="text-slate-500 text-xs italic py-2">ไม่สามารถดึงข้อมูล playit daemon ได้ในขณะนี้</div>`;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closePlayitModal() {
  const modal = document.getElementById('modal-playit');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

// Log Modal Functions
function openLogModal(service, gameName) {
  activeLogService = service;
  const modal = document.getElementById('modal-logs');
  document.getElementById('log-modal-title').textContent = `${gameName} Logs`;
  document.getElementById('log-modal-service').textContent = `${service}.service`;
  document.getElementById('log-modal-content').innerHTML = '<div class="text-slate-500 italic">กำลังดึงข้อมูลบันทึกระบบ (journalctl)...</div>';
  
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  fetchLogs(service);

  if (logPollTimer) clearInterval(logPollTimer);
  logPollTimer = setInterval(() => {
    if (activeLogService) fetchLogs(activeLogService);
  }, 4000);
}

function closeLogModal() {
  const modal = document.getElementById('modal-logs');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  activeLogService = null;
  if (logPollTimer) clearInterval(logPollTimer);
}

async function fetchLogs(service) {
  try {
    const res = await fetch(`/api/logs?service=${encodeURIComponent(service)}&lines=60`);
    if (res.status === 401) {
      closeLogModal();
      showLoginView();
      return;
    }
    const data = await res.json();
    const container = document.getElementById('log-modal-content');
    
    if (data.logs && data.logs.trim()) {
      const formatted = escapeHtml(data.logs)
        .split('\n')
        .map(line => {
          if (line.includes('ERROR') || line.includes('Failed') || line.includes('Exception') || line.includes('(ERR)')) {
            return `<div class="text-rose-400 font-medium">${line}</div>`;
          } else if (line.includes('WARN') || line.includes('warning')) {
            return `<div class="text-amber-300">${line}</div>`;
          } else if (line.includes('Started') || line.includes('Loading') || line.includes('success') || line.includes('connected')) {
            return `<div class="text-emerald-300">${line}</div>`;
          }
          return `<div class="text-slate-300">${line}</div>`;
        })
        .join('');

      container.innerHTML = formatted;

      const autoScroll = document.getElementById('log-modal-autoscroll').checked;
      if (autoScroll) {
        container.scrollTop = container.scrollHeight;
      }
    } else {
      container.innerHTML = '<div class="text-slate-500 italic">ไม่มีข้อมูลบันทึก log สำหรับ service นี้ในปัจจุบัน</div>';
    }
  } catch (err) {
    document.getElementById('log-modal-content').innerHTML = '<div class="text-rose-400 italic">ไม่สามารถดึงข้อมูล log ได้</div>';
  }
}

// Toast notification
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  
  let bg = 'bg-slate-900 border-slate-700 text-slate-200';
  let icon = 'ℹ️';
  if (type === 'success') {
    bg = 'bg-emerald-950/90 border-emerald-700/60 text-emerald-200';
    icon = '✅';
  } else if (type === 'error') {
    bg = 'bg-rose-950/90 border-rose-700/60 text-rose-200';
    icon = '❌';
  } else if (type === 'info') {
    bg = 'bg-indigo-950/90 border-indigo-700/60 text-indigo-200';
    icon = '💡';
  }

  toast.className = `animate-toast pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-xl text-xs font-medium backdrop-blur-md ${bg}`;
  toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function fallbackCopyText(text) {
  if (!text && text !== 0) return false;
  let success = false;
  const str = String(text);
  const isRTL = document.documentElement.getAttribute('dir') === 'rtl';
  const yPosition = window.pageYOffset || document.documentElement.scrollTop || 0;

  // Method 1: Clean hidden Textarea with iOS WebKit settings (prevent zoom with 16px font)
  try {
    const textArea = document.createElement('textarea');
    textArea.value = str;
    textArea.style.fontSize = '16px';
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.style.color = 'transparent';
    textArea.style.zIndex = '-9999';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, str.length);

    success = document.execCommand('copy');
    document.body.removeChild(textArea);
  } catch (err) {
    success = false;
  }

  if (success) return true;

  // Method 2: Off-screen textarea with readonly attribute (Clipboard.js standard pattern)
  try {
    const textArea = document.createElement('textarea');
    textArea.value = str;
    textArea.style.fontSize = '16px';
    textArea.style.position = 'absolute';
    textArea.style[isRTL ? 'right' : 'left'] = '-9999px';
    textArea.style.top = `${yPosition}px`;
    textArea.style.border = '0';
    textArea.style.padding = '0';
    textArea.style.margin = '0';
    textArea.setAttribute('readonly', '');

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, str.length);

    success = document.execCommand('copy');
    document.body.removeChild(textArea);
  } catch (err) {
    success = false;
  }

  if (success) return true;

  // Method 3: Contenteditable span container with DOM Range (iOS WebKit Range selection)
  try {
    const span = document.createElement('span');
    span.textContent = str;
    span.style.whiteSpace = 'pre';
    span.style.fontSize = '16px';
    span.style.position = 'absolute';
    span.style[isRTL ? 'right' : 'left'] = '-9999px';
    span.style.top = `${yPosition}px`;
    span.contentEditable = 'true';
    span.tabIndex = -1;

    document.body.appendChild(span);

    const range = document.createRange();
    range.selectNodeContents(span);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }

    success = document.execCommand('copy');
    if (sel) {
      sel.removeAllRanges();
    }
    document.body.removeChild(span);
  } catch (err) {
    success = false;
  }

  return success;
}

function showManualCopyModal(text, successMsg = null, btnElement = null) {
  const modal = document.getElementById('modal-copy-manual');
  const input = document.getElementById('manual-copy-input');
  if (!modal || !input) {
    try {
      window.prompt('คัดลอกข้อความด้านล่างนี้ (แตะค้างแล้วเลือก Copy):', text);
    } catch (e) {
      showToast('ไม่สามารถคัดลอกได้: ' + text, 'info');
    }
    return;
  }

  input.value = text;
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  setTimeout(() => {
    input.focus();
    input.select();
    input.setSelectionRange(0, 999999);
  }, 60);

  const btnDoCopy = document.getElementById('btn-manual-copy-action');
  if (btnDoCopy) {
    btnDoCopy.onclick = () => {
      input.focus();
      input.select();
      input.setSelectionRange(0, 999999);
      const copied = fallbackCopyText(input.value);
      if (copied) {
        showToast(successMsg || 'คัดลอกเรียบร้อยแล้ว', 'info');
        if (btnElement) showCopySuccess(btnElement);
        closeManualCopyModal();
      } else {
        showToast('กรุณากดค้างที่ข้อความ แล้วเลือก "Copy"', 'info');
      }
    };
  }
}

function closeManualCopyModal() {
  const modal = document.getElementById('modal-copy-manual');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function showCopySuccess(btn) {
  if (!btn || !(btn instanceof Element)) return;
  if (btn.dataset.copying) return;
  btn.dataset.copying = 'true';
  
  const originalHTML = btn.innerHTML;
  const hasText = btn.innerText.trim().length > 0;
  
  if (hasText) {
    btn.innerHTML = `
      <svg class="w-3.5 h-3.5 text-emerald-400 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
      <span class="text-emerald-400 font-medium">คัดลอกแล้ว!</span>
    `;
  } else {
    btn.innerHTML = `<svg class="w-3.5 h-3.5 text-emerald-400 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>`;
  }
  
  setTimeout(() => {
    btn.innerHTML = originalHTML;
    delete btn.dataset.copying;
  }, 1500);
}

function copyToClipboard(text, btnElement = null, customMsg = null) {
  if (!text && text !== 0) {
    showToast('ไม่มีข้อมูลที่จะคัดลอก', 'error');
    return;
  }

  const str = String(text).trim();
  const successMsg = customMsg || `คัดลอก "${str.length > 35 ? str.substring(0, 32) + '...' : str}" แล้ว`;

  const handleSuccess = () => {
    showToast(successMsg, 'info');
    if (btnElement) {
      showCopySuccess(btnElement);
    }
  };

  const handleFailure = () => {
    showManualCopyModal(str, successMsg, btnElement);
  };

  // 1. In HTTP (non-secure context, e.g. LAN 192.168.x.x) or when navigator.clipboard is absent/restricted:
  // Must execute synchronous execCommand immediately during user gesture!
  if (!window.isSecureContext || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    if (fallbackCopyText(str)) {
      handleSuccess();
    } else {
      handleFailure();
    }
    return;
  }

  // 2. In Secure Context (HTTPS or localhost):
  navigator.clipboard.writeText(str)
    .then(() => {
      handleSuccess();
    })
    .catch((err) => {
      console.warn('navigator.clipboard.writeText rejected, attempting fallback:', err);
      if (fallbackCopyText(str)) {
        handleSuccess();
      } else {
        handleFailure();
      }
    });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render a sleek badge showing tunnel ping / latency
 */
function renderPingBadge(ping, showLabel = false) {
  if (!ping) return '';
  if (ping.status === 'measuring') {
    return `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700/60" title="กำลังวัดค่าความหน่วง (Latency)...">
      <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-ping"></span>
      <span>${showLabel ? 'Edge: ' : ''}pinging...</span>
    </span>`;
  }
  if (ping.ms === null || ping.status === 'offline') {
    return `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-rose-950/60 text-rose-400 border border-rose-800/60" title="ไม่สามารถเชื่อมต่อ Edge Node หรือ Timeout">
      <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
      <span>${showLabel ? 'Edge: ' : ''}timeout</span>
    </span>`;
  }

  let colorClass = 'bg-emerald-950/80 text-emerald-300 border-emerald-600/40';
  let dotClass = 'bg-emerald-400';
  if (ping.status === 'fair' || (ping.ms >= 60 && ping.ms < 130)) {
    colorClass = 'bg-amber-950/80 text-amber-300 border-amber-600/40';
    dotClass = 'bg-amber-400';
  } else if (ping.status === 'high' || ping.ms >= 130) {
    colorClass = 'bg-rose-950/80 text-rose-300 border-rose-600/40';
    dotClass = 'bg-rose-400';
  }

  return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono border ${colorClass}" title="Server ↔ Playit Edge Latency: ${ping.ms} ms">
    <span class="w-1.5 h-1.5 rounded-full ${dotClass}"></span>
    <span>${showLabel ? 'Edge: ' : ''}${ping.ms} ms</span>
  </span>`;
}

// ==============================================================================
// Wake-on-LAN (WOL) Management Functions
// ==============================================================================

function setupWolEventListeners() {
  // Quick WOL header button
  const quickWolBtn = document.getElementById('btn-quick-wol');
  if (quickWolBtn) {
    quickWolBtn.addEventListener('click', () => {
      confirmWakeDevice('pc');
    });
  }

  // Close WOL edit modal
  const closeWolBtn = document.getElementById('btn-close-wol-modal');
  if (closeWolBtn) closeWolBtn.addEventListener('click', closeWolEditModal);

  const cancelWolBtn = document.getElementById('btn-cancel-wol-edit');
  if (cancelWolBtn) cancelWolBtn.addEventListener('click', closeWolEditModal);

  // Copy SSH Key button inside modal
  const copyKeyBtn = document.getElementById('btn-copy-ssh-key');
  if (copyKeyBtn) {
    copyKeyBtn.addEventListener('click', () => {
      const preview = document.getElementById('wol-ssh-key-preview');
      const keyText = preview ? (preview.dataset.fullKey || preview.textContent) : '';
      if (keyText && !keyText.includes('กำลังโหลด') && !keyText.includes('ไม่พบ')) {
        copyToClipboard(keyText, copyKeyBtn, 'คัดลอก SSH Public Key สำเร็จ');
      } else {
        showToast('ยังไม่พบ SSH Public Key บนเซิร์ฟเวอร์', 'warning');
      }
    });
  }

  // Submit WOL edit modal form
  const formWol = document.getElementById('form-wol-edit');
  if (formWol) {
    formWol.addEventListener('submit', async (e) => {
      e.preventDefault();
      const devId = document.getElementById('wol-edit-id').value;
      const name = document.getElementById('wol-edit-name').value.trim();
      const mac = document.getElementById('wol-edit-mac').value.trim();
      const ip = document.getElementById('wol-edit-ip').value.trim();
      const broadcast = document.getElementById('wol-edit-broadcast').value.trim();
      const port = document.getElementById('wol-edit-port').value.trim();
      const desc = document.getElementById('wol-edit-desc').value.trim();
      const webPort = document.getElementById('wol-edit-web-port') ? document.getElementById('wol-edit-web-port').value.trim() : '8080';
      const shutdownUser = document.getElementById('wol-edit-shutdown-user') ? document.getElementById('wol-edit-shutdown-user').value.trim() : 'tae';
      const shutdownPort = document.getElementById('wol-edit-shutdown-port') ? parseInt(document.getElementById('wol-edit-shutdown-port').value.trim() || '22') : 22;
      const shutdownCmd = document.getElementById('wol-edit-shutdown-cmd') ? document.getElementById('wol-edit-shutdown-cmd').value.trim() : 'shutdown /s /t 0';

      try {
        const res = await fetch('/api/wol/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: devId,
            name,
            mac,
            ip,
            broadcast,
            port: port ? parseInt(port) : 9,
            description: desc,
            web_port: webPort ? parseInt(webPort) : 8080,
            shutdown_user: shutdownUser,
            shutdown_port: shutdownPort,
            shutdown_cmd: shutdownCmd
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          showToast('บันทึกการตั้งค่า Wake & Shutdown on LAN สำเร็จ', 'success');
          closeWolEditModal();
          if (data.devices) {
            currentWolDevices = data.devices;
            renderWolDevices(currentWolDevices);
          } else {
            fetchStatus();
          }
        } else {
          showToast(data.error || 'ไม่สามารถบันทึกข้อมูลได้', 'error');
        }
      } catch (err) {
        showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
      }
    });
  }
}

function renderWolDevices(devices) {
  const container = document.getElementById('wol-devices-container');
  if (!container) return;

  if (!devices || devices.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Check if any waking device has turned online
  devices.forEach(dev => {
    if (wakingDevices[dev.id]) {
      if (dev.is_online) {
        delete wakingDevices[dev.id];
        showToast(`🎉 เครื่อง ${dev.name} ออนไลน์แล้ว! (${dev.ip} ตอบสนองใน ${dev.ping?.ms || '0'} ms)`, 'success');
      } else if (Date.now() - wakingDevices[dev.id] > 60000) {
        delete wakingDevices[dev.id];
      }
    }
  });

  container.innerHTML = devices.map(dev => createWolCardHTML(dev)).join('');
}

function createWolCardHTML(dev) {
  const isOnline = dev.is_online;
  const isWaking = !!wakingDevices[dev.id];
  const formattedMac = dev.mac_formatted || dev.mac;
  const ip = dev.ip || '-';
  const broadcast = `${dev.broadcast || '192.168.1.255'}:${dev.port || 9}`;
  const pingMs = (dev.ping && dev.ping.ms !== null) ? `${dev.ping.ms} ms` : null;
  const webPort = dev.web_port || 8080;
  const webUrl = dev.web_url || (dev.ip && dev.ip !== '-' ? `http://${dev.ip}:${webPort}` : null);
  const shutdownUser = dev.shutdown_user || 'tae';
  const shutdownPort = dev.shutdown_port || 22;
  const shutdownCmd = dev.shutdown_cmd || 'shutdown /s /t 0';

  let statusBadgeHtml = '';
  let cardBorder = 'border-slate-800';
  let iconGlowBg = 'bg-slate-800/80 text-slate-400 border-slate-700/60';
  let powerIconClass = 'text-slate-400';

  if (isOnline) {
    statusBadgeHtml = `
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
        <span class="w-2 h-2 rounded-full bg-emerald-400 pulse-emerald"></span>
        <span>Online (เปิดอยู่)</span>
      </span>
    `;
    cardBorder = 'border-emerald-500/30';
    iconGlowBg = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    powerIconClass = 'text-emerald-400';
  } else if (isWaking) {
    statusBadgeHtml = `
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
        <span class="w-2 h-2 rounded-full bg-amber-400 pulse-amber"></span>
        <span>กำลังส่งสัญญาณ / รอเครื่องบูต...</span>
      </span>
    `;
    cardBorder = 'border-amber-500/35';
    iconGlowBg = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    powerIconClass = 'text-amber-400';
  } else {
    statusBadgeHtml = `
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-800/90 text-slate-400 border border-slate-700/60">
        <span class="w-2 h-2 rounded-full bg-slate-500"></span>
        <span>Offline (เครื่องปิด/สลีปอยู่)</span>
      </span>
    `;
  }

  return `
    <div class="bg-gradient-to-r from-slate-900/95 via-slate-900/80 to-slate-900/95 ${cardBorder} rounded-2xl p-4 sm:p-5 shadow-xl backdrop-blur-md wol-card relative overflow-hidden transition-all duration-300">
      <!-- Glow ambient background -->
      <div class="absolute -top-16 -right-16 w-44 h-44 ${isOnline ? 'bg-emerald-500/10' : 'bg-amber-500/10'} rounded-full blur-3xl pointer-events-none"></div>

      <!-- Top Row: Icon, Title, Status & Settings -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative mb-4">
        <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div class="w-10 h-10 sm:w-11 sm:h-11 rounded-xl ${iconGlowBg} border flex items-center justify-center shadow-lg transition-transform duration-300 shrink-0">
            <!-- Computer Monitor / Tower Icon -->
            <svg class="w-5 h-5 sm:w-6 sm:h-6 ${powerIconClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
            </svg>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-bold text-sm sm:text-base text-white tracking-tight truncate">${escapeHtml(dev.name || 'PC')}</h3>
              <span class="text-[10px] px-2 py-0.5 rounded font-mono font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20 shrink-0">Wake-on-LAN</span>
              ${webUrl ? `
                <a href="${escapeHtml(webUrl)}" target="_blank" rel="noopener noreferrer"
                  title="เปิดหน้าระบบควบคุม PC (${escapeHtml(webUrl)})"
                  class="text-[10px] px-2 py-0.5 rounded font-mono font-medium bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 transition inline-flex items-center gap-1 shrink-0">
                  <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                  <span>Web :${webPort}</span>
                </a>
              ` : ''}
            </div>
            <p class="text-[11px] sm:text-xs text-slate-400 mt-0.5 truncate">${escapeHtml(dev.description || 'เครื่องคอมพิวเตอร์หลัก (Local Network)')}</p>
          </div>
        </div>

        <div class="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto pt-2 sm:pt-0 border-t border-slate-800/60 sm:border-t-0">
          ${statusBadgeHtml}
          <!-- Edit device config button -->
          <button onclick="openWolEditModal('${dev.id}')" title="ตั้งค่าอุปกรณ์ PC" class="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700/60 transition cursor-pointer shrink-0">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Info Details Grid -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5 bg-slate-950/60 rounded-xl p-3 border border-slate-800/80 text-xs mb-4">
        <!-- IP Address -->
        <div>
          <span class="text-[11px] text-slate-500 block mb-0.5">IP Address</span>
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="font-mono text-slate-200 font-semibold">${escapeHtml(ip)}</span>
            <button onclick="copyToClipboard('${ip}', this, 'คัดลอก IP สำเร็จ')" title="Copy IP" class="text-slate-500 hover:text-slate-300 transition cursor-pointer p-0.5">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            </button>
            ${webUrl ? `
              <a href="${escapeHtml(webUrl)}" target="_blank" rel="noopener noreferrer" title="เปิดหน้าเว็บควบคุมเครื่อง (${escapeHtml(webUrl)})" class="text-indigo-400 hover:text-indigo-300 p-0.5 rounded hover:bg-indigo-950/60 transition inline-flex items-center touch-manipulation">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
              </a>
            ` : ''}
          </div>
        </div>

        <!-- MAC Address -->
        <div>
          <span class="text-[11px] text-slate-500 block mb-0.5">MAC Address</span>
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-indigo-400 font-semibold">${escapeHtml(formattedMac)}</span>
            <button onclick="copyToClipboard('${formattedMac}', this, 'คัดลอก MAC สำเร็จ')" title="Copy MAC" class="text-slate-500 hover:text-slate-300 transition cursor-pointer">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            </button>
          </div>
        </div>

        <!-- Ping Latency -->
        <div>
          <span class="text-[11px] text-slate-500 block mb-0.5">สถานะการเชื่อมต่อ (Ping)</span>
          <div>
            ${isOnline && pingMs ? `
              <span class="font-mono font-bold text-emerald-400">${pingMs}</span>
            ` : `
              <span class="font-mono text-slate-500">Unreachable (เครื่องปิด)</span>
            `}
          </div>
        </div>

        <!-- Broadcast Destination -->
        <div>
          <span class="text-[11px] text-slate-500 block mb-0.5">Broadcast Subnet</span>
          <span class="font-mono text-slate-400">${escapeHtml(broadcast)}</span>
        </div>
      </div>

      <!-- Action Buttons Row -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div class="grid grid-cols-1 sm:flex sm:items-center gap-2 sm:gap-2.5 w-full sm:w-auto">
          <!-- Main Wake on LAN Button -->
          <button id="btn-wake-action-${dev.id}" onclick="confirmWakeDevice('${dev.id}')"
            class="w-full sm:w-auto flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2.5 min-h-[42px] rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 active:scale-95 text-white font-bold text-xs sm:text-sm shadow-lg shadow-amber-600/30 hover:shadow-amber-500/40 transition-all cursor-pointer whitespace-nowrap">
            <svg class="w-4 h-4 text-white animate-pulse shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
            <span>ปลุกเครื่อง<span class="hidden sm:inline"> (WoL)</span></span>
          </button>

          <!-- Immediate Ping Check Button -->
          <button id="btn-ping-action-${dev.id}" onclick="pingWolDevice('${ip}', '${dev.id}')"
            title="ส่งคำสั่ง Ping เพื่อตรวจสอบว่าเปิดเครื่องหรือยัง"
            class="w-full sm:w-auto flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 min-h-[42px] rounded-xl bg-slate-800/80 hover:bg-slate-700/80 active:scale-95 text-slate-300 hover:text-white border border-slate-700/60 text-xs sm:text-sm font-semibold transition cursor-pointer whitespace-nowrap">
            <svg class="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>ตรวจจับ Ping</span>
          </button>

          <!-- Shutdown on LAN Button -->
          <button id="btn-shutdown-action-${dev.id}" onclick="confirmShutdownDevice('${dev.id}')"
            title="ส่งคำสั่ง SSH ปิดเครื่อง (Shutdown on LAN): ssh ${escapeHtml(shutdownUser)}@${escapeHtml(ip)} &quot;${escapeHtml(shutdownCmd)}&quot;"
            class="w-full sm:w-auto flex items-center justify-center gap-1.5 sm:gap-2 px-3.5 sm:px-4 py-2.5 min-h-[42px] rounded-xl ${isOnline ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-lg shadow-rose-600/30 hover:shadow-rose-500/40 font-bold' : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white border border-slate-700/60 font-semibold'} active:scale-95 text-xs sm:text-sm transition-all cursor-pointer whitespace-nowrap">
            <svg class="w-4 h-4 ${isOnline ? 'text-rose-100' : 'text-slate-400'} shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9"/>
            </svg>
            <span>ปิดเครื่อง<span class="hidden sm:inline"> (Shutdown)</span></span>
          </button>
        </div>

        <div class="text-[11px] text-slate-500 flex items-center gap-2 font-mono flex-wrap">
          <span>⚡ WoL: UDP 9/7</span>
          <span>•</span>
          <span>🛑 SoL: SSH (Port ${shutdownPort})</span>
        </div>
      </div>
    </div>
  `;
}

// Confirmation Popup for Wake on LAN to prevent accidental clicks
function confirmWakeDevice(deviceId = 'pc') {
  const dev = currentWolDevices.find(d => d.id === deviceId) || {
    id: 'pc',
    name: 'PC ของฉัน (Gaming PC)',
    ip: '192.168.1.163',
    mac: 'D8-5E-D3-49-AF-47',
    mac_formatted: 'D8:5E:D3:49:AF:47'
  };

  const modal = document.getElementById('modal-confirm');
  const title = document.getElementById('confirm-title');
  const desc = document.getElementById('confirm-desc');
  const btn = document.getElementById('btn-do-confirm');
  const iconWrap = document.getElementById('confirm-icon-wrap');

  if (iconWrap) {
    iconWrap.className = 'w-10 h-10 rounded-full flex items-center justify-center bg-amber-500/15 text-amber-400 border border-amber-500/30';
    iconWrap.innerHTML = `
      <svg class="w-5 h-5 text-amber-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
      </svg>
    `;
  }

  title.textContent = `ยืนยันการปลุกเครื่อง "${dev.name}"?`;
  desc.innerHTML = `ต้องการส่งสัญญาณ <strong>Wake-on-LAN (Magic Packet)</strong> ไปยังเครื่อง <strong>${escapeHtml(dev.ip || '')}</strong> (${escapeHtml(dev.mac_formatted || dev.mac || '')}) เพื่อสั่งเปิดเครื่องคอมพิวเตอร์หรือไม่?`;
  btn.className = 'px-4 py-2 rounded-lg font-medium text-xs text-white transition bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 shadow-lg shadow-amber-600/30 cursor-pointer active:scale-95';
  btn.textContent = 'ยืนยันปลุกเครื่อง';

  btn.onclick = () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    wakeWolDevice(deviceId);
  };

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

async function wakeWolDevice(deviceId = 'pc') {
  const btn = document.getElementById(`btn-wake-action-${deviceId}`) || document.getElementById('btn-quick-wol');
  const originalHtml = btn ? btn.innerHTML : null;
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-75');
    btn.innerHTML = `
      <svg class="w-4 h-4 animate-spin text-white shrink-0" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
      <span>กำลังส่งสัญญาณ...</span>
    `;
  }

  try {
    const res = await fetch('/api/wol/wake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deviceId })
    });

    if (res.status === 401) {
      showLoginView();
      showToast('กรุณาเข้าสู่ระบบก่อนดำเนินการ', 'warning');
      return;
    }

    const data = await res.json();
    if (res.ok && data.success) {
      wakingDevices[deviceId] = Date.now();
      showToast(data.message || 'ส่งสัญญาณ Wake-on-LAN เรียบร้อยแล้ว!', 'success');

      // Scroll smoothly to wol-section if not visible
      const wolSection = document.getElementById('wol-section');
      if (wolSection && btn === document.getElementById('btn-quick-wol')) {
        wolSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Re-render immediately to reflect waking status
      renderWolDevices(currentWolDevices);

      // Trigger high-frequency polling for the next 35 seconds to catch when PC is online
      let checkCount = 0;
      const wakeInterval = setInterval(async () => {
        checkCount++;
        if (checkCount > 15 || (currentWolDevices.find(d => d.id === deviceId)?.is_online)) {
          clearInterval(wakeInterval);
          return;
        }
        await fetchStatus();
      }, 2500);

    } else {
      showToast(data.error || 'ไม่สามารถส่งสัญญาณ Wake-on-LAN ได้', 'error');
    }
  } catch (err) {
    console.error('Error waking device:', err);
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
  } finally {
    if (btn && originalHtml) {
      btn.disabled = false;
      btn.classList.remove('opacity-75');
      btn.innerHTML = originalHtml;
    }
  }
}

// Confirmation Popup for Shutdown on LAN (SSH)
function confirmShutdownDevice(deviceId = 'pc') {
  const dev = currentWolDevices.find(d => d.id === deviceId) || {
    id: 'pc',
    name: 'PC ของฉัน (Gaming PC)',
    ip: '192.168.1.144',
    shutdown_user: 'tae',
    shutdown_cmd: 'shutdown /s /t 0',
    shutdown_port: 22
  };

  const modal = document.getElementById('modal-confirm');
  const title = document.getElementById('confirm-title');
  const desc = document.getElementById('confirm-desc');
  const btn = document.getElementById('btn-do-confirm');
  const iconWrap = document.getElementById('confirm-icon-wrap');

  const targetIp = dev.ip || '-';
  const targetUser = dev.shutdown_user || 'tae';
  const targetCmd = dev.shutdown_cmd || 'shutdown /s /t 0';
  const targetPort = dev.shutdown_port || 22;

  if (iconWrap) {
    iconWrap.className = 'w-10 h-10 rounded-full flex items-center justify-center bg-rose-500/15 text-rose-400 border border-rose-500/30';
    iconWrap.innerHTML = `
      <svg class="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9"/>
      </svg>
    `;
  }

  title.textContent = `ยืนยันการปิดเครื่อง "${dev.name}"?`;
  desc.innerHTML = `
    ต้องการส่งคำสั่ง <strong>Shutdown on LAN</strong> ผ่าน SSH ไปยังเครื่อง <strong>${escapeHtml(targetUser)}@${escapeHtml(targetIp)}</strong> หรือไม่?<br>
    <div class="mt-2.5 p-2 bg-slate-950 rounded-lg border border-slate-800 font-mono text-[11px] text-rose-300 break-all select-all">
      ssh ${escapeHtml(targetUser)}@${escapeHtml(targetIp)}${targetPort !== 22 ? ` -p ${targetPort}` : ''} "${escapeHtml(targetCmd)}"
    </div>
  `;
  btn.className = 'px-4 py-2 rounded-lg font-medium text-xs text-white transition bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 shadow-lg shadow-rose-600/30 cursor-pointer active:scale-95';
  btn.textContent = 'ยืนยันปิดเครื่อง';

  btn.onclick = () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    shutdownWolDevice(deviceId);
  };

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

async function shutdownWolDevice(deviceId = 'pc') {
  const btn = document.getElementById(`btn-shutdown-action-${deviceId}`);
  const originalHtml = btn ? btn.innerHTML : null;
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-75');
    btn.innerHTML = `
      <svg class="w-4 h-4 animate-spin text-white shrink-0" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
      <span>กำลังส่งคำสั่งปิดเครื่อง...</span>
    `;
  }

  try {
    const res = await fetch('/api/wol/shutdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deviceId })
    });

    if (res.status === 401) {
      showLoginView();
      showToast('กรุณาเข้าสู่ระบบก่อนดำเนินการ', 'warning');
      return;
    }

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'ส่งคำสั่ง Shutdown สำเร็จแล้ว!', 'success');

      // Start polling to detect when PC turns off
      let checkCount = 0;
      const shutdownInterval = setInterval(async () => {
        checkCount++;
        const target = currentWolDevices.find(d => d.id === deviceId);
        if (checkCount > 12 || (target && !target.is_online)) {
          clearInterval(shutdownInterval);
          if (target && !target.is_online) {
            showToast('เครื่องคอมพิวเตอร์ปิดเรียบร้อยแล้ว (Offline)', 'info');
          }
          return;
        }
        await fetchStatus();
      }, 3000);
    } else {
      showToast(data.error || 'ไม่สามารถส่งคำสั่ง Shutdown ได้', 'error');
    }
  } catch (err) {
    console.error('Error shutting down device:', err);
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
  } finally {
    if (btn && originalHtml) {
      btn.disabled = false;
      btn.classList.remove('opacity-75');
      btn.innerHTML = originalHtml;
    }
  }
}

async function pingWolDevice(ip, deviceId = 'pc') {
  const btn = document.getElementById(`btn-ping-action-${deviceId}`);
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-75');
    btn.innerHTML = `
      <svg class="w-4 h-4 animate-spin text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
      <span>Pinging...</span>
    `;
  }

  try {
    const res = await fetch('/api/wol/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    });
    const data = await res.json();
    if (res.ok) {
      if (data.is_online) {
        showToast(`เครื่อง ${ip} ตอบสนองแล้ว! (Ping: ${data.ms} ms)`, 'success');
      } else {
        showToast(`เครื่อง ${ip} ยังไม่ตอบสนอง (Offline)`, 'info');
      }
      fetchStatus();
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาดในการ Ping', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-75');
      btn.innerHTML = `
        <svg class="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <span>ตรวจจับ Ping</span>
      `;
    }
  }
}

function openWolEditModal(deviceId = 'pc') {
  const dev = currentWolDevices.find(d => d.id === deviceId) || {
    id: 'pc',
    name: 'PC ของฉัน (Gaming PC)',
    mac: 'D8-5E-D3-49-AF-47',
    ip: '192.168.1.163',
    broadcast: '192.168.1.255',
    port: 9,
    description: 'Windows Gaming / Main PC'
  };

  document.getElementById('wol-edit-id').value = dev.id || 'pc';
  document.getElementById('wol-edit-name').value = dev.name || 'PC ของฉัน (Gaming PC)';
  document.getElementById('wol-edit-mac').value = dev.mac || 'D8-5E-D3-49-AF-47';
  document.getElementById('wol-edit-ip').value = dev.ip || '192.168.1.163';
  document.getElementById('wol-edit-broadcast').value = dev.broadcast || '192.168.1.255';
  document.getElementById('wol-edit-port').value = dev.port || 9;
  document.getElementById('wol-edit-desc').value = dev.description || 'Windows Gaming / Main PC';
  const webPortInput = document.getElementById('wol-edit-web-port');
  if (webPortInput) webPortInput.value = dev.web_port || 8080;

  const userEl = document.getElementById('wol-edit-shutdown-user');
  if (userEl) userEl.value = dev.shutdown_user || 'tae';
  const portEl = document.getElementById('wol-edit-shutdown-port');
  if (portEl) portEl.value = dev.shutdown_port || 22;
  const cmdEl = document.getElementById('wol-edit-shutdown-cmd');
  if (cmdEl) cmdEl.value = dev.shutdown_cmd || 'shutdown /s /t 0';

  loadServerSshKey();

  const modal = document.getElementById('modal-wol-edit');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

async function loadServerSshKey() {
  const preview = document.getElementById('wol-ssh-key-preview');
  if (!preview) return;
  preview.textContent = 'กำลังดึง Public Key จากเซิร์ฟเวอร์...';
  try {
    const res = await fetch('/api/wol/ssh-key');
    if (res.ok) {
      const data = await res.json();
      if (data.public_key) {
        preview.textContent = data.public_key;
        preview.dataset.fullKey = data.public_key;
        return;
      }
    }
    preview.textContent = 'ไม่พบ SSH Public Key บนเซิร์ฟเวอร์';
  } catch (err) {
    preview.textContent = 'เกิดข้อผิดพลาดในการโหลด SSH Key';
  }
}

function closeWolEditModal() {
  const modal = document.getElementById('modal-wol-edit');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

// ==============================================================================
// Security, Login Logs & Email Alert Management
// ==============================================================================
let currentSecurityTab = 'history';

function setupSecurityEventListeners() {
  const btnSec = document.getElementById('btn-security');
  const btnSecMobile = document.getElementById('btn-security-mobile');
  const btnClose = document.getElementById('btn-close-security-modal');

  if (btnSec) btnSec.addEventListener('click', openSecurityModal);
  if (btnSecMobile) btnSecMobile.addEventListener('click', openSecurityModal);
  if (btnClose) btnClose.addEventListener('click', closeSecurityModal);

  // Close when clicking modal backdrop
  const modal = document.getElementById('modal-security');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeSecurityModal();
    });
  }

  // Toggle password visibility in security modal
  const btnTogglePwd = document.getElementById('btn-toggle-sec-pwd');
  const pwdInput = document.getElementById('sec-email-password');
  if (btnTogglePwd && pwdInput) {
    btnTogglePwd.addEventListener('click', () => {
      const isPass = pwdInput.type === 'password';
      pwdInput.type = isPass ? 'text' : 'password';
      btnTogglePwd.textContent = isPass ? 'ซ่อน' : 'แสดง';
    });
  }

  // Form submit for email config
  const formEmail = document.getElementById('form-security-email');
  if (formEmail) {
    formEmail.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveSecurityEmailConfig();
    });
  }
}

function openSecurityModal() {
  const modal = document.getElementById('modal-security');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    switchSecurityTab('history');
    fetchSecurityData();
  }
}

function closeSecurityModal() {
  const modal = document.getElementById('modal-security');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function switchSecurityTab(tab) {
  currentSecurityTab = tab;
  const tabs = ['history', 'devices', 'email'];
  tabs.forEach(t => {
    const el = document.getElementById(`sec-tab-${t}`);
    const btn = document.getElementById(`tab-btn-sec-${t}`);
    if (el) el.classList.toggle('hidden', t !== tab);
    if (btn) {
      if (t === tab) {
        btn.className = 'py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-2 transition cursor-pointer whitespace-nowrap';
      } else {
        btn.className = 'py-3 px-3 text-xs sm:text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2 transition cursor-pointer whitespace-nowrap';
      }
    }
  });
}

async function fetchSecurityData() {
  try {
    const res = await fetch('/api/security/history');
    if (res.status === 401) {
      showLoginView();
      return;
    }
    const data = await res.json();
    if (res.ok) {
      renderSecurityHistory(data.history || []);
      renderSecurityDevices(data.devices || []);
      renderSecurityConfig(data.config || {});
    }
  } catch (err) {
    console.error('Error fetching security data:', err);
    showToast('เกิดข้อผิดพลาดในการโหลดข้อมูลความปลอดภัย', 'error');
  }
}

function renderSecurityHistory(history) {
  const container = document.getElementById('sec-history-container');
  const countBadge = document.getElementById('badge-history-count');
  if (countBadge) countBadge.textContent = history.length;
  if (!container) return;

  if (history.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 text-slate-500 text-xs">
        <svg class="w-8 h-8 mx-auto mb-2 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <p>ยังไม่มีประวัติการเข้าสู่ระบบที่บันทึกไว้</p>
      </div>
    `;
    return;
  }

  container.innerHTML = history.map(item => {
    const isSuccess = item.status === 'success';
    const statusBadge = isSuccess
      ? `<span class="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>สำเร็จ</span>`
      : `<span class="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/25 px-2 py-0.5 rounded-full"><span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>ล้มเหลว (${escapeHtml(item.reason || 'รหัสผ่านผิด')})</span>`;

    const newDeviceBadge = item.is_new_device
      ? `<span class="text-[10px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full animate-pulse">⚡ อุปกรณ์ใหม่</span>`
      : '';

    const locationText = item.city && item.city !== 'Local Subnet' && item.city !== 'เครือข่ายภายในบ้าน'
      ? `${item.country} • ${item.city}`
      : (item.country || 'Local LAN');

    return `
      <div class="p-3 sm:p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 transition flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div class="space-y-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-bold text-xs sm:text-sm text-white">${escapeHtml(item.device_name || 'Unknown Device')}</span>
            ${statusBadge}
            ${newDeviceBadge}
          </div>
          <div class="flex items-center gap-2 text-[11px] text-slate-400 font-mono flex-wrap">
            <span>👤 ${escapeHtml(item.username || '-')}</span>
            <span>•</span>
            <span class="text-indigo-400 font-semibold">${escapeHtml(item.ip || '-')}</span>
            <span>•</span>
            <span class="text-purple-400">${escapeHtml(item.mac || 'N/A')}</span>
            <span>•</span>
            <span class="text-emerald-400 font-sans">${escapeHtml(locationText)}</span>
          </div>
        </div>
        <div class="text-[11px] text-slate-500 font-mono shrink-0 sm:text-right">
          ${escapeHtml(item.time_str || '')}
        </div>
      </div>
    `;
  }).join('');
}

function renderSecurityDevices(devices) {
  const container = document.getElementById('sec-devices-container');
  const countBadge = document.getElementById('badge-devices-count');
  if (countBadge) countBadge.textContent = devices.length;
  if (!container) return;

  if (devices.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 text-slate-500 text-xs">
        <svg class="w-8 h-8 mx-auto mb-2 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
        <p>ยังไม่มีอุปกรณ์ที่บันทึกไว้ในระบบ</p>
      </div>
    `;
    return;
  }

  container.innerHTML = devices.map(dev => {
    return `
      <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-start gap-3 min-w-0">
          <div class="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0 mt-0.5">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          </div>
          <div class="min-w-0 space-y-0.5">
            <div class="flex items-center gap-2">
              <h5 class="text-xs sm:text-sm font-bold text-white truncate">${escapeHtml(dev.device_name || 'Device')}</h5>
              <span class="text-[10px] px-1.5 py-0.2 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/40 font-mono">${escapeHtml(dev.username || 'user')}</span>
            </div>
            <div class="text-[11px] text-slate-400 font-mono flex items-center gap-2 flex-wrap">
              <span>IP: <span class="text-slate-200">${escapeHtml(dev.last_ip || '-')}</span></span>
              <span>•</span>
              <span>MAC: <span class="text-purple-400">${escapeHtml(dev.last_mac || 'N/A')}</span></span>
              <span>•</span>
              <span class="text-emerald-400 font-sans">${escapeHtml(dev.country || 'Local LAN')}</span>
            </div>
            <div class="text-[10px] text-slate-500 font-mono">
              เข้าใช้งานล่าสุด: ${escapeHtml(dev.last_login_str || '-')} (บันทึกครั้งแรก: ${escapeHtml(dev.first_login_str || '-')})
            </div>
          </div>
        </div>

        <button onclick="deleteTrustedDevice('${dev.device_id}')" class="self-end sm:self-center px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[11px] font-semibold transition cursor-pointer active:scale-95 shrink-0">
          ลบอุปกรณ์ (Untrust)
        </button>
      </div>
    `;
  }).join('');
}

function renderSecurityConfig(cfg) {
  const recipientInput = document.getElementById('sec-email-recipient');
  const senderInput = document.getElementById('sec-email-sender');
  const enabledCheckbox = document.getElementById('sec-email-enabled');
  const statusBadge = document.getElementById('sec-email-status-badge');
  const pwdBadge = document.getElementById('sec-password-configured-badge');

  if (recipientInput && cfg.recipient) recipientInput.value = cfg.recipient;
  if (senderInput && cfg.sender_email) senderInput.value = cfg.sender_email;
  if (enabledCheckbox) enabledCheckbox.checked = cfg.enabled !== false;

  if (statusBadge) {
    if (cfg.enabled !== false) {
      statusBadge.className = 'text-[10px] px-2 py-0.5 rounded font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
      statusBadge.textContent = 'เปิดใช้งาน';
    } else {
      statusBadge.className = 'text-[10px] px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-400 border border-slate-700';
      statusBadge.textContent = 'ปิดการใช้งาน';
    }
  }

  if (pwdBadge) {
    if (cfg.has_password) {
      pwdBadge.className = 'text-[10px] text-emerald-400 font-mono flex items-center gap-1';
      pwdBadge.innerHTML = '● ตั้งค่ารหัสผ่านแล้ว';
    } else {
      pwdBadge.className = 'text-[10px] text-amber-400 font-mono flex items-center gap-1';
      pwdBadge.innerHTML = '⚠️ ยังไม่ได้ระบุรหัสผ่าน';
    }
  }
}

async function saveSecurityEmailConfig() {
  const recipient = document.getElementById('sec-email-recipient')?.value.trim();
  const sender_email = document.getElementById('sec-email-sender')?.value.trim();
  const sender_password = document.getElementById('sec-email-password')?.value;
  const enabled = document.getElementById('sec-email-enabled')?.checked;

  try {
    const res = await fetch('/api/security/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, sender_email, sender_password, enabled })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
      document.getElementById('sec-email-password').value = '';
      await fetchSecurityData();
    } else {
      showToast(data.error || 'ไม่สามารถบันทึกได้', 'error');
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'error');
  }
}

async function sendTestSecurityEmail() {
  const btn = document.getElementById('btn-test-email');
  const originalHtml = btn ? btn.innerHTML : null;
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-75');
    btn.innerHTML = `
      <svg class="w-3.5 h-3.5 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
      <span>กำลังส่ง Email ทดสอบ...</span>
    `;
  }

  try {
    const res = await fetch('/api/security/test-email', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'ส่งอีเมลทดสอบสำเร็จแล้ว!', 'success');
    } else {
      showToast(data.error || 'ส่งอีเมลไม่สำเร็จ กรุณาตรวจสอบรหัสผ่าน App Password', 'error');
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
  } finally {
    if (btn && originalHtml) {
      btn.disabled = false;
      btn.classList.remove('opacity-75');
      btn.innerHTML = originalHtml;
    }
  }
}

async function deleteTrustedDevice(deviceId) {
  if (!confirm('คุณต้องการลบอุปกรณ์นี้ออกจากรายการที่เชื่อถือหรือไม่?\n(หากลบแล้ว การล็อกอินครั้งต่อไปจากเครื่องนี้จะแจ้งเตือนทาง Email ทันที)')) {
    return;
  }

  try {
    const res = await fetch('/api/security/devices/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'ลบอุปกรณ์เรียบร้อยแล้ว', 'success');
      await fetchSecurityData();
    } else {
      showToast(data.error || 'ไม่สามารถลบอุปกรณ์ได้', 'error');
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาดในการลบอุปกรณ์', 'error');
  }
}

async function clearSecurityHistory() {
  if (!confirm('คุณต้องการล้างประวัติการเข้าสู่ระบบทั้งหมดหรือไม่?')) {
    return;
  }

  try {
    const res = await fetch('/api/security/clear-history', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'ล้างประวัติเรียบร้อยแล้ว', 'success');
      await fetchSecurityData();
    } else {
      showToast(data.error || 'ไม่สามารถล้างประวัติได้', 'error');
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาดในการล้างประวัติ', 'error');
  }
}

