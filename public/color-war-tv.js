const tvSocket=io({transports:["websocket","polling"],reconnection:true});
const tv$=id=>document.getElementById(id);
const params=new URLSearchParams(location.search),room=params.get("room"),token=params.get("token");
let state=null;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const cls=h=>({"#ff5c7a":"red","#20b7df":"blue","#7b61ff":"purple","#f2b84b":"yellow"}[h]||"");
function cap(i){const r=Math.floor(i/5),c=i%5;return((r===0||r===4)&&(c===0||c===4))?2:(r===0||r===4||c===0||c===4)?3:4}
function render(){
 if(!state)return;
 tv$("tvCode").textContent=state.code;
 tv$("tvRoom").textContent=`ROOM ${state.code}`;
 tv$("tvJoinQr").innerHTML="";
 if(state.joinQr){
   const im=new Image();im.src=state.joinQr;im.alt="Scan to join";tv$("tvJoinQr").appendChild(im);
 }else if(state.joinUrl&&window.QRCode){
   new QRCode(tv$("tvJoinQr"),{text:state.joinUrl,width:260,height:260,colorDark:"#07191b",colorLight:"#fff"});
 }
 tv$("tvRoster").innerHTML=state.players.map(p=>`<div class="cwTvPlayer"><span class="cwDot" style="background:${p.color}"></span> <b>${esc(p.name)}</b></div>`).join("")||"<div class=cwTvPlayer>Waiting for players…</div>";
 if(state.status==="lobby"){tv$("tvLobby").classList.remove("hidden");tv$("tvBattle").classList.add("hidden");tv$("tvWinner").classList.add("hidden");tv$("tvLobbyHint").textContent=state.players.length<2?"Waiting for at least 2 players…":"Players ready — host can start the battle.";return}
 if(state.status==="finished"){
   tv$("tvLobby").classList.add("hidden");tv$("tvBattle").classList.add("hidden");tv$("tvWinner").classList.remove("hidden");
   const w=state.players.find(p=>p.id===state.winner);tv$("tvWinnerText").textContent=w?`${w.name} WINS!`:"COLOR WAR COMPLETE";tv$("tvWinnerSub").textContent="The grid has been conquered.";
   tv$("tvFinalScores").innerHTML=state.players.map(p=>`<span class="cwLegend"><span class="cwDot" style="background:${p.color}"></span> ${esc(p.name)}</span>`).join("");return
 }
 tv$("tvLobby").classList.add("hidden");tv$("tvWinner").classList.add("hidden");tv$("tvBattle").classList.remove("hidden");
 const cur=state.players[state.current];tv$("tvTurn").textContent=cur?`${esc(cur.name)}'s TURN`:"LIVE BATTLE";
 tv$("tvLegend").innerHTML=state.players.map(p=>`<span class="cwLegend"><span class="cwDot" style="background:${p.color}"></span>${esc(p.name)}</span>`).join("");
 tv$("tvBoard").innerHTML=state.board.map((c,i)=>{const p=state.players.find(x=>x.id===c.owner);const orbs=p?Array.from({length:Math.min(c.count,4)},()=>`<span class="cwOrb" style="background:${p.color}"></span>`).join(""):"";return `<div class="cwTvCell ${p?cls(p.color):""}"><div class="cwOrbs">${orbs}</div>${c.count?`<span class="cwCount">${c.count}/${cap(i)}</span>`:""}</div>`}).join("");
 tv$("tvStatus").textContent=cur?`${esc(cur.name)} is playing`:"";
}
tvSocket.on("connect",()=>{if(room&&token)tvSocket.emit("cw:tv",{code:room,token})});
tvSocket.on("cw:state",s=>{state=s;render()});
tvSocket.on("cw:error",e=>{document.body.innerHTML=`<main style="padding:8vw;text-align:center;color:white;font-family:system-ui"><h1>TV link unavailable</h1><p>${esc(e.message)}</p></main>`});
tv$("fullscreen").onclick=()=>document.documentElement.requestFullscreen?.();
