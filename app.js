// Базовые константы
const HERO_IMG_BASE = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes';
let heroNames = {};

// Мультиязычность
const lang = {
  ru: {
    subtitle: 'Вероятность победы • Влияние героев • Переломные моменты',
    loadMatch: 'Загрузить матч',
    loading: 'Анализируем матч...',
    winProb: 'Вероятность победы',
    goldAdv: 'Преимущество по золоту',
    xpAdv: 'Преимущество по опыту',
    players: 'Игроки',
    winnerRadiant: 'Победитель: Radiant',
    winnerDire: 'Победитель: Dire',
    turningPoint: (m, f, t) => `⚡ Переломный момент: ${m}:00 (${f}% → ${t}%)`,
    noData: 'Нет данных',
    errNotFound: 'Матч не найден',
    errNoPlayers: 'В матче нет данных игроков'
  },
  en: {
    subtitle: 'Win Probability • Hero Impact • Turning Points',
    loadMatch: 'Load Match',
    loading: 'Analyzing match...',
    winProb: 'Win Probability',
    goldAdv: 'Gold Advantage',
    xpAdv: 'XP Advantage',
    players: 'Players',
    winnerRadiant: 'Winner: Radiant',
    winnerDire: 'Winner: Dire',
    turningPoint: (m, f, t) => `⚡ Turning point: ${m}:00 (${f}% → ${t}%)`,
    noData: 'No data',
    errNotFound: 'Match not found',
    errNoPlayers: 'No player data in match'
  }
};

let currentLang = localStorage.getItem('dota-lang') || 'ru';
function t(key, ...args) {
  let val = lang[currentLang]?.[key] || lang.en[key] || key;
  return typeof val === 'function' ? val(...args) : val;
}

// Обновление текстов интерфейса
function updateUI() {
  const els = {
    subtitle: document.getElementById('subtitle'),
    loadMatchBtn: document.getElementById('loadMatchBtn'),
    loading: document.getElementById('loading'),
    winProbTitle: document.getElementById('winProbTitle'),
    goldAdvTitle: document.getElementById('goldAdvTitle'),
    xpAdvTitle: document.getElementById('xpAdvTitle'),
    playersTitle: document.getElementById('playersTitle')
  };
  if (els.subtitle) els.subtitle.textContent = t('subtitle');
  if (els.loadMatchBtn) els.loadMatchBtn.textContent = t('loadMatch');
  if (els.loading) els.loading.textContent = t('loading');
  if (els.winProbTitle) els.winProbTitle.textContent = t('winProb');
  if (els.goldAdvTitle) els.goldAdvTitle.textContent = t('goldAdv');
  if (els.xpAdvTitle) els.xpAdvTitle.textContent = t('xpAdv');
  if (els.playersTitle) els.playersTitle.textContent = t('players');
}

// Инициализация языка
document.getElementById('langToggle').addEventListener('click', () => {
  currentLang = currentLang === 'ru' ? 'en' : 'ru';
  localStorage.setItem('dota-lang', currentLang);
  document.getElementById('langToggle').textContent = currentLang === 'ru' ? 'EN' : 'RU';
  updateUI();
  // Обновить динамические тексты, если матч загружен
  const matchInfo = document.getElementById('matchInfo');
  if (!matchInfo.classList.contains('hidden')) {
    const winnerEl = document.getElementById('winnerBadge');
    if (winnerEl.dataset.winner === 'Radiant') winnerEl.textContent = t('winnerRadiant');
    else if (winnerEl.dataset.winner === 'Dire') winnerEl.textContent = t('winnerDire');
    const tpLabel = document.getElementById('turningPointLabel');
    if (tpLabel.dataset.tp) {
      const [min, from, to] = tpLabel.dataset.tp.split(',');
      tpLabel.textContent = t('turningPoint', min, from, to);
    }
  }
});
document.getElementById('langToggle').textContent = currentLang === 'ru' ? 'EN' : 'RU';
updateUI();

// Загрузка имён героев
async function loadHeroNames() {
  try {
    const res = await fetch('https://api.opendota.com/api/heroes');
    const heroes = await res.json();
    heroes.forEach(h => heroNames[h.id] = h.localized_name || 'Unknown');
  } catch(e) { console.warn('Hero names not loaded'); }
}

function getHeroName(id) {
  return heroNames[id] || `Hero ${id}`;
}

function getHeroImage(id) {
  const name = getHeroName(id);
  // Убираем всё, кроме букв и пробелов, пробелы в _, в нижний регистр
  const slug = name.replace(/[^a-zA-Z\s]/g, '').replace(/\s+/g, '_').toLowerCase();
  return `${HERO_IMG_BASE}/${slug}_icon.png`;
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

// Impact Score
function getPercentile(value, benchmarks) {
  if (!benchmarks || benchmarks.length === 0) return 50;
  for (let b of benchmarks) {
    if (value <= b.value) return b.percentile;
  }
  return 100;
}

async function calculateImpact(player, benchData, duration) {
  const metrics = {
    gold_per_min: player.gold_per_min,
    xp_per_min: player.xp_per_min,
    kills_per_min: player.kills ? (player.kills / (duration / 60)) : 0,
    last_hits_per_min: player.last_hits ? (player.last_hits / (duration / 60)) : 0,
    hero_damage_per_min: player.hero_damage ? (player.hero_damage / (duration / 60)) : 0,
    tower_damage: player.tower_damage || 0
  };
  let sum = 0, cnt = 0;
  const add = (val, arr) => {
    if (!arr || val === undefined) return;
    sum += getPercentile(val, arr);
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

// Главная функция загрузки матча
async function loadMatch(matchId) {
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const matchInfoEl = document.getElementById('matchInfo');

  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  matchInfoEl.classList.add('hidden');

  try {
    // 1. Получить данные матча
    const matchRes = await fetch(`https://api.opendota.com/api/matches/${matchId}`);
    if (!matchRes.ok) throw new Error(t('errNotFound') + ` (HTTP ${matchRes.status})`);
    const match = await matchRes.json();
    if (!match.players || match.players.length === 0) throw new Error(t('errNoPlayers'));

    const duration = match.duration;
    const steps = Math.floor(duration / 60) + 1;
    const minutes = Array.from({length: steps}, (_, i) => i);

    // 2. Преимущества по золоту и опыту
    const goldAdv = match.radiant_gold_adv || [];
    const xpAdv = match.radiant_xp_adv || [];
    const winProbs = minutes.map(m => calcWinProb(goldAdv[m] || 0, xpAdv[m] || 0));
    const turningPoint = findTurningPoint(winProbs, minutes);

    // 3. Загрузить бенчмарки для героев
    const heroIds = [...new Set(match.players.map(p => p.hero_id))];
    const benchPromises = heroIds.map(id =>
      fetch(`https://api.opendota.com/api/benchmarks?hero_id=${id}`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    );
    const benchResults = await Promise.all(benchPromises);
    const benchMap = {};
    heroIds.forEach((id, i) => { benchMap[id] = benchResults[i]; });

    // 4. Рассчитать Impact для каждого игрока
    const players = await Promise.all(match.players.map(async p => {
      const heroId = p.hero_id;
      let impact = 50;
      if (benchMap[heroId]) {
        impact = await calculateImpact(p, benchMap[heroId], duration);
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
        impact
      };
    }));

    // 5. Отобразить победителя и длительность
    const winnerEl = document.getElementById('winnerBadge');
    winnerEl.textContent = match.radiant_win ? t('winnerRadiant') : t('winnerDire');
    winnerEl.dataset.winner = match.radiant_win ? 'Radiant' : 'Dire';
    winnerEl.className = `badge ${match.radiant_win ? 'radiant-badge' : 'dire-badge'}`;
    const min = Math.floor(duration / 60);
    const sec = duration % 60;
    document.getElementById('durationLabel').textContent = `${min}:${sec.toString().padStart(2,'0')}`;

    // 6. Графики
    if (winProbChart) winProbChart.destroy();
    winProbChart = createChart(document.getElementById('winProbChart').getContext('2d'),
      t('winProb'), 'rgba(255, 96, 64, 1)', { minutes, values: winProbs });

    if (goldChart) goldChart.destroy();
    goldChart = createChart(document.getElementById('goldChart').getContext('2d'),
      t('goldAdv'), 'rgba(255, 215, 0, 1)', { minutes, values: goldAdv });

    if (xpChart) xpChart.destroy();
    xpChart = createChart(document.getElementById('xpChart').getContext('2d'),
      t('xpAdv'), 'rgba(0, 191, 255, 1)', { minutes, values: xpAdv });

    // Turning Point
    const tpLabel = document.getElementById('turningPointLabel');
    if (turningPoint) {
      const from = Math.round(turningPoint.from * 100);
      const to = Math.round(turningPoint.to * 100);
      tpLabel.textContent = t('turningPoint', turningPoint.minute, from, to);
      tpLabel.dataset.tp = `${turningPoint.minute},${from},${to}`;
    } else {
      tpLabel.textContent = '';
      delete tpLabel.dataset.tp;
    }

    // 7. Карточки игроков
    document.getElementById('playersContainer').innerHTML = players
      .sort((a,b) => b.impact - a.impact)
      .map(p => `
        <div class="player-card ${p.isRadiant ? 'radiant' : 'dire'}">
          <img src="${getHeroImage(p.heroId)}" alt="${getHeroName(p.heroId)}" onerror="this.style.display='none'">
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
    errorEl.classList.remove('hidden');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

// Назначение обработчика
document.getElementById('loadMatchBtn').addEventListener('click', () => {
  const id = document.getElementById('matchIdInput').value.trim();
  if (id) loadMatch(id);
});

// Старт
loadHeroNames();