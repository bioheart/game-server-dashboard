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
  checkAuth();
});

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

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (res.ok && data.success) {
          showToast(`เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ${data.username}`, 'success');
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

  // Logout button
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (err) {}
      showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
      showLoginView();
    });
  }
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

  if (loginView) {
    loginView.classList.add('hidden');
    loginView.classList.remove('flex');
  }
  if (dashboardView) {
    dashboardView.classList.remove('hidden');
  }
  if (userElem && username) {
    userElem.textContent = username;
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
                <div class="flex items-center gap-2">
                  <span class="text-emerald-300 font-bold select-all cursor-pointer hover:underline" onclick="copyToClipboard(this.innerText.trim(), this.nextElementSibling)" title="คลิกเพื่อคัดลอก">${escapeHtml(game.public_tunnel)}</span>
                  <button onclick="copyToClipboard(this.getAttribute('data-copy'), this)" data-copy="${escapeHtml(game.public_tunnel)}" title="คัดลอก Playit IP" class="text-emerald-400 hover:text-white p-1 rounded hover:bg-emerald-900/60 transition flex items-center justify-center">
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
                <div class="flex items-center gap-2">
                  <span class="text-indigo-300 font-medium select-all cursor-pointer hover:underline" onclick="copyToClipboard(this.innerText.trim(), this.nextElementSibling)" title="คลิกเพื่อคัดลอก">${connectAddr}</span>
                  <button onclick="copyToClipboard(this.getAttribute('data-copy'), this)" data-copy="${escapeHtml(connectAddr)}" title="คัดลอก Local LAN Address" class="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition flex items-center justify-center">
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

  if (action === 'start') {
    title.textContent = `ยืนยันการเปิดเซิร์ฟเวอร์ "${gameName}"`;
    desc.textContent = `ระบบจะส่งคำสั่งเริ่มต้นการทำงานของ "${gameName}" ผ่าน systemctl`;
    btn.className = 'px-4 py-2 rounded-lg font-medium text-xs text-white transition bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/25';
    btn.textContent = 'ยืนยันเปิดเซิร์ฟเวอร์';
  } else if (action === 'stop') {
    title.textContent = `ยืนยันการปิดเซิร์ฟเวอร์ "${gameName}"`;
    desc.textContent = `หากปิดเซิร์ฟเวอร์ ผู้เล่นทุกคนในเกมจะหลุดจากการเชื่อมต่อทันที`;
    btn.className = 'px-4 py-2 rounded-lg font-medium text-xs text-white transition bg-rose-600 hover:bg-rose-500 shadow-rose-600/25';
    btn.textContent = 'ยืนยันปิดเซิร์ฟเวอร์';
  } else if (action === 'restart') {
    title.textContent = `ยืนยันการรีสตาร์ท "${gameName}"`;
    desc.textContent = `เซิร์ฟเวอร์จะหยุดและเริ่มทำงานใหม่ ผู้เล่นจะหลุดชั่วคราวและใช้เวลา 10-30 วินาที`;
    btn.className = 'px-4 py-2 rounded-lg font-medium text-xs text-white transition bg-amber-600 hover:bg-amber-500 shadow-amber-600/25';
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

  title.textContent = `นำ "${gameName}" ออกจาก Dashboard?`;
  desc.textContent = `การนำออกจะไม่ลบไฟล์เกมหรือ service ในเครื่อง เพียงแค่หยุดแสดงผลใน Dashboard เท่านั้น`;
  btn.className = 'px-4 py-2 rounded-lg font-medium text-xs text-white transition bg-rose-600 hover:bg-rose-500 shadow-rose-600/25';
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
            <button onclick="copyToClipboard(this.getAttribute('data-copy'), this)" data-copy="${escapeHtml(t.display_address)}" title="คัดลอก Tunnel Address" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-sans flex items-center gap-1.5 transition">
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
  let success = false;
  const textArea = document.createElement('textarea');
  textArea.value = text;
  
  // Keep offscreen and fixed to prevent any scrolling
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
  textArea.style.opacity = '0';
  textArea.setAttribute('readonly', '');
  
  document.body.appendChild(textArea);
  
  // iOS Safari compatibility
  if (navigator.userAgent.match(/ipad|ipod|iphone/i)) {
    textArea.contentEditable = 'true';
    textArea.readOnly = false;
    const range = document.createRange();
    range.selectNodeContents(textArea);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    textArea.setSelectionRange(0, 999999);
  } else {
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, textArea.value.length);
  }

  try {
    success = document.execCommand('copy');
  } catch (err) {
    console.error('execCommand copy failed:', err);
    success = false;
  }
  
  document.body.removeChild(textArea);
  return success;
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
  if (!text) {
    showToast('ไม่มีข้อมูลที่จะคัดลอก', 'error');
    return;
  }

  const successMsg = customMsg || `คัดลอก "${text.length > 35 ? text.substring(0, 32) + '...' : text}" แล้ว`;

  const handleSuccess = () => {
    showToast(successMsg, 'info');
    if (btnElement) {
      showCopySuccess(btnElement);
    }
  };

  const handleFailure = () => {
    showToast('ไม่สามารถคัดลอกข้อมูลได้ กรุณาลองลากครอบข้อความและกด Ctrl+C', 'error');
  };

  // If in Secure Context (HTTPS or localhost) and navigator.clipboard is available
  if (window.isSecureContext && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text)
      .then(() => {
        handleSuccess();
      })
      .catch((err) => {
        console.warn('navigator.clipboard.writeText rejected, attempting fallback:', err);
        if (fallbackCopyText(text)) {
          handleSuccess();
        } else {
          handleFailure();
        }
      });
  } else {
    // In HTTP (insecure context) or older browsers: execute synchronously during user gesture!
    if (fallbackCopyText(text)) {
      handleSuccess();
    } else {
      handleFailure();
    }
  }
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
