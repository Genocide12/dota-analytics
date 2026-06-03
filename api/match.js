const fetch = require('node-fetch');

// Коэффициенты для Win Probability (подобраны эмпирически)
const GOLD_COEFF = 0.0004;
const XP_COEFF = 0.0003;
const KILL_COEFF = 0.015;
const BASE = 0;

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function calculateWinProbability(goldAdv, xpAdv, killAdv) {
  const z = BASE + GOLD_COEFF * goldAdv + XP_COEFF * xpAdv + KILL_COEFF * killAdv;
  return sigmoid(z);
}

function findTurningPoint(probabilities, minutes) {
  if (probabilities.length < 3) return null;
  let maxChange = 0;
  let point = null;
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

function calculateHeroImpact(player, matchDuration) {
  const minutes = matchDuration / 60;
  const gpmNorm = (player.gold_per_min || 0) / 500;
  const xpmNorm = (player.xp_per_min || 0) / 600;
  const kda = (player.kills + player.assists) / Math.max(player.deaths, 1);
  const damageNorm = (player.hero_damage || 0) / (minutes * 1000);
  const score = (gpmNorm * 0.3 + xpmNorm * 0.2 + kda * 0.3 + damageNorm * 0.2) * 100;
  return Math.round(score);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { matchId } = req.query;
  if (!matchId) return res.status(400).json({ error: 'matchId required' });

  try {
    // 1. Загружаем базовые данные матча
    const matchRes = await fetch(`https://api.opendota.com/api/matches/${matchId}`);
    if (!matchRes.ok) throw new Error(`Match not found (status ${matchRes.status})`);
    const match = await matchRes.json();

    const dur = match.duration;
    const steps = Math.floor(dur / 60) + 1;

    // 2. Загружаем поминутные графики
    const graphRes = await fetch(`https://api.opendota.com/api/matches/${matchId}/graph`);
    if (!graphRes.ok) throw new Error(`Graph data not available`);
    const graph = await graphRes.json();

    // Из графика извлекаем командные преимущества по минутам
    const minutes = Array.from({ length: steps }, (_, i) => i);
    const goldAdv = [];
    const xpAdv = [];
    const killAdv = [];

    for (let i = 0; i < steps; i++) {
      const radiantGold = (graph.radiant_gold && graph.radiant_gold[i]) || 0;
      const direGold = (graph.dire_gold && graph.dire_gold[i]) || 0;
      const radiantXp = (graph.radiant_xp && graph.radiant_xp[i]) || 0;
      const direXp = (graph.dire_xp && graph.dire_xp[i]) || 0;
      const radiantKills = (graph.radiant_kills && graph.radiant_kills[i]) || 0;
      const direKills = (graph.dire_kills && graph.dire_kills[i]) || 0;

      goldAdv.push(radiantGold - direGold);
      xpAdv.push(radiantXp - direXp);
      killAdv.push(radiantKills - direKills);
    }

    // Считаем Win Probability для Radiant
    const winProbs = minutes.map(min => {
      return calculateWinProbability(goldAdv[min], xpAdv[min], killAdv[min]);
    });

    const turningPoint = findTurningPoint(winProbs, minutes);

    // Обрабатываем игроков
    const players = (match.players || []).map(p => {
      const impact = calculateHeroImpact(p, dur);
      return {
        steamAccountId: p.account_id,
        heroId: p.hero_id,
        isRadiant: p.isRadiant,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        netWorth: p.total_gold,
        level: p.level,
        goldPerMinute: p.gold_per_min,
        xpPerMinute: p.xp_per_min,
        heroDamage: p.hero_damage,
        towerDamage: p.tower_damage,
        role: p.role || 'unknown',
        lane: p.lane_role || 0,
        impact
      };
    });

    // Пики / баны (если есть в данных)
    const picks = (match.picks_bans || [])
      .filter(pb => pb.is_pick)
      .map(pb => ({
        heroId: pb.hero_id,
        team: pb.team === 0 ? 'Radiant' : 'Dire'
      }));
    const bans = (match.picks_bans || [])
      .filter(pb => !pb.is_pick)
      .map(pb => ({
        heroId: pb.hero_id,
        team: pb.team === 0 ? 'Radiant' : 'Dire'
      }));

    const result = {
      matchId: match.match_id,
      winner: match.radiant_win ? 'Radiant' : 'Dire',
      duration: dur,
      picks,
      bans,
      players,
      winProbability: {
        minutes,
        values: winProbs,
        turningPoint
      },
      goldAdvantage: goldAdv,
      xpAdvantage: xpAdv,
      killsAdvantage: killAdv
    };

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};