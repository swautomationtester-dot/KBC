const s=io({transports:["websocket","polling"],reconnection:true,reconnectionAttempts:20,reconnectionDelay:700}),$=id=>document.getElementById(id);
let role="",pid="",playerToken="",tvToken="",state=null,room="";
const tokenKey=()=>`gamesarena_cardmatch_player_${room}`;
const tvKey=()=>`gamesarena_cardmatch_tv_${room}`;
function loadTokens(){
  if(!room)return;
  playerToken=localStorage.getItem(tokenKey())||"";
  tvToken=localStorage.getItem(tvKey())||"";
}
function requestResume(){
  if(!room)return;
  loadTokens();
  if(role==="player"&&playerToken) s.emit("cm:resume",{code:room,playerToken,name:$("name")?.value?.trim()||""});
  else if(role==="tv"&&tvToken) s.emit("cm:tv-resume",{code:room,tvToken});
}
function show(id){document.querySelectorAll(".cmScreen").forEach(x=>x.classList.remove("active"));$(id).classList.add("active")}
function toast(t){let x=$("toast");x.textContent=t;x.classList.add("show");clearTimeout(window._cmToast);window._cmToast=setTimeout(()=>x.classList.remove("show"),2600)}
function esc(x){return String(x||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function emit(type,data={}){s.emit(type,{...data,code:room})}
function current(){return state?.players?.[state.turn]||null}
function next(){return state?.nextTurn==null?null:state.players[state.nextTurn]||null}
s.on("connect",()=>{
  console.log("Card Match connected",s.id);
  if(room) requestResume();
});
s.on("connect_error",()=>toast("Game server connection failed — reconnecting…"));
s.on("cm:room",d=>{
  role="tv";room=d.code;tvToken=d.tvToken||tvToken;
  if(tvToken)localStorage.setItem(tvKey(),tvToken);
  $("code").textContent=d.code;
  const joinUrl=String(d.joinUrl||"").replace(/^https?,\s*/i,"");
  $("url").textContent=joinUrl;
  $("qr").innerHTML="";
  if(window.QRCode)new QRCode($("qr"),{text:joinUrl,width:160,height:160});
  show("lobby");
});
s.on("cm:joined",d=>{
  role="player";pid=d.playerId;room=d.code;playerToken=d.playerToken||playerToken;
  if(playerToken)localStorage.setItem(tokenKey(),playerToken);
  show("game");
});

s.on("cm:error",d=>{toast(d.message);if(String(d.message||"").toLowerCase().includes("room not found")){show("joinPage");$("room").classList.add("expired");$("joinHint").textContent="That room has expired. Create a new TV game and use its new code."}});
s.on("cm:state",d=>{state=d;render()});

$("create").onclick=()=>{role="";room="";tvToken="";emit("cm:create")};
$("join").onclick=()=>show("joinPage");
$("back").onclick=()=>show("home");
$("start").onclick=()=>{if(!room)return toast("Create a room first.");emit("cm:start",{code:room})};
$("restartGame").onclick=()=>{if(role==="tv")emit("cm:restart",{code:room});else toast("Only the TV can start a new game.")};
$("refreshGame").onclick=()=>{if(role==="tv")emit("cm:refresh",{code:room});else toast("Only the TV can refresh the board.")};
$("again").onclick=()=>{if(role==="tv")emit("cm:restart",{code:room});else toast("Only the TV can start a new game.")};
$("winnerRefresh").onclick=()=>{if(role==="tv")emit("cm:refresh",{code:room});else toast("Only the TV can refresh the board.")};
$("lobbyNew").onclick=()=>{role="";room="";tvToken="";emit("cm:create")};
$("newRoom").onclick=()=>{role="";room="";tvToken="";$("room").classList.remove("expired");emit("cm:create")};
$("joinNow").onclick=()=>{
 let n=$("name").value.trim()||"Player",c=$("room").value.trim();
 if(!/^\d{4}$/.test(c))return toast("Enter the 4-digit room code.");
 room=c;loadTokens();
 emit("cm:join",{name:n});
};

function render(){
 if(!state)return;

 // A valid playing state must contain the 16-card deck. If a reconnect
 // delivered a partial state, ask the server for the authoritative state
 // instead of leaving a blank board.
 if((state.status==="playing"||state.status==="finished") && (!Array.isArray(state.deck)||state.deck.length!==16)){
   $("board").innerHTML=`<div class="cmBoardLoading"><span>↻</span><b>Syncing game board…</b><small>Restoring the live cards</small></div>`;
   if(s.connected)requestResume();
   return;
 }

 if(state.status==="lobby"){
   show("lobby");
   $("players").innerHTML=(state.players||[]).map(p=>`<div class="cmPlayer" style="--player:${p.color}"><span class="playerDot"></span><div><b>${esc(p.name)}</b><small style="color:${p.color}">Ready to play</small></div></div>`).join("")||`<div class="cmEmpty">Waiting for players…</div>`;
   $("start").disabled=(state.players||[]).length<2;
   return;
 }

 if(state.status==="finished"){
   show("winner");
   $("winnerText").textContent=state.winner?.length===1?state.winner[0]+" wins!":"It's a tie!";
   $("final").innerHTML=(state.players||[]).slice().sort((a,b)=>b.score-a.score).map(p=>`<div class="cmFinalRow" style="border-left:4px solid ${p.color}"><b>${esc(p.name)}</b><small>${p.score} pair${p.score===1?"":"s"}</small></div>`).join("");
   return;
 }

 show("game");
 const players=state.players||[];
 const cur=players[state.turn]||null,nxt=state.nextTurn==null?null:players[state.nextTurn]||null;
 $("turn").innerHTML=`<span style="color:${cur?.color||"#fff"}">${esc(cur?.name||"Player")}</span>'s turn`;
 $("turnMeta").innerHTML=`<span class="nowPill">NOW</span> ${esc(cur?.name||"Player")} <span class="arrow">→</span> <span class="nextPill">NEXT</span> ${esc(nxt?.name||"—")}`;
 $("status").textContent=role==="player"&&cur?.id===pid?"Your turn — find a pair!":"Watch the board…";
 $("roomLabel").textContent=`Room ${state.code}`;

 $("scores").innerHTML=players.map((p,i)=>`<div class="cmScore ${i===state.turn?"active":""}" style="--player:${p.color}"><span class="scoreDot"></span><div><b>${esc(p.name)}</b><small>${i===state.turn?"PLAYING NOW":i===state.nextTurn?"NEXT UP":"WAITING"}</small></div><strong>${p.score}</strong></div>`).join("");

 $("turnStrip").innerHTML=players.map((p,i)=>`<div class="turnPlayer ${i===state.turn?"now":""} ${i===state.nextTurn?"next":""}" style="--player:${p.color}"><span class="playerDot"></span>${esc(p.name)}<small>${i===state.turn?"PLAYING NOW":i===state.nextTurn?"NEXT":"READY"}</small></div>`).join("");

 const currentEl=$("currentPlayer"),nextEl=$("nextPlayer"),currentDot=$("currentDot"),nextDot=$("nextDot");
 if(currentEl)currentEl.textContent=cur?.name||"—";
 if(nextEl)nextEl.textContent=nxt?.name||"—";
 if(currentDot)currentDot.style.setProperty("--player",cur?.color||"#20c997");
 if(nextDot)nextDot.style.setProperty("--player",nxt?.color||"#5c8dff");
 if($("sidePlayers"))$("sidePlayers").textContent=`${players.length}/4`;
 if($("sidePairs"))$("sidePairs").textContent=players.reduce((n,p)=>n+(p.score||0),0);
 if($("sideRoom"))$("sideRoom").textContent=state.code||"----";
 if($("sideScores"))$("sideScores").innerHTML=players.map(p=>`<div class="sideScoreRow"><span class="scoreDot" style="--player:${p.color}"></span><b>${esc(p.name)}</b><strong>${p.score}</strong></div>`).join("");

 const open=new Set(state.flipped||[]);
 $("board").innerHTML=state.deck.map(c=>{
   const visible=open.has(c.id)||c.matched;
   const ok=role==="player"&&cur?.id===pid&&!c.matched&&(state.flipped||[]).length<2;
   const ownerColor=c.matchedByColor||"";
   const ownerClass=ownerColor?` ownedPair`:"";
   const ownerStyle=ownerColor?` style="--pair-color:${ownerColor}"`:"";
   return `<button class="cmCard ${visible?"open ":""}${c.matched?"matched":""}${ownerClass}"${ownerStyle} data-id="${c.id}" aria-disabled="${!ok}" ${ok?"":"disabled"} title="${c.matched?"Matched pair":"Card"}">
     <span class="cmInner">
       <span class="cmFace cmBack"><img class="gaCardLogo" src="/assets/gamesarena-logo-premium.png" alt="GamesArena"></span>
       <span class="cmFace cmFront"><img src="${esc(c.image)}" alt="${esc(c.key||"memory card")}"></span>
     </span>
   </button>`;
 }).join("");

 document.querySelectorAll(".cmCard").forEach(c=>c.onclick=()=>{
   if(c.getAttribute("aria-disabled")!=="true")emit("cm:flip",{cardId:+c.dataset.id});
 });

 $("refreshGame").style.display=role==="tv"?"inline-flex":"none";
 $("restartGame").style.display=role==="tv"?"inline-flex":"none";
}

const q=new URLSearchParams(location.search).get("join");
if(q&&/^\d{4}$/.test(q)){
  room=q;loadTokens();
  $("room").value=q;show("joinPage");
  $("joinHint").textContent="Room "+q+" — enter your name and join the TV game.";
}
