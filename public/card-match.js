const s=io({transports:["websocket","polling"],reconnection:true}),$=id=>document.getElementById(id);let role="",pid="",state=null,room="";
function show(id){document.querySelectorAll(".cmScreen").forEach(x=>x.classList.remove("active"));$(id).classList.add("active")}
function toast(t){let x=$("toast");x.textContent=t;x.classList.add("show");clearTimeout(window._cmToast);window._cmToast=setTimeout(()=>x.classList.remove("show"),2600)}
function esc(x){return String(x||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function emit(type,data={}){s.emit(type,{...data,code:room})}
function current(){return state?.players?.[state.turn]||null}
function next(){return state?.nextTurn==null?null:state.players[state.nextTurn]||null}
s.on("connect",()=>console.log("Card Match connected",s.id));
s.on("connect_error",()=>toast("Game server connection failed."));
s.on("cm:room",d=>{role="tv";room=d.code;$("code").textContent=d.code;const joinUrl=String(d.joinUrl||"").replace(/^https?,\s*/i,"");$("url").textContent=joinUrl;$("qr").innerHTML="";if(window.QRCode)new QRCode($("qr"),{text:joinUrl,width:160,height:160});show("lobby")});
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
$("winnerRefresh").onclick=()=>{if(role==="tv")emit("cm:refresh",{code:room});else toast("Only the TV can refresh the board.")};
$("lobbyNew").onclick=()=>{room="";emit("cm:create")};
$("newRoom").onclick=()=>{room="";$("room").classList.remove("expired");emit("cm:create")};
$("joinNow").onclick=()=>{let n=$("name").value.trim()||"Player",c=$("room").value.trim();if(!/^\d{4}$/.test(c))return toast("Enter the 4-digit room code.");room=c;emit("cm:join",{name:n})};

function render(){
 if(!state)return;
 if(state.status==="lobby"){show("lobby");$("players").innerHTML=state.players.map(p=>`<div class="cmPlayer" style="--player:${p.color}"><span class="playerDot"></span><div><b>${esc(p.name)}</b><small style="color:${p.color}">Ready to play</small></div></div>`).join("");$("start").disabled=state.players.length<2;return}
 if(state.status==="finished"){show("winner");$("winnerText").textContent=state.winner.length===1?state.winner[0]+" wins!":"It's a tie!";$("final").innerHTML=state.players.slice().sort((a,b)=>b.score-a.score).map(p=>`<div class="cmFinalRow" style="border-left:4px solid ${p.color}"><b>${esc(p.name)}</b><small>${p.score} pair${p.score===1?"":"s"}</small></div>`).join("");return}
 show("game");
 const cur=current(),nxt=next();
 $("turn").innerHTML=`<span style="color:${cur?.color||"#fff"}">${esc(cur?.name||"Player")}</span>'s turn`;
 $("turnMeta").innerHTML=`<span class="nowPill">NOW</span> ${esc(cur?.name||"Player")} <span class="arrow">→</span> <span class="nextPill">NEXT</span> ${esc(nxt?.name||"—")}`;
 $("status").textContent=role==="player"&&cur?.id===pid?"Your turn — find a pair!":"Watch the board…";
 $("roomLabel").textContent=`Room ${state.code}`;
 $("scores").innerHTML=state.players.map((p,i)=>`<div class="cmScore ${i===state.turn?"active":""}" style="--player:${p.color}"><span class="scoreDot"></span><div><b>${esc(p.name)}</b><small>${i===state.turn?"PLAYING NOW":i===state.nextTurn?"NEXT UP":"WAITING"}</small></div><strong>${p.score}</strong></div>`).join("");
 $("turnStrip").innerHTML=state.players.map((p,i)=>`<div class="turnPlayer ${i===state.turn?"now":""} ${i===state.nextTurn?"next":""}" style="--player:${p.color}"><span class="playerDot"></span>${esc(p.name)}<small>${i===state.turn?"PLAYING NOW":i===state.nextTurn?"NEXT":"READY"}</small></div>`).join("");
 let open=new Set(state.flipped);
 $("board").innerHTML=state.deck.map(c=>{let visible=open.has(c.id)||c.matched,ok=role==="player"&&cur?.id===pid&&!c.matched&&state.flipped.length<2;return `<button class="cmCard ${visible?"open ":""}${c.matched?"matched":""}" data-id="${c.id}" aria-disabled="${!ok}" ${ok?"":"disabled"}><span class="cmInner"><span class="cmFace cmBack"><span class="backMark">✦</span></span><span class="cmFace cmFront"><img src="${c.image}" alt=""></span></span></button>`}).join("");
 document.querySelectorAll(".cmCard").forEach(c=>c.onclick=()=>{if(c.getAttribute("aria-disabled")!=="true")emit("cm:flip",{cardId:+c.dataset.id})});
 $("refreshGame").style.display=role==="tv"?"inline-flex":"none";$("restartGame").style.display=role==="tv"?"inline-flex":"none";
}
const q=new URLSearchParams(location.search).get("join");if(q&&/^\d{4}$/.test(q)){room=q;$("room").value=q;show("joinPage");$("joinHint").textContent="Room "+q+" — enter your name and join the TV game."}
