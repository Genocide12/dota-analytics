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

// Win Probability
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function calcWinProb(goldAdv, xpAdv) {
  return sigmoid(0.0004 * goldAdv + 0.0003 * xpAdv);
}

// Turning Point
function findTurningPoint(probs, minutes) {
  if (probs.length < 3) return null;
  let maxChange = 0, point = null;
  for (let i = 1; i < probs.length - 1; i++) {
    const change = Math.abs(probs[i + 1] - probs[i - 1]);
    if (change > maxChange) {
      maxChange = change;
      point = { minute: minutes[i], from: probs[i - 1], to: probs[i + 1] };
    }
  }
  return point;
}

// Hero Impact через бенчмарки
async function calculateHeroImpact(player, heroId) {
  try {
    const benchRes = await fetch(`https://api.opendota.com/api/benchmarks?hero_id=${heroId}`);
    const benchData = await benchRes.json();
    // бенчмарки для GPM, XPM, KPM, LHM, HDM, TD
    const metrics = {
      gold_per_min: player.gold_per_min,
      xp_per_min: player.xp_per_min,
      kills_per_min: player.kills_per_min || (player.kills / (player.duration / 60)),
      last_hits_per_min: player.last_hits_per_min || (player.last_hits / (player.duration / 60)),
      hero_damage_per_min: player.hero_damage_per_min || (player.hero_damage / (player.duration / 60)),
      tower_damage: player.tower_damage
    };
    let totalPercentile = 0, count = 0;
    // GPM
    if (benchData.gold_per_min && metrics.gold_per_min) {
      const p = getPercentile(metrics.gold_per_min, benchData.gold_per_min);
      totalPercentile += p; count++;
    }
    // XPM
    if (benchData.xp_per_min && metrics.xp_per_min) {
      const p = getPercentile(metrics.xp_per_min, benchData.xp_per_min);
      totalPercentile += p; count++;
    }
    // KPM
    if (benchData.kills_per_min && metrics.kills_per_min) {
      const p = getPercentile(metrics.kills_per_min, benchData.kills_per_min);
      totalPercentile += p; count++;
    }
    // LHM
    if (benchData.last_hits_per_min && metrics.last_hits_per_min) {
      const p = getPercentile(metrics.last_hits_per_min, benchData.last_hits_per_min);
      totalPercentile += p; count++;
    }
    // HDM
    if (benchData.hero_damage_per_min && metrics.hero_damage_per_min) {
      const p = getPercentile(metrics.hero_damage_per_min, benchData.hero_damage_per_min);
      totalPercentile += p; count++;
    }
    // TD
    if (benchData.tower_damage && metrics.tower_damage) {
      const p = getPercentile(metrics.tower_damage, benchData.tower_damage);
      totalPercentile += p; count++;
    }
    return count > 0 ? Math.round(totalPercentile / count) : 50;
  } catch(e) { return 50; }
}

// Поиск процентиля по массиву бенчмарков
function getPercentile(value, benchmarks) {
  if (!benchmarks || benchmarks.length === 0) return 50;
  for (let i = 0; i < benchmarks.length; i++) {
    if (value <= benchmarks[i].value) {
      return benchmarks[i].percentile;
    }
  }
  return 100; // выше максимума
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
        fill: true, tension: 0.3, pointRadius: 0
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#aaa' }, grid: { color: '#222' } },
        y: { ticks: { color: '#aaa' }, grid: { color: '#222' } }
      }
    }
  });
}

async function loadMatch(matchId) {
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const matchInfoEl = document.getElementById('matchInfo');
  loadingEl.classList.remove('hidden');
  errorEl.textContent = '';
  matchInfoEl.classList.add('hidden');

  try {
    // Запрос матча
    const res = await fetch(`https://api.opendota.com/api/matches/${matchId}`);
    if (!res.ok) throw new Error(`Матч не найден (HTTP ${res.status})`);
    const match = await res.json();
    if (!match.players || match.players.length === 0) throw new Error('Нет данных игроков');

    const dur = match.duration;
    const steps = Math.floor(dur / 60) + 1;
    const minutes = Array.from({length: steps}, (_, i) => i);

    // Преимущества по золоту и опыту
    const goldAdv = match.radiant_gold_adv || [];
    const xpAdv = match.radiant_xp_adv || [];

    // Win Probability
    const winProbs = minutes.map(min => calcWinProb(goldAdv[min] || 0, xpAdv[min] || 0));
    const turningPoint = findTurningPoint(winProbs, minutes);

    // Запрашиваем бенчмарки для всех уникальных героев
    const heroIds = [...new Set(match.players.map(p => p.hero_id))];
    const benchPromises = heroIds.map(id =>
      fetch(`https://api.opendota.com/api/benchmarks?hero_id=${id}`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    );
    const benchResults = await Promise.all(benchPromises);
    const benchMap = {};
    heroIds.forEach((id, idx) => { benchMap[id] = benchResults[idx]; });

    // Игроки с Impact
    const players = await Promise.all(match.players.map(async p => {
      const duration = match.duration;
      const heroId = p.hero_id;
      const impact = benchMap[heroId]
        ? await calculateHeroImpactFromBench(p, benchMap[heroId], duration)
        : Math.round((p.kills + p.assists) / Math.max(p.deaths, 1) * 20); // запасной вариант
      return {
        steamId: p.account_id,
        heroId,
        isRadiant: p.isRadiant,
        kills: p.kills, deaths: p.deaths, assists: p.assists,
        netWorth: p.total_gold,
        level: p.level,
        gpm: p.gold_per_min,
        xpm: p.xp_per_min,
        heroDamage: p.hero_damage,
        towerDamage: p.tower_damage,
        impact
      };
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

    // --- Отрисовка ---
    document.getElementById('winnerBadge').textContent = `Победитель: ${match.radiant_win ? 'Radiant' : 'Dire'}`;
    document.getElementById('winnerBadge').className = `badge ${match.radiant_win ? 'radiant-badge' : 'dire-badge'}`;
    const mins = Math.floor(dur / 60);
    const secs = dur % 60;
    document.getElementById('durationLabel').textContent = `Длительность: ${mins}:${secs.toString().padStart(2,'0')}`;

    document.getElementById('picksContainer').innerHTML = '<strong>Пики:</strong> ' + picks.map(p =>
      `<div class="hero-icon" style="background-image:url('${getHeroImage(p.heroId)}')" title="${getHeroName(p.heroId)} (${p.team})"></div>`
    ).join('');
    document.getElementById('bansContainer').innerHTML = '<strong>Баны:</strong> ' + bans.map(b =>
      `<div class="hero-icon ban-icon" style="background-image:url('${getHeroImage(b.heroId)}')" title="${getHeroName(b.heroId)} (${b.team})"></div>`
    ).join('');

    // Win Prob Chart
    if (winProbChart) winProbChart.destroy();
    const wpCtx = document.getElementById('winProbChart').getContext('2d');
    winProbChart = createChart(wpCtx, 'Win Probability', 'rgba(255, 96, 64, 1)', { minutes, values: winProbs });

    // Gold Advantage Chart
    if (goldChart) goldChart.destroy();
    const goldCtx = document.getElementById('goldChart').getContext('2d');
    goldChart = createChart(goldCtx, 'Gold Advantage', 'rgba(255, 215, 0, 1)', { minutes, values: goldAdv });

    // XP Advantage Chart
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

    matchInfoEl.classList.remove('hidden');
  } catch (e) {
    errorEl.textContent = `Ошибка: ${e.message}`;
  } finally {
    loadingEl.classList.add('hidden');
  }
}

// Утилита для расчёта процентиля (вызывается внутри calculateHeroImpact)
async function calculateHeroImpactFromBench(player, benchData, duration) {
  const metrics = {
    gold_per_min: player.gold_per_min,
    xp_per_min: player.xp_per_min,
    kills_per_min: player.kills ? (player.kills / (duration / 60)) : 0,
    last_hits_per_min: player.last_hits ? (player.last_hits / (duration / 60)) : 0,
    hero_damage_per_min: player.hero_damage ? (player.hero_damage / (duration / 60)) : 0,
    tower_damage: player.tower_damage || 0
  };
  let sum = 0, cnt = 0;
  const add = (val, benchArr) => {
    if (!benchArr || !val) return;
    const p = getPercentile(val, benchArr);
    sum += p; cnt++;
  };
  add(metrics.gold_per_min, benchData.gold_per_min);
  add(metrics.xp_per_min, benchData.xp_per_min);
  add(metrics.kills_per_min, benchData.kills_per_min);
  add(metrics.last_hits_per_min, benchData.last_hits_per_min);
  add(metrics.hero_damage_per_min, benchData.hero_damage_per_min);
  add(metrics.tower_damage, benchData.tower_damage);
  return cnt > 0 ? Math.round(sum / cnt) : 50;
}

document.getElementById('loadMatchBtn').addEventListener('click', () => {
  const id = document.getElementById('matchIdInput').value.trim();
  if (id) loadMatch(id);
});
loadHeroNames();
