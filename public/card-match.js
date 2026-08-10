const s=io({transports:["polling","websocket"],reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:500,reconnectionDelayMax:4000}),$=id=>document.getElementById(id);let role="",pid="",state=null,room="";
function show(id){document.querySelectorAll(".cmScreen").forEach(x=>x.classList.remove("active"));$(id).classList.add("active")}
function toast(t){let x=$("toast");x.textContent=t;x.classList.add("show");clearTimeout(window._cmToast);window._cmToast=setTimeout(()=>x.classList.remove("show"),2600)}
function esc(x){return String(x||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function emit(type,data={}){s.emit(type,{...data,code:room})}
function current(){return state?.players?.[state.turn]||null}
function next(){return state?.nextTurn==null?null:state.players[state.nextTurn]||null}
function renderQr(el,url,size=120){if(!el||!url)return;el.innerHTML="";if(window.QRCode)new QRCode(el,{text:url,width:size,height:size});}
s.on("connect",()=>console.log("Card Match connected",s.id));
s.on("connect_error",()=>toast("Game server connection failed."));
s.on("cm:room",d=>{role="tv";room=d.code;$("code").textContent=d.code;const joinUrl=String(d.joinUrl||"").replace(/^https?,\s*/i,"");$("url").textContent=joinUrl;$("qr").innerHTML="";renderQr($("qr"),joinUrl,160);$("homeCode").textContent=d.code;renderQr($("homeQr"),joinUrl,90);$("gameRoomCode").textContent=d.code;renderQr($("gameQr"),joinUrl,118);show("lobby")});
s.on("cm:joined",d=>{role="player";pid=d.playerId;room=d.code;show("game")});
s.on("cm:error",d=>{toast(d.message);if(String(d.message||"").toLowerCase().includes("room not found")){show("joinPage");$("room").classList.add("expired");$("joinHint").textContent="That room has expired. Create a new TV game and use its new code."}});
s.on("cm:state",d=>{state=d;render()});

$("create").onclick=()=>emit("cm:create");
$("join").onclick=()=>show("joinPage");
$("back").onclick=()=>show("home");
$("start").onclick=()=>{if(!room)return toast("Create a room first.");emit("cm:start",{code:room})};
$("restartGame").onclick=()=>{if(role==="tv")emit("cm:restart",{code:room});else toast("Only the TV can start a new game.")};
$("refreshGame").onclick=()=>{if(role==="tv")emit("cm:refresh",{code:room});else toast("Only the TV can refresh the board.")};
$("again").onclick=()=>{if(role==="tv")emit("cm:restart",{code:room});else toast("Only the TV can start a new game.")};
$("backGame")?.addEventListener("click",()=>show("home"));
$("copyGameCode")?.addEventListener("click",()=>{const c=state?.code||room;if(c)navigator.clipboard?.writeText(c).then(()=>toast("Room code copied"))});
$("winnerRefresh").onclick=()=>{if(role==="tv")emit("cm:refresh",{code:room});else toast("Only the TV can refresh the board.")};
$("lobbyNew").onclick=()=>{room="";emit("cm:create")};
$("newRoom").onclick=()=>{room="";$("room").classList.remove("expired");emit("cm:create")};
$("joinNow").onclick=()=>{let n=$("name").value.trim()||"Player",c=$("room").value.trim();if(!/^\d{4}$/.test(c))return toast("Enter the 4-digit room code.");room=c;emit("cm:join",{name:n})};


function playerRow(p,i){
 const label=i===state.turn?"Playing Now":i===state.nextTurn?"Next Player":"Waiting for player…";
 return `<div class="cmPlayerRow ${i===state.nextTurn?"next":""}" style="--player:${p.color}"><span class="playerAvatar">●</span><b>${esc(p.name)}</b><small>${label}</small></div>`;
}
function statusRow(p,label,tag){
 return `<div class="statusRow" style="--player:${p.color}"><span class="statusAvatar"></span><div><b>${esc(p.name)}</b><small>${label}</small></div><span class="statusTag ${tag==="Next Player"?"next":""}">${tag}</span></div>`;
}

function render(){
 if(!state)return;
 const hp=document.getElementById("homePlayers");
 if(hp){
   hp.innerHTML=state.players.map((p,i)=>playerRow(p,i)).join("")+
     Array.from({length:4-state.players.length},()=>`<div class="cmPlayerRow"><span class="playerAvatar" style="background:transparent;border:1px dashed #607b7d"></span><b style="color:#91aaa8">Waiting for player…</b></div>`).join("");
   document.getElementById("playerCount").textContent=`(${state.players.length} / 4)`;
   const now=state.players[state.turn], nxt=state.nextTurn==null?null:state.players[state.nextTurn];
   document.getElementById("homeNow").textContent=now?.name||"Waiting for players";
   document.getElementById("homeNext").textContent=nxt?.name||"—";
 }
 const hc=document.getElementById("homeCode"); if(hc)hc.textContent=state.code||"----";
 if(state.status==="lobby"){show("lobby");$("players").innerHTML=state.players.map(p=>`<div class="cmPlayer" style="--player:${p.color}"><span class="playerDot"></span><div><b>${esc(p.name)}</b><small style="color:${p.color}">Ready to play</small></div></div>`).join("");$("start").disabled=state.players.length<2;return}
 if(state.status==="finished"){show("winner");$("winnerText").textContent=state.winner.length===1?state.winner[0]+" wins!":"It's a tie!";$("final").innerHTML=state.players.slice().sort((a,b)=>b.score-a.score).map(p=>`<div class="cmFinalRow" style="border-left:4px solid ${p.color}"><b>${esc(p.name)}</b><small>${p.score} pair${p.score===1?"":"s"}</small></div>`).join("");return}
 show("game");
 const cur=current(),nxt=next();
 $("turn").innerHTML=cur?`<span style="color:${cur.color}">${esc(cur.name)}'s turn</span>`:"Waiting for players…";
 $("turnSub").textContent=cur?(role==="player"&&cur.id===pid?"Your turn — find a pair!":"Watch the board and follow the active player."):"Share the room code or scan QR to join.";
 $("gameRoomCode").textContent=state.code||room||"----";
 $("gameNow").textContent=cur?.name||"Waiting for players";
 $("gameNext").textContent=nxt?.name||"—";
 $("gamePlayerCount").textContent=`(${state.players.length} / 4)`;
 const gp=$("gamePlayersPanel");
 if(gp)gp.innerHTML=state.players.map((p,i)=>playerRow(p,i)).join("")+
   Array.from({length:4-state.players.length},()=>`<div class="cmPlayerRow empty"><span class="playerAvatar"></span><b>Waiting for player…</b></div>`).join("");
 const joinUrl=`${location.origin}/card-match.html?join=${encodeURIComponent(state.code||room)}`;
 renderQr($("gameQr"),joinUrl,118);
 $("turnMeta")?.remove();
 $("status").textContent=role==="player"&&cur?.id===pid?"Your turn — find a pair!":"Watch the board…";
 $("roomLabel").textContent=`Room ${state.code}`;
 $("scores").innerHTML=state.players.map((p,i)=>`<div class="cmScore ${i===state.turn?"active":""}" style="--player:${p.color}"><span class="scoreDot"></span><div><b>${esc(p.name)}</b><small>${i===state.turn?"PLAYING NOW":i===state.nextTurn?"NEXT UP":"WAITING"}</small></div><strong>${p.score}</strong></div>`).join("");
 $("turnStrip").innerHTML=state.players.map((p,i)=>`<div class="turnPlayer ${i===state.turn?"now":""} ${i===state.nextTurn?"next":""}" style="--player:${p.color}"><span class="playerDot"></span>${esc(p.name)}<small>${i===state.turn?"PLAYING NOW":i===state.nextTurn?"NEXT":"READY"}</small></div>`).join("");
 $("gamePlayers").textContent=`${state.players.length} / 4`;
 $("gamePairs").textContent=state.players.reduce((a,p)=>a+p.score,0);
 $("gameStatus").textContent=state.status==="playing"?"Playing":"Ready";
 const tsp=$("turnStatusPanel"), sp=$("scorePanel");
 if(tsp)tsp.innerHTML=cur?statusRow(cur,"Current Turn","Playing Now")+(nxt?statusRow(nxt,"Next Turn","Next Player"):""):"";
 if(sp)sp.innerHTML=state.players.slice().sort((a,b)=>b.score-a.score).map(p=>`<div class="scoreRow" style="--player:${p.color}"><span class="statusAvatar"></span><div><b>${esc(p.name)}</b><small>${p.score} pair${p.score===1?"":"s"}</small></div><strong>${p.score}</strong></div>`).join("");

 let open=new Set(state.flipped);
 $("board").innerHTML=state.deck.map(c=>{
  const visible=open.has(c.id)||c.matched;
  const ok=role==="player"&&cur?.id===pid&&!c.matched&&state.flipped.length<2;
  const ownerClass=c.matchedByColor==="\#ff5c7a"?"matched-red":c.matchedByColor==="\#5c8dff"?"matched-blue":c.matchedByColor==="\#20c997"?"matched-green":c.matchedByColor==="\#ffb020"?"matched-gold":"";
  const ownerName=state.players.find(p=>p.id===c.matchedBy)?.name||"";
  return `<button class="cmCard ${visible?"open ":""}${c.matched?"matched ":""}${ownerClass}" data-id="${c.id}" aria-label="${c.matched?`Matched pair by ${esc(ownerName)}`:"Memory card"}" aria-disabled="${!ok}" ${ok?"":"disabled"}>
    <span class="cmInner">
      <span class="cmFace cmBack">
        <img src="/assets/gamesarena-logo-premium.png" alt="GamesArena">
        <span class="cardBackGlow" aria-hidden="true"></span>
      </span>
      <span class="cmFace cmFront"><img src="${c.image}" alt=""></span>
    </span>
  </button>`;
}).join("");
 document.querySelectorAll(".cmCard").forEach(c=>c.onclick=()=>{if(c.getAttribute("aria-disabled")!=="true")emit("cm:flip",{cardId:+c.dataset.id})});
 $("refreshGame").style.display=role==="tv"?"inline-flex":"none";$("restartGame").style.display=role==="tv"?"inline-flex":"none";
}
const q=new URLSearchParams(location.search).get("join");if(q&&/^\d{4}$/.test(q)){room=q;$("room").value=q;show("joinPage");$("joinHint").textContent="Room "+q+" — enter your name and join the TV game."}

$("copyHomeCode")?.addEventListener("click",()=>{const c=state?.code||room;if(c)navigator.clipboard?.writeText(c).then(()=>toast("Room code copied"))});
