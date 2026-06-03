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

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function calcWinProb(goldAdv, xpAdv) {
  return sigmoid(0.0004 * goldAdv + 0.0003 * xpAdv);
}

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

function getPercentile(value, benchmarks) {
  if (!benchmarks || benchmarks.length === 0) return 50;
  for (let i = 0; i < benchmarks.length; i++) {
    if (value <= benchmarks[i].value) return benchmarks[i].percentile;
  }
  return 100;
}

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
    sum += getPercentile(val, benchArr);
    cnt++;
  };
  add(metrics.gold_per_min, benchData.gold_per_min);
  add(metrics.xp_per_min, benchData.xp_per_min);
  add(metrics.kills_per_min, benchData.kills_per_min);
  add(metrics.last_hits_per_min, benchData.last_hits_per_min);
  add(metrics.hero_damage_per_min, benchData.hero_damage_per_min);
  add(metrics.tower_damage, benchData.tower_damage);
  return cnt > 0 ? Math.round(sum / cnt) : 50;
}

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
        backgroundColor: color.replace('1)', '0.15)'),
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        x: {
          ticks: { color: '#8b95a5', maxTicksLimit: 10 },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          ticks: { color: '#8b95a5', callback: v => v.toFixed(2) },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

async function loadMatch(matchId) {
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const matchInfoEl = document.getElementById('matchInfo');

  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  matchInfoEl.classList.add('hidden');

  try {
    const res = await fetch(`https://api.opendota.com/api/matches/${matchId}`);
    if (!res.ok) throw new Error(`Матч не найден (HTTP ${res.status})`);
    const match = await res.json();
    if (!match.players || match.players.length === 0) throw new Error('В матче нет данных игроков');

    const dur = match.duration;
    const steps = Math.floor(dur / 60) + 1;
    const minutes = Array.from({length: steps}, (_, i) => i);

    const goldAdv = match.radiant_gold_adv || [];
    const xpAdv = match.radiant_xp_adv || [];

    const winProbs = minutes.map(min => calcWinProb(goldAdv[min] || 0, xpAdv[min] || 0));
    const turningPoint = findTurningPoint(winProbs, minutes);

    // Бенчмарки
    const heroIds = [...new Set(match.players.map(p => p.hero_id))];
    const benchPromises = heroIds.map(id =>
      fetch(`https://api.opendota.com/api/benchmarks?hero_id=${id}`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    );
    const benchResults = await Promise.all(benchPromises);
    const benchMap = {};
    heroIds.forEach((id, idx) => { benchMap[id] = benchResults[idx]; });

    const players = await Promise.all(match.players.map(async p => {
      const heroId = p.hero_id;
      let impact = 50;
      if (benchMap[heroId]) {
        impact = await calculateHeroImpactFromBench(p, benchMap[heroId], dur);
      }
      return {
        heroId,
        isRadiant: p.isRadiant,
        kills: p.kills, deaths: p.deaths, assists: p.assists,
        netWorth: p.total_gold,
        gpm: p.gold_per_min,
        xpm: p.xp_per_min,
        heroDamage: p.hero_damage,
        towerDamage: p.tower_damage,
        lastHits: p.last_hits,
        impact
      };
    }));

    const picksBans = match.picks_bans || [];
    const picks = picksBans.filter(pb => pb.is_pick);
    const bans = picksBans.filter(pb => !pb.is_pick);

    // --- Отрисовка ---
    document.getElementById('winnerBadge').textContent = `Победитель: ${match.radiant_win ? 'Radiant' : 'Dire'}`;
    document.getElementById('winnerBadge').className = `badge ${match.radiant_win ? 'radiant-badge' : 'dire-badge'}`;
    const mins = Math.floor(dur / 60);
    const secs = dur % 60;
    document.getElementById('durationLabel').textContent = `${mins}:${secs.toString().padStart(2,'0')}`;

    // Пики
    const picksEl = document.getElementById('picksContainer');
    if (picks.length) {
      picksEl.innerHTML = picks.map(p =>
        `<div class="hero-icon" style="background-image:url('${getHeroImage(p.hero_id)}')" title="${getHeroName(p.hero_id)}"></div>`
      ).join('');
    } else {
      picksEl.innerHTML = '<span style="color:#8b95a5;">Нет данных</span>';
    }

    // Баны
    const bansEl = document.getElementById('bansContainer');
    if (bans.length) {
      bansEl.innerHTML = bans.map(b =>
        `<div class="hero-icon ban-icon" style="background-image:url('${getHeroImage(b.hero_id)}')" title="${getHeroName(b.hero_id)}"></div>`
      ).join('');
    } else {
      bansEl.innerHTML = '<span style="color:#8b95a5;">Нет данных</span>';
    }

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
      tpLabel.textContent = `⚡ Переломный момент: ${turningPoint.minute}:00 (${Math.round(turningPoint.from*100)}% → ${Math.round(turningPoint.to*100)}%)`;
    } else {
      tpLabel.textContent = '';
    }

    // Карточки игроков
    document.getElementById('playersContainer').innerHTML = players
      .sort((a,b) => b.impact - a.impact)
      .map(p => `
        <div class="player-card ${p.isRadiant ? 'radiant' : 'dire'}">
          <img src="${getHeroImage(p.heroId)}" alt="${getHeroName(p.heroId)}" onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2272%22 height=%2242%22><rect fill=%22%231e293b%22 width=%2272%22 height=%2242%22/><text x=%2236%22 y=%2226%22 text-anchor=%22middle%22 fill=%22%238b95a5%22 font-size=%2210%22>?</text></svg>';">
          <div class="player-stats">
            <div class="name">
              ${getHeroName(p.heroId)}
              <span class="impact-badge">Impact ${p.impact}</span>
            </div>
            <div class="stat-row"><span>K/D/A</span><span class="value">${p.kills}/${p.deaths}/${p.assists}</span></div>
            <div class="stat-row"><span>Net Worth</span><span class="value">${(p.netWorth/1000).toFixed(1)}k</span></div>
            <div class="stat-row"><span>GPM / XPM</span><span class="value">${p.gpm} / ${p.xpm}</span></div>
            ${p.heroDamage ? `<div class="stat-row"><span>Урон героям</span><span class="value">${(p.heroDamage/1000).toFixed(1)}k</span></div>` : ''}
            ${p.towerDamage ? `<div class="stat-row"><span>Урон башням</span><span class="value">${(p.towerDamage/1000).toFixed(1)}k</span></div>` : ''}
          </div>
        </div>
      `).join('');

    matchInfoEl.classList.remove('hidden');
  } catch (e) {
    errorEl.textContent = `Ошибка: ${e.message}`;
    errorEl.classList.remove('hidden');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

document.getElementById('loadMatchBtn').addEventListener('click', () => {
  const id = document.getElementById('matchIdInput').value.trim();
  if (id) loadMatch(id);
});
loadHeroNames();
