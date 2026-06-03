// Константы
const HERO_IMG_BASE = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes';
let heroNames = {};

// Загружаем имена героев один раз
async function loadHeroNames() {
  try {
    const res = await fetch('https://api.opendota.com/api/heroes');
    const heroes = await res.json();
    heroes.forEach(h => heroNames[h.id] = h.localized_name || 'Unknown');
  } catch(e) {
    console.warn('Не удалось загрузить имена героев');
  }
}

function getHeroName(id) {
  return heroNames[id] || `Hero ${id}`;
}

function getHeroImage(id) {
  const name = getHeroName(id).replace(/ /g, '_').replace(/'/g, '');
  return `${HERO_IMG_BASE}/${name}_icon.png`;
}

// Расчёты Win Probability (на клиенте)
const GOLD_COEFF = 0.0004;
const XP_COEFF = 0.0003;
const KILL_COEFF = 0.015;

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function calculateWinProbability(goldAdv, xpAdv, killAdv) {
  return sigmoid(GOLD_COEFF * goldAdv + XP_COEFF * xpAdv + KILL_COEFF * killAdv);
}

function findTurningPoint(probabilities, minutes) {
  if (probabilities.length < 3) return null;
  let maxChange = 0, point = null;
  for (let i = 1; i < probabilities.length - 1; i++) {
    const change = Math.abs(probabilities[i + 1] - probabilities[i - 1]);
    if (change > maxChange) {
      maxChange = change;
      point = {
        minute: minutes[i],
        from: probabilities[i - 1],
        to: probabilities[i + 1]
      };
    }
  }
  return point;
}

function calculateHeroImpact(player, duration) {
  const minutes = duration / 60;
  const gpmNorm = (player.gold_per_min || 0) / 500;
  const xpmNorm = (player.xp_per_min || 0) / 600;
  const kda = (player.kills + player.assists) / Math.max(player.deaths, 1);
  const dmgNorm = (player.hero_damage || 0) / (minutes * 1000);
  return Math.round((gpmNorm * 0.3 + xpmNorm * 0.2 + kda * 0.3 + dmgNorm * 0.2) * 100);
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

// Основная функция загрузки и отрисовки
async function loadMatch(matchId) {
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('error').textContent = '';
  document.getElementById('matchInfo').classList.add('hidden');

  try {
    // 1. Данные матча
    const matchRes = await fetch(`https://api.opendota.com/api/matches/${matchId}`);
    if (!matchRes.ok) throw new Error(`Матч не найден (${matchRes.status})`);
    const match = await matchRes.json();
    if (!match.players || match.players.length === 0) throw new Error('Матч ещё не распарсен');

    const duration = match.duration;
    const steps = Math.floor(duration / 60) + 1;

    // 2. График поминутных данных
    const graphRes = await fetch(`https://api.opendota.com/api/matches/${matchId}/graph`);
    if (!graphRes.ok) throw new Error('График недоступен');
    const graph = await graphRes.json();

    const minutes = Array.from({length: steps}, (_, i) => i);
    const goldAdv = [], xpAdv = [], killAdv = [];

    for (let i = 0; i < steps; i++) {
      const rg = (graph.radiant_gold && graph.radiant_gold[i]) || 0;
      const dg = (graph.dire_gold && graph.dire_gold[i]) || 0;
      const rx = (graph.radiant_xp && graph.radiant_xp[i]) || 0;
      const dx = (graph.dire_xp && graph.dire_xp[i]) || 0;
      const rk = (graph.radiant_kills && graph.radiant_kills[i]) || 0;
      const dk = (graph.dire_kills && graph.dire_kills[i]) || 0;

      goldAdv.push(rg - dg);
      xpAdv.push(rx - dx);
      killAdv.push(rk - dk);
    }

    const winProbs = minutes.map(min => calculateWinProbability(goldAdv[min], xpAdv[min], killAdv[min]));
    const turningPoint = findTurningPoint(winProbs, minutes);

    // Игроки
    const players = match.players.map(p => ({
      steamId: p.account_id,
      heroId: p.hero_id,
      isRadiant: p.isRadiant,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      netWorth: p.total_gold,
      level: p.level,
      gpm: p.gold_per_min,
      xpm: p.xp_per_min,
      heroDamage: p.hero_damage,
      towerDamage: p.tower_damage,
      impact: calculateHeroImpact(p, duration)
    }));

    // Пики/баны
    const picksBans = match.picks_bans || [];
    const picks = picksBans.filter(pb => pb.is_pick).map(pb => ({
      heroId: pb.hero_id,
      team: pb.team === 0 ? 'Radiant' : 'Dire'
    }));
    const bans = picksBans.filter(pb => !pb.is_pick).map(pb => ({
      heroId: pb.hero_id,
      team: pb.team === 0 ? 'Radiant' : 'Dire'
    }));

    // Отрисовка
    document.getElementById('winnerBadge').textContent = `Победитель: ${match.radiant_win ? 'Radiant' : 'Dire'}`;
    document.getElementById('winnerBadge').className = `badge ${match.radiant_win ? 'radiant-badge' : 'dire-badge'}`;
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    document.getElementById('durationLabel').textContent = `Длительность: ${mins}:${secs.toString().padStart(2,'0')}`;

    document.getElementById('picksContainer').innerHTML = '<strong>Пики:</strong> ' + picks.map(p => 
      `<div class="hero-icon" style="background-image:url('${getHeroImage(p.heroId)}')" title="${getHeroName(p.heroId)} (${p.team})"></div>`
    ).join('');
    document.getElementById('bansContainer').innerHTML = '<strong>Баны:</strong> ' + bans.map(b => 
      `<div class="hero-icon ban-icon" style="background-image:url('${getHeroImage(b.heroId)}')" title="${getHeroName(b.heroId)} (${b.team})"></div>`
    ).join('');

    // Графики
    if (winProbChart) winProbChart.destroy();
    const wpCtx = document.getElementById('winProbChart').getContext('2d');
    winProbChart = createChart(wpCtx, 'Win Probability', 'rgba(255, 96, 64, 1)', { minutes, values: winProbs });

    if (goldChart) goldChart.destroy();
    const goldCtx = document.getElementById('goldChart').getContext('2d');
    goldChart = createChart(goldCtx, 'Gold Advantage', 'rgba(255, 215, 0, 1)', { minutes, values: goldAdv });

    if (xpChart) xpChart.destroy();
    const xpCtx = document.getElementById('xpChart').getContext('2d');
    xpChart = createChart(xpCtx, 'XP Advantage', 'rgba(0, 191, 255, 1)', { minutes, values: xpAdv });

    const tpLabel = document.getElementById('turningPointLabel');
    if (turningPoint) {
      tpLabel.textContent = `⚡ Переломный момент: ${turningPoint.minute}-я минута (${(turningPoint.from*100).toFixed(0)}% → ${(turningPoint.to*100).toFixed(0)}%)`;
    } else {
      tpLabel.textContent = 'Переломный момент не обнаружен';
    }

    document.getElementById('playersContainer').innerHTML = players
      .sort((a,b) => b.impact - a.impact)
      .map(p => `
        <div class="player-card ${p.isRadiant ? 'radiant' : 'dire'}">
          <img src="${getHeroImage(p.heroId)}" alt="${getHeroName(p.heroId)}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2236%22><rect fill=%22%23333%22 width=%2264%22 height=%2236%22/></svg>'">
          <div class="player-stats">
            <strong>${getHeroName(p.heroId)}</strong>
            <span class="impact-badge">Impact ${p.impact}</span>
            <div>K/D/A: ${p.kills}/${p.deaths}/${p.assists}</div>
            <div>Net Worth: ${(p.netWorth/1000).toFixed(1)}k</div>
            <div>GPM: ${p.gpm} | XPM: ${p.xpm}</div>
            ${p.heroDamage ? `<div>Урон героям: ${(p.heroDamage/1000).toFixed(1)}k</div>` : ''}
            ${p.towerDamage ? `<div>Урон по башням: ${(p.towerDamage/1000).toFixed(1)}k</div>` : ''}
          </div>
        </div>
      `).join('');

    document.getElementById('matchInfo').classList.remove('hidden');
  } catch (e) {
    document.getElementById('error').textContent = `Ошибка: ${e.message}`;
  } finally {
    document.getElementById('loading').classList.add('hidden');
  }
}

// Обработчик кнопки
document.getElementById('loadMatchBtn').addEventListener('click', () => {
  const id = document.getElementById('matchIdInput').value.trim();
  if (id) loadMatch(id);
});

// Загрузка имён героев при старте
loadHeroNames();
