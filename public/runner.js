const $=id=>document.getElementById(id);
let sock=null,room="",role="",pid="",hold=null;

function show(id){
  ["join","lobby","controller"].forEach(x=>$(x).classList.toggle("hidden",x!==id));
}
function connect(){
  sock=io("/runner",{transports:["websocket","polling"],reconnection:true});
  sock.on("connect_error",e=>{$("msg").textContent="Connection problem — retrying…";});
  sock.on("waitingForRoom",m=>{$("msg").textContent=m.message||"Waiting for the Host…";});

  sock.on("reconnect",()=>{
  const saved=localStorage.getItem("gaRunnerRoom");
  const name=localStorage.getItem("gaRunnerName")||$("name").value.trim()||"Player";
  if(saved) sock.emit("resume",{room:saved,name});
});
sock.on("joined",m=>{
    room=m.room; role=m.host?"host":"player"; pid=sock.id; localStorage.setItem("gaRunnerRoom",room); localStorage.setItem("gaRunnerName",$("name").value.trim()||"Player");
    $("code").textContent=room; show("lobby");
  });
  sock.on("state",render);
  sock.on("errorMsg",m=>{
    $("msg").textContent=m;
    $("status").textContent=m;
  });
}
function join(kind){
  const name=$("name").value.trim();
  if(!name)return $("msg").textContent="Enter your name.";
  connect();
  sock.once("connect",()=>{
  const code=kind==="join"?$("room").value.trim():$("room").value.trim();
  if(kind==="create") sock.emit("create",{name});
  else sock.emit("join",{name,room:code});
});
}
const savedRoom=localStorage.getItem("gaRunnerRoom");
const savedName=localStorage.getItem("gaRunnerName");
if(savedName) $("name").value=savedName;
if(savedRoom) $("room").value=savedRoom;

$("create").onclick=()=>{
  localStorage.removeItem("gaRunnerRoom");
  localStorage.removeItem("gaRunnerName");
  join("create");
};
$("join").onclick=()=>join("join");
$("start").onclick=()=>sock.emit("start");

function render(s){
  if(s.phase==="lobby"){
    show("lobby");
    $("players").innerHTML=s.players.map(p=>
      `<div class="cmP" style="--c:${p.color}"><i></i><b>${esc(p.name)}</b><small>${p.id===pid?"YOU":""}</small></div>`
    ).join("");
    $("start").style.display=role==="host"?"":"none";
    $("lobbyMsg").innerHTML=role==="host"
      ?`Start when everyone is ready. TV screen: <a href="/runner-tv.html?room=${room}" target="_blank">Open Runner TV ↗</a>`
      :"Waiting for the Host to start the race.";
    return;
  }
  show("controller");
  const me=s.players.find(p=>p.id===pid);
  if(me){$("me").textContent=me.name;$("dot").style.background=me.color;}
  $("timer").textContent=fmt(s.elapsed);
  if(s.winner)$("status").textContent=`🏆 ${s.winner.name} reached the finish first!`;
}
function fmt(ms){
  let n=Math.floor(ms/1000);
  return `${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`;
}
function input(x){
  if(sock?.connected)sock.emit("input",{x});
}
function holdDir(x){
  input(x);clearInterval(hold);hold=setInterval(()=>input(x),60);
}
function release(){
  clearInterval(hold);hold=null;input(0);
}
for(const [id,x] of [["left",-1],["right",1]]){
  const b=$(id);
  b.addEventListener("pointerdown",e=>{e.preventDefault();holdDir(x)});
  ["pointerup","pointercancel","pointerleave"].forEach(ev=>b.addEventListener(ev,release));
}
$("jump").addEventListener("pointerdown",e=>{
  e.preventDefault();sock?.emit("input",{x:0,jump:true});
});
function esc(x){
  return String(x).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}
