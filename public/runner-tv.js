const canvas=document.getElementById("game"),ctx=canvas.getContext("2d");let params=new URLSearchParams(location.search),sock=io("/runner"),room=params.get("room")||"",token=params.get("token")||"",state=null,cam=0;
function resize(){canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)}addEventListener("resize",resize);resize();
function findRoom(){if(room)sock.emit("tv",{room,token});}
sock.on("connect",findRoom);
sock.on("waitingForRoom",m=>{document.getElementById("room").textContent=`WAITING • ROOM ${m.room||room}`;setTimeout(findRoom,2000);});
sock.on("joined",m=>{room=m.room;document.getElementById("tvJoin").classList.add("hidden")});
sock.on("state",s=>{state=s;document.getElementById("room").textContent="ROOM "+s.code;render()});
sock.on("errorMsg",m=>{document.getElementById("room").textContent=m;setTimeout(findRoom,2500);});
function render(){if(!state)return;const W=innerWidth,H=innerHeight;cam=Math.max(0,Math.min(3200-W,(state.players.find(p=>!p.finished)||state.players[0])?.x-W*.35||0));ctx.clearRect(0,0,W,H);
const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,"#75d6dd");grad.addColorStop(.55,"#2d8991");grad.addColorStop(1,"#0a3d45");ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
drawCloud(280-cam*.2,120);drawCloud(900-cam*.2,180);drawCloud(1900-cam*.2,110);
ctx.save();ctx.translate(-cam,0);
for(const p of state.platforms){ctx.fillStyle="#174b43";ctx.fillRect(p.x,p.y,p.w,p.h);ctx.fillStyle="#5cd66e";ctx.fillRect(p.x,p.y,p.w,7)}
for(const c of state.coins)if(!c.taken){ctx.fillStyle="#ffd85b";ctx.beginPath();ctx.arc(c.x,c.y,12,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#fff0a0";ctx.lineWidth=3;ctx.stroke()}
ctx.fillStyle="#f1cc5d";ctx.fillRect(state.finish.x,state.finish.y-150,8,150);ctx.fillStyle="#fff";ctx.beginPath();ctx.moveTo(state.finish.x+8,state.finish.y-150);ctx.lineTo(state.finish.x+90,state.finish.y-120);ctx.lineTo(state.finish.x+8,state.finish.y-90);ctx.fill();
for(const p of state.players)drawPlayer(p);ctx.restore();
document.getElementById("timer").textContent=fmt(state.elapsed);renderLB();
if(state.phase==="race")document.getElementById("countdown").textContent="";
if(state.phase==="finished"&&state.winner){document.getElementById("finish").classList.remove("hidden");document.getElementById("finish").innerHTML=`<div class="finishBox"><div style="font-size:18px;color:#f1cc5d">🏆 WINNER</div><h1>${esc(state.winner.name)}</h1><p>Reached the finish first with ${state.winner.coins} coins.</p><p>${fmt(state.winner.time)}</p></div>`}else document.getElementById("finish").classList.add("hidden");
}
function drawPlayer(p){ctx.save();ctx.translate(p.x,p.y);ctx.fillStyle=p.color;round(-25,-38,50,44,12);ctx.fill();ctx.fillStyle="#ffe5c7";ctx.beginPath();ctx.arc(0,-47,17,0,Math.PI*2);ctx.fill();ctx.fillStyle="#12383b";ctx.beginPath();ctx.arc(-6,-50,3,0,Math.PI*2);ctx.arc(6,-50,3,0,Math.PI*2);ctx.fill();ctx.fillStyle="#f1cc5d";ctx.fillRect(-19,-1,38,8);ctx.restore();ctx.fillStyle="#fff";ctx.font="700 13px Arial";ctx.textAlign="center";ctx.fillText(p.name,p.x,p.y-70)}
function round(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.closePath()}function drawCloud(x,y){ctx.fillStyle="#ffffffaa";for(const [dx,dy,rr] of [[0,10,30],[35,0,40],[75,12,28],[110,8,20]]){ctx.beginPath();ctx.arc(x+dx,y+dy,rr,0,Math.PI*2);ctx.fill()}}
function renderLB(){const el=document.getElementById("leaderboard");const ps=[...state.players].sort((a,b)=>((b.x||0)-(a.x||0)));el.innerHTML=ps.map((p,i)=>`<div class="lb" style="--c:${p.color}"><i></i><b>${i+1}. ${esc(p.name)}</b><small>${p.coins} 🪙</small></div>`).join("")}
function fmt(ms){let n=Math.floor((ms||0)/1000);return `${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`}function esc(x){return String(x||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}