const $=id=>document.getElementById(id);
let sock=null,room="",role="",pid="",hold=null,playerToken="",hostToken="",state=null;
function show(id){["home","joinPage","lobby","controller"].forEach(x=>$(x)?.classList.toggle("hidden",x!==id));}
function toast(t){const x=$("toast");if(!x){$("msg").textContent=t;return}x.textContent=t;x.classList.add("show");clearTimeout(window._rt);window._rt=setTimeout(()=>x.classList.remove("show"),2800);}
function esc(x){return String(x||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
function keyPlayer(){return `gamesarena_runner_player_${room}`;} function keyHost(){return `gamesarena_runner_host_${room}`;}
function connect(){
 if(sock&&sock.connected)return;
 sock=io("/runner",{transports:["websocket","polling"],reconnection:true,reconnectionAttempts:30,reconnectionDelay:700});
 sock.on("connect",()=>{
  const savedRoom=localStorage.getItem("gaRunnerRoom")||"",targetRoom=room||savedRoom;
  const canResume=Boolean(targetRoom&&savedRoom===targetRoom);
  const savedPlayer=canResume?localStorage.getItem(`gamesarena_runner_player_${targetRoom}`):"";
  const savedHost=canResume?localStorage.getItem(`gamesarena_runner_host_${targetRoom}`):"";
  const savedName=localStorage.getItem("gaRunnerName")||$("name")?.value.trim()||"Player";
  if(canResume&&savedHost)sock.emit("resumeHost",{room:targetRoom,hostToken:savedHost,playerToken:savedPlayer,name:savedName});
  else if(canResume&&savedPlayer)sock.emit("resumePlayer",{room:targetRoom,playerToken:savedPlayer,name:savedName});
 });
 sock.on("connect_error",()=>toast("Connection problem — retrying…"));
 sock.on("joined",m=>{
  room=m.room;role=m.host?"host":"player";pid=m.playerId||sock.id;playerToken=m.playerToken||playerToken;hostToken=m.hostToken||hostToken;
  if(playerToken)localStorage.setItem(`gamesarena_runner_player_${room}`,playerToken);if(hostToken)localStorage.setItem(`gamesarena_runner_host_${room}`,hostToken);
  localStorage.setItem("gaRunnerRoom",room);localStorage.setItem("gaRunnerName",$("name")?.value.trim()||"Player");
  if(m.joinUrl)setQr("qr",m.joinUrl),$("joinUrl").href=m.joinUrl;
  if(m.tvUrl)setQr("tvQr",m.tvUrl),$("tvUrl").href=m.tvUrl;
  $("code").textContent=room;show("lobby");
 });
 sock.on("state",s=>{state=s;render();});
 sock.on("errorMsg",m=>{toast(m);$("joinMsg").textContent=m;$("msg").textContent=m;});
}
function setQr(id,url){const el=$(id);if(!el||!url)return;el.innerHTML="";if(window.QRCode)new QRCode(el,{text:url,width:170,height:170,colorDark:"#073f43",colorLight:"#fff"});}
function saveName(){localStorage.setItem("gaRunnerName",$("name").value.trim()||"Player");}
function createGame(){
 const name=$("name").value.trim()||"Host";saveName();localStorage.removeItem("gaRunnerRoom");room="";role="";playerToken="";hostToken="";connect();
 if(sock.connected)sock.emit("create",{name});else sock.once("connect",()=>sock.emit("create",{name}));
}
function joinGame(){
 const name=$("name").value.trim();if(!name)return $("joinMsg").textContent="Enter your name.";
 const code=$("room").value.trim().toUpperCase();if(!/^\d{4}$/.test(code))return $("joinMsg").textContent="Enter the 4-digit room code.";
 saveName();room=code;connect();if(sock.connected)sock.emit("join",{room,name});else sock.once("connect",()=>sock.emit("join",{room,name}));
}
$("create").onclick=()=>{show("joinPage");$("joinHint").textContent="Enter your name, then create the room. You will become the Host and can also play.";$("room").value="";$("join").textContent="CREATE ROOM";$("join").dataset.mode="create";};
$("showJoin").onclick=()=>{show("joinPage");$("join").textContent="JOIN";$("join").dataset.mode="join";};
$("back").onclick=()=>show("home");
$("join").onclick=()=>$("join").dataset.mode==="create"?createGame():joinGame();
$("start").onclick=()=>{if(role!=="host")return toast("Only the Host can start the race.");sock.emit("start");};
$("newRoom").onclick=()=>{localStorage.removeItem(`gamesarena_runner_player_${room}`);localStorage.removeItem(`gamesarena_runner_host_${room}`);localStorage.removeItem("gaRunnerRoom");show("home");};
function render(s){
 if(!s)return;
 if(s.phase==="lobby"){show("lobby");$("code").textContent=s.code;$("players").innerHTML=(s.players||[]).map(p=>`<div class="cmP" style="--c:${p.color}"><i></i><b>${esc(p.name)}</b><small>${p.id===pid?"YOU":""}</small></div>`).join("")||`<div class="cmP">Waiting for players…</div>`;$("start").style.display=role==="host"?"":"none";$("lobbyMsg").textContent=role==="host"?"Put the Runner TV on the big screen, then wait for everyone to join.":"Registered. Waiting for the Host to start.";return;}
 show("controller");const me=(s.players||[]).find(p=>p.id===pid);if(me){$("me").textContent=me.name;$("dot").style.background=me.color;}$("timer").textContent=fmt(s.elapsed);$("status").textContent=s.winner?`🏆 ${esc(s.winner.name)} reached the finish first!`:s.phase==="race"?"Race live — keep running!":"Race finished.";
}
function fmt(ms){let n=Math.floor((ms||0)/1000);return `${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`;}
function input(x){if(sock?.connected)sock.emit("input",{x});}
function holdDir(x){input(x);clearInterval(hold);hold=setInterval(()=>input(x),60);} function release(){clearInterval(hold);hold=null;input(0);}
for(const [id,x] of [["left",-1],["right",1]]){const b=$(id);b.addEventListener("pointerdown",e=>{e.preventDefault();holdDir(x)});["pointerup","pointercancel","pointerleave"].forEach(ev=>b.addEventListener(ev,release));}
$("jump").addEventListener("pointerdown",e=>{e.preventDefault();sock?.emit("input",{x:0,jump:true});});
const q=new URLSearchParams(location.search).get("join");if(q&&/^\d{4}$/.test(q)){show("joinPage");$("join").dataset.mode="join";$("join").textContent="JOIN";$("room").value=q;$("joinHint").textContent=`Room ${q} — enter your name and join the Runner.`;}
const savedName=localStorage.getItem("gaRunnerName");if(savedName)$("name").value=savedName;