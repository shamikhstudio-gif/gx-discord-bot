// GX eSports Telemetry Client
document.addEventListener('DOMContentLoaded', () => {
  const liveClockEl = document.getElementById('liveClock');
  const refreshBtn = document.getElementById('refreshBtn');
  const valPing = document.getElementById('valPing');
  const valUptime = document.getElementById('valUptime');
  const valMembers = document.getElementById('valMembers');
  const masterBotName = document.getElementById('masterBotName');
  const masterBotId = document.getElementById('masterBotId');
  const masterGuildName = document.getElementById('masterGuildName');
  const masterMemoryUsage = document.getElementById('masterMemoryUsage');
  const copyApiBtn = document.getElementById('copyApiBtn');
  const badgePingQuality = document.getElementById('badgePingQuality');

  // 1. Live Clock
  function updateClock() {
    const now = new Date();
    liveClockEl.textContent = now.toUTCString().slice(17, 25) + ' UTC';
  }
  setInterval(updateClock, 1000);
  updateClock();

  // 2. Format Uptime Seconds
  function formatUptime(seconds) {
    if (!seconds && seconds !== 0) return '--';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  }

  // 3. Fetch Live Telemetry Data
  async function fetchStatus() {
    try {
      refreshBtn.style.opacity = '0.5';
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Status endpoint returned ' + res.status);
      const data = await res.json();

      // Ping
      const ping = data.ping || 0;
      valPing.textContent = ping;
      if (ping < 60) {
        badgePingQuality.className = 'badge green';
        badgePingQuality.textContent = 'استجابة فائقة السرعة ⚡';
      } else if (ping < 120) {
        badgePingQuality.className = 'badge blue';
        badgePingQuality.textContent = 'استجابة سريعة جداً 🟢';
      } else {
        badgePingQuality.className = 'badge amber';
        badgePingQuality.textContent = 'استجابة عادية 🟡';
      }

      // Uptime
      valUptime.textContent = formatUptime(data.uptimeSeconds || 0);

      // Members & Server
      if (data.guild) {
        valMembers.textContent = (data.guild.memberCount || 0).toLocaleString();
        masterGuildName.textContent = data.guild.name || '𝑮𝑿 𝒆𝑺𝒑𝒐𝒓𝒕𝒔';
      }

      // Master Bot
      if (data.mainBot) {
        masterBotName.textContent = data.mainBot.tag || 'GX Bot#3131';
        masterBotId.textContent = 'ID: ' + (data.mainBot.id || '1507671146487742464');
      }

      // Memory
      if (data.memory) {
        const heapMb = Math.round(data.memory.heapUsed / 1024 / 1024);
        masterMemoryUsage.textContent = `${heapMb} MB (Heap RAM)`;
      }

      // VCR Fleet Status
      if (data.vcrFleet && Array.isArray(data.vcrFleet)) {
        data.vcrFleet.forEach((vcr, idx) => {
          const card = document.getElementById(`vcr-${idx + 1}`);
          if (card) {
            const chSpan = card.querySelector('.assign-channel');
            if (chSpan) chSpan.textContent = '#' + (vcr.defaultChannelName || vcr.assignedChannelName || 'فويس');
          }
        });
      }

    } catch (err) {
      console.warn('Could not fetch status:', err.message);
    } finally {
      refreshBtn.style.opacity = '1';
    }
  }

  // 4. Copy API URL
  copyApiBtn.addEventListener('click', () => {
    const url = window.location.origin + '/api/status';
    navigator.clipboard.writeText(url).then(() => {
      copyApiBtn.textContent = 'تم النسخ!';
      setTimeout(() => { copyApiBtn.textContent = 'نسخ'; }, 2000);
    });
  });

  refreshBtn.addEventListener('click', fetchStatus);

  // Auto-refresh every 4 seconds
  fetchStatus();
  setInterval(fetchStatus, 4000);
});
