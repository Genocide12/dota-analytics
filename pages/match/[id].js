import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function Match() {
  const router = useRouter();
  const { id } = router.query;

  const [data, setData] = useState(null);

  useEffect(() => {
    if (!id) return;

    fetch(`/api/match?id=${id}`)
      .then(res => res.json())
      .then(setData);
  }, [id]);

  if (!data) return <div>Loading...</div>;

  const match = data.data;

  return (
    <div style={{padding:20,fontFamily:"sans-serif"}}>

      <h2>Match #{id}</h2>

      <h3>
        {match.didRadiantWin ? "Radiant Won" : "Dire Won"}
      </h3>

      <h4>Players</h4>

      {match.players?.map(p => (
        <div key={p.steamAccountId} style={{
          padding:10,
          margin:5,
          border:"1px solid #ddd",
          borderRadius:10
        }}>
          {p.heroName}
          <br />
          KDA: {p.kills}/{p.deaths}/{p.assists}
          <br />
          Net Worth: {p.networth}
        </div>
      ))}

    </div>
  );
}
