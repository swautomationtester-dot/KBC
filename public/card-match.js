const s=io({transports:["websocket","polling"],reconnection:true}),$=id=>document.getElementById(id);let role="",pid="",state=null,room="";
function show(id){document.querySelectorAll(".cmScreen").forEach(x=>x.classList.remove("active"));$(id).classList.add("active")}
function toast(t){let x=$("toast");x.textContent=t;x.classList.add("show");setTimeout(()=>x.classList.remove("show"),2200)}
function esc(x){return String(x||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function emit(type,data={}){s.emit(type,{...data,code:room})}
s.on("connect",()=>console.log("Card Match connected",s.id));s.on("connect_error",()=>toast("Game server connection failed."));
s.on("cm:room",d=>{role="tv";room=d.code;$("code").textContent=d.code;const joinUrl=String(d.joinUrl||"").replace(/^https?,\s*/i,"");$("url").textContent=joinUrl;$("qr").innerHTML="";if(window.QRCode)new QRCode($("qr"),{text:joinUrl,width:160,height:160});show("lobby")});
s.on("cm:joined",d=>{role="player";pid=d.playerId;room=d.code;show("game")});s.on("cm:error",d=>{
  toast(d.message);
  if(String(d.message||"").toLowerCase().includes("room not found")){
    show("joinPage");
    $("room").classList.add("expired");
    $("joinHint").textContent="That room has expired. Create a new TV game and use its new code.";
    $("room").focus();
  }
});s.on("cm:state",d=>{state=d;render()});
$("create").onclick=()=>emit("cm:create");$("newRoom").onclick=()=>{room="";$("room").classList.remove("expired");emit("cm:create")};$("join").onclick=()=>show("joinPage");$("back").onclick=()=>show("home");$("start").onclick=()=>{if(!room)return toast("Create a room first.");emit("cm:start",{code:room})};$("again").onclick=()=>emit("cm:restart",{code:room});
$("joinNow").onclick=()=>{let n=$("name").value.trim()||"Player",c=$("room").value.trim();if(!/^\d{4}$/.test(c))return toast("Enter the 4-digit room code.");room=c;emit("cm:join",{name:n})};
function render(){if(!state)return;if(state.status==="lobby"){show("lobby");$("players").innerHTML=state.players.map(p=>`<div class="cmPlayer"><b>${esc(p.name)}</b><small>Ready</small></div>`).join("");$("start").disabled=state.players.length<2;return}
if(state.status==="finished"){show("winner");$("winnerText").textContent=state.winner.length===1?state.winner[0]+" wins!":"It's a tie!";$("final").innerHTML=state.players.slice().sort((a,b)=>b.score-a.score).map(p=>`<div class="cmFinalRow"><b>${esc(p.name)}</b><small>${p.score} pair${p.score===1?"":"s"}</small></div>`).join("");return}
show("game");let cur=state.players[state.turn];$("turn").textContent=esc(cur?.name||"Player")+"'s turn";$("status").textContent=role==="player"&&cur?.id===pid?"Your turn — find a pair!":"Watch the board…";$("scores").innerHTML=state.players.map((p,i)=>`<div class="cmScore ${i===state.turn?"active":""}"><b>${esc(p.name)}</b><small>${p.score} pair${p.score===1?"":"s"}</small></div>`).join("");let open=new Set(state.flipped);
$("board").innerHTML=state.deck.map(c=>{let visible=open.has(c.id)||c.matched,ok=role==="player"&&cur?.id===pid&&!c.matched&&state.flipped.length<2;return `<div class="cmCard ${visible?"open ":""}${c.matched?"matched":""}" data-id="${c.id}" aria-disabled="${!ok}"><div class="cmInner"><div class="cmFace cmBack">✦</div><div class="cmFace cmFront">${c.icon}</div></div></div>`}).join("");
document.querySelectorAll(".cmCard").forEach(c=>c.onclick=()=>{if(c.getAttribute("aria-disabled")!=="true")emit("cm:flip",{cardId:+c.dataset.id})})}
const q=new URLSearchParams(location.search).get("join");
if(q&&/^\d{4}$/.test(q)){room=q;$("room").value=q;show("joinPage");$("joinHint").textContent="Room "+q+" — enter your name and join the TV game."; }