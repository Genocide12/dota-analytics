import fetch from 'node-fetch';

// Основной GraphQL-запрос к STRATZ
const QUERY = `
  query ($matchId: Long!) {
    match(id: $matchId) {
      didRadiantWin
      durationSeconds
      players {
        steamAccountId
        heroId
        isRadiant
        kills
        deaths
        assists
        netWorth
        level
        goldPerMinute
        xpPerMinute
        heroDamage
        towerDamage
        wardsPlaced
        role
        lane
        imp
      }
      playbackData {
        radiantGoldAdvantage
        radiantExperienceAdvantage
        radiantKillsAdvantage
      }
      stats {
        pickBans {
          isPick
          isRadiant
          heroId
        }
      }
    }
  }
`;

// Константы для Win Probability
const GOLD_COEFF = 0.00025; // подобрано эмпирически для логистической регрессии
const XP_COEFF = 0.00015;
const KILL_COEFF = 0.02;
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
  // Нормализация относительно длительности и роли
  const minutes = matchDuration / 60;
  const gpmNorm = player.goldPerMinute / 500; // 500 GPM средний ориентир
  const xpmNorm = player.xpPerMinute / 600;
  const kda = (player.kills + player.assists) / Math.max(player.deaths, 1);
  const damageNorm = player.heroDamage / (minutes * 1000); // ~1к урона в минуту

  // Веса (можно настроить)
  const score = (gpmNorm * 0.3 + xpmNorm * 0.2 + kda * 0.3 + damageNorm * 0.2) * 100;
  return Math.round(score);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { matchId } = req.query;
  if (!matchId) return res.status(400).json({ error: 'matchId required' });

  try {
    const response = await fetch('https://api.stratz.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.STRATZ_API_KEY}`
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { matchId: parseInt(matchId) }
      })
    });

    const json = await response.json();
    if (json.errors) throw new Error(json.errors[0].message);

    const match = json.data.match;
    const dur = match.durationSeconds;
    const steps = Math.floor(dur / 60) + 1; // поминутные срезы

    // Извлекаем массивы преимуществ
    const goldAdv = match.playbackData?.radiantGoldAdvantage ?? [];
    const xpAdv = match.playbackData?.radiantExperienceAdvantage ?? [];
    const killAdv = match.playbackData?.radiantKillsAdvantage ?? [];

    // Рассчитываем Win Probability для Radiant
    const minutes = Array.from({ length: steps }, (_, i) => i);
    const winProbs = minutes.map(min => {
      const g = goldAdv[min] || 0;
      const x = xpAdv[min] || 0;
      const k = killAdv[min] || 0;
      return calculateWinProbability(g, x, k);
    });

    // Находим Turning Point
    const turningPoint = findTurningPoint(winProbs, minutes);

    // Обрабатываем игроков
    const players = match.players.map(p => {
      const impact = calculateHeroImpact(p, dur);
      return {
        steamAccountId: p.steamAccountId,
        heroId: p.heroId,
        isRadiant: p.isRadiant,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        netWorth: p.netWorth,
        level: p.level,
        goldPerMinute: p.goldPerMinute,
        xpPerMinute: p.xpPerMinute,
        heroDamage: p.heroDamage,
        towerDamage: p.towerDamage,
        role: p.role,
        lane: p.lane,
        impact: impact
      };
    });

    // Собираем ответ
    const result = {
      matchId: parseInt(matchId),
      winner: match.didRadiantWin ? 'Radiant' : 'Dire',
      duration: dur,
      picks: match.stats?.pickBans?.filter(pb => pb.isPick).map(pb => ({
        heroId: pb.heroId,
        team: pb.isRadiant ? 'Radiant' : 'Dire'
      })) || [],
      bans: match.stats?.pickBans?.filter(pb => !pb.isPick).map(pb => ({
        heroId: pb.heroId,
        team: pb.isRadiant ? 'Radiant' : 'Dire'
      })) || [],
      players,
      winProbability: {
        minutes,
        values: winProbs,
        turningPoint
      },
      goldAdvantage: goldAdv.slice(0, steps),
      xpAdvantage: xpAdv.slice(0, steps),
      killsAdvantage: killAdv.slice(0, steps)
    };

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}