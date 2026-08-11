const $=id=>document.getElementById(id);
let sock=null,room="",role="",pid="",hold=null;

function show(id){
  ["join","lobby","controller"].forEach(x=>$(x).classList.toggle("hidden",x!==id));
}
function connect(){
  sock=io("/runner");
  sock.on("joined",m=>{
    room=m.room; role=m.host?"host":"player"; pid=sock.id;
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
  sock.once("connect",()=>sock.emit(kind,kind==="join"?{name,room:$("room").value.trim()}:{name}));
}
$("create").onclick=()=>join("create");
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
