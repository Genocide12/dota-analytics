// api/match.js
// Используем глобальный fetch (Node 18+ на Vercel), никаких зависимостей

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
  // Разрешаем CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { matchId } = req.query;
  if (!matchId) {
    return res.status(400).json({ error: 'matchId required' });
  }

  const debug = {
    step: 'start',
    matchId,
    errors: []
  };

  try {
    // 1. Запрос к OpenDota
    debug.step = 'fetching match';
    const matchUrl = `https://api.opendota.com/api/matches/${matchId}`;
    const matchRes = await fetch(matchUrl);
    debug.matchStatus = matchRes.status;

    if (!matchRes.ok) {
      throw new Error(`OpenDota match request failed with status ${matchRes.status}`);
    }

    const matchText = await matchRes.text();
    let match;
    try {
      match = JSON.parse(matchText);
    } catch (e) {
      throw new Error(`Failed to parse match JSON: ${matchText.substring(0, 200)}`);
    }

    debug.matchKeys = Object.keys(match);
    if (!match.players || match.players.length === 0) {
      throw new Error('Match data has no players (maybe not parsed yet)');
    }

    const dur = match.duration;
    const steps = Math.floor(dur / 60) + 1;
    debug.duration = dur;
    debug.steps = steps;

    // 2. Запрос графика
    debug.step = 'fetching graph';
    const graphUrl = `https://api.opendota.com/api/matches/${matchId}/graph`;
    const graphRes = await fetch(graphUrl);
    debug.graphStatus = graphRes.status;

    if (!graphRes.ok) {
      throw new Error(`OpenDota graph request failed with status ${graphRes.status}`);
    }

    const graphText = await graphRes.text();
    let graph;
    try {
      graph = JSON.parse(graphText);
    } catch (e) {
      throw new Error(`Failed to parse graph JSON: ${graphText.substring(0, 200)}`);
    }

    // Извлекаем поминутные данные
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

    // Win Probability
    const winProbs = minutes.map(min => {
      return calculateWinProbability(goldAdv[min], xpAdv[min], killAdv[min]);
    });

    const turningPoint = findTurningPoint(winProbs, minutes);

    // Игроки
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

    // Пики / баны
    const picksBans = match.picks_bans || [];
    const picks = picksBans
      .filter(pb => pb.is_pick)
      .map(pb => ({
        heroId: pb.hero_id,
        team: pb.team === 0 ? 'Radiant' : 'Dire'
      }));
    const bans = picksBans
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
      killsAdvantage: killAdv,
      debug // убираем debug из продакшена, но пока оставим
    };

    return res.status(200).json(result);

  } catch (err) {
    debug.error = err.message;
    debug.errorStack = err.stack;
    return res.status(500).json({
      error: 'Internal server error',
      message: err.message,
      debug
    });
  }
};