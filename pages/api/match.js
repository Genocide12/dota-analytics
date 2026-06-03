export default async function handler(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: "Missing match id" });
  }

  try {
    const response = await fetch(
      `https://api.stratz.com/api/v1/match/${id}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.STRATZ_TOKEN}`
        }
      }
    );

    const data = await response.json();

    res.status(200).json({
      matchId: id,
      data
    });

  } catch (e) {
    res.status(500).json({ error: "API error", details: e.message });
  }
}
