const HERO_IMG_BASE = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes';

let heroNames = {};

async function loadHeroNames() {
  try {
    const res = await fetch('https://api.opendota.com/api/heroes');
    const heroes = await res.json();
    heroes.forEach(h => heroNames[h.id] = h.localized_name || 'Unknown');
  } catch(e) {}
}

function getHeroName(id) {
  return heroNames[id] || `Hero ${id}`;
}

function getHeroImage(id) {
  const name = getHeroName(id).replace(/ /g, '_').replace(/'/g, '');
  return `${HERO_IMG_BASE}/${name}_icon.png`;
}

// Графики
let winProbChart, goldChart, xpChart;

function createChart(ctx, label, color, data) {
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.minutes,
      datasets: [{
        label: label,
        data: data.values,
        borderColor: color,
        backgroundColor: color.replace('1)', '0.2)'),
        fill: true,
        tension: 0.3,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#aaa' }, grid: { color: '#222' } },
        y: { ticks: { color: '#aaa' }, grid: { color: '#222' } }
      }
    }
  });
}

function renderMatch(data) {
  document.getElementById('matchInfo').classList.remove('hidden');
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').textContent = '';

  const winnerBadge = document.getElementById('winnerBadge');
  winnerBadge.textContent = `Победитель: ${data.winner}`;
  winnerBadge.className = `badge ${data.winner === 'Radiant' ? 'radiant-badge' : 'dire-badge'}`;

  const mins = Math.floor(data.duration / 60);
  const secs = data.duration % 60;
  document.getElementById('durationLabel').textContent =
    `Длительность: ${mins}:${secs.toString().padStart(2, '0')}`;

  // Пики
  const picksContainer = document.getElementById('picksContainer');
  picksContainer.innerHTML = '<strong>Пики:</strong> ' + data.picks.map(p =>
    `<div class="hero-icon" style="background-image:url('${getHeroImage(p.heroId)}')" title="${getHeroName(p.heroId)} (${p.team})"></div>`
  ).join('');

  // Баны
  const bansContainer = document.getElementById('bansContainer');
  bansContainer.innerHTML = '<strong>Баны:</strong> ' + data.bans.map(b =>
    `<div class="hero-icon ban-icon" style="background-image:url('${getHeroImage(b.heroId)}')" title="${getHeroName(b.heroId)} (${b.team})"></div>`
  ).join('');

  // Графики
  if (winProbChart) winProbChart.destroy();
  const wpCtx = document.getElementById('winProbChart').getContext('2d');
  winProbChart = createChart(wpCtx, 'Win Probability', 'rgba(255, 96, 64, 1)', data.winProbability);

  if (goldChart) goldChart.destroy();
  const goldCtx = document.getElementById('goldChart').getContext('2d');
  goldChart = createChart(goldCtx, 'Gold Advantage', 'rgba(255, 215, 0, 1)', {
    minutes: data.winProbability.minutes,
    values: data.goldAdvantage
  });

  if (xpChart) xpChart.destroy();
  const xpCtx = document.getElementById('xpChart').getContext('2d');
  xpChart = createChart(xpCtx, 'XP Advantage', 'rgba(0, 191, 255, 1)', {
    minutes: data.winProbability.minutes,
    values: data.xpAdvantage
  });

  // Turning Point
  const tp = data.winProbability.turningPoint;
  const tpLabel = document.getElementById('turningPointLabel');
  if (tp) {
    tpLabel.textContent = `⚡ Переломный момент: ${tp.minute}-я минута (вероятность сменилась с ${(tp.from*100).toFixed(0)}% до ${(tp.to*100).toFixed(0)}%)`;
  } else {
    tpLabel.textContent = 'Переломный момент не обнаружен';
  }

  // Игроки
  const playersContainer = document.getElementById('playersContainer');
  playersContainer.innerHTML = data.players.sort((a, b) => b.impact - a.impact).map(p => `
    <div class="player-card ${p.isRadiant ? 'radiant' : 'dire'}">
      <img src="${getHeroImage(p.heroId)}" alt="${getHeroName(p.heroId)}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2236%22><rect fill=%22%23333%22 width=%2264%22 height=%2236%22/></svg>'" />
      <div class="player-stats">
        <strong>${getHeroName(p.heroId)}</strong>
        <span class="impact-badge">Impact ${p.impact}</span>
        <div>K/D/A: ${p.kills}/${p.deaths}/${p.assists}</div>
        <div>Net Worth: ${(p.netWorth/1000).toFixed(1)}k</div>
        <div>GPM: ${p.goldPerMinute} | XPM: ${p.xpPerMinute}</div>
        ${p.heroDamage ? `<div>Урон героям: ${(p.heroDamage/1000).toFixed(1)}k</div>` : ''}
        ${p.towerDamage ? `<div>Урон по башням: ${(p.towerDamage/1000).toFixed(1)}k</div>` : ''}
      </div>
    </div>
  `).join('');
}

document.getElementById('loadMatchBtn').addEventListener('click', async () => {
  const matchId = document.getElementById('matchIdInput').value.trim();
  if (!matchId) return;
  document.getElementById('error').textContent = '';
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('matchInfo').classList.add('hidden');
  try {
    const res = await fetch(`/api/match?matchId=${matchId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderMatch(data);
  } catch (e) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error').textContent = `Ошибка: ${e.message}`;
  }
});

loadHeroNames();