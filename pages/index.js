import { useState } from "react";
import { useRouter } from "next/router";

export default function Home() {
  const [id, setId] = useState("");
  const router = useRouter();

  return (
    <div style={{padding:20, fontFamily:"sans-serif"}}>
      <h2>Dota Analytics</h2>

      <input
        placeholder="Enter Match ID"
        value={id}
        onChange={(e)=>setId(e.target.value)}
        style={{padding:10, width:"100%"}}
      />

      <button
        onClick={()=>router.push(`/match/${id}`)}
        style={{marginTop:10, padding:10, width:"100%"}}
      >
        Load Match
      </button>
    </div>
  );
}
