const cwSocket=io({transports:["websocket","polling"],reconnection:true});
const cw$=id=>document.getElementById(id);
let cwMe=localStorage.getItem("cwPlayerId")||null,cwToken=localStorage.getItem("cwPlayerToken")||null,cwState=null,cwCodeValue=new URLSearchParams(location.search).get("join")||"";
const cwShow=id=>document.querySelectorAll(".cwScreen").forEach(x=>x.classList.toggle("active",x.id===id));
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
function toast(t){const e=cw$("toast");e.textContent=t;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),2200)}
function send(type,data={}){cwSocket.emit(type,data)}
function renderPlayers(){
 const el=cw$("players"); if(!el)return;
 el.innerHTML=(cwState?.players||[]).map(p=>`<div class="cwPlayer"><span class="cwDot" style="background:${p.color}"></span><b>${esc(p.name)}</b>${p.id===cwMe?" <small>(you)</small>":""}</div>`).join("")||"<p>No players yet.</p>";
 cw$("playerCount").textContent=`${cwState?.players?.length||0}/4`;
}
function makeQr(el,url,size=135){el.innerHTML="";if(window.QRCode&&url)new QRCode(el,{text:url,width:size,height:size,colorDark:"#07191b",colorLight:"#ffffff"});}
let cwIsHost=false;
function setupRoom(msg){
 cwIsHost=true;
 cwCodeValue=msg.code;
 cw$("code").textContent=msg.code;
 cw$("joinUrl").textContent=msg.joinUrl;
 cw$("tvUrl").textContent=msg.tvUrl;
 cw$("tvLink").href=msg.tvUrl;
 const qr=cw$("qr"),tvqr=cw$("tvQr");
 if(qr){qr.innerHTML=""; if(msg.joinQr){const im=new Image();im.src=msg.joinQr;im.alt="Join QR";qr.appendChild(im)}else makeQr(qr,msg.joinUrl,130);}
 if(tvqr){tvqr.innerHTML=""; if(msg.tvQr){const im=new Image();im.src=msg.tvQr;im.alt="TV QR";tvqr.appendChild(im)}else makeQr(tvqr,msg.tvUrl,130);}
 cwShow("lobby");renderPlayers();
}
function render(){
 if(!cwState)return;
 renderPlayers();
 if(cwState.status==="lobby"){
   cwShow("lobby");
   cw$("start").classList.toggle("hidden",!cwIsHost);
   cw$("restart").classList.toggle("hidden",!cwIsHost);
   cw$("start").disabled=cwState.players.length<2;
   return;
 }
 if(cwState.status==="finished"){
   const w=cwState.players.find(p=>p.id===cwState.winner);cw$("winnerText").textContent=w?`${w.name} wins the Color War!`:"Color War complete";
   cw$("winnerSub").textContent="The TV screen has the final battle result. Start another round when you're ready.";
   cwShow("winner");return;
 }
 cwShow("game");
 const current=cwState.players[cwState.current];
 const me=cwState.players.find(p=>p.id===cwMe);
 cw$("identity").innerHTML=me?`<span class="cwDot" style="background:${me.color}"></span> ${esc(me.name)} • ${esc(me.color)}`:"Spectator";
 cw$("turn").textContent=current?`${current.name}'s turn`:"Waiting…";
 cw$("turnMeta").textContent=current?.id===cwMe?"Your move — choose an empty cell or your own color.":"Watch the TV for the live battle.";
 cw$("roomLabel").textContent=`ROOM ${cwState.code}`;
 cw$("status").textContent=current?.id===cwMe?"YOUR TURN":"WAITING FOR THE NEXT MOVE";
 cw$("scores").innerHTML=cwState.players.map(p=>{
   const cells=cwState.board.filter(c=>c.owner===p.id).length;
   return `<div class="cwScore ${p.id===current?.id?"active":""} ${p.eliminated?"muted":""}"><span class="cwDot" style="background:${p.color}"></span><b>${esc(p.name)}</b><small>${cells} cells</small></div>`;
 }).join("");
 cw$("board").innerHTML=cwState.board.map((c,i)=>{
   const p=cwState.players.find(x=>x.id===c.owner);const cls=p?colorClass(p.color):"";
   const orbs=p?Array.from({length:Math.min(c.count,4)},()=>`<span class="cwOrb" style="background:${p.color}"></span>`).join(""):"";
   return `<button class="cwCell ${cls}" data-i="${i}" ${current?.id!==cwMe||(![null,cwMe].includes(c.owner))?"disabled":""}><div class="cwOrbs">${orbs}</div>${c.count?`<span class="cwCount">${c.count}/${capacity(i)}</span>`:""}</button>`;
 }).join("");
 document.querySelectorAll(".cwCell").forEach(b=>b.onclick=()=>send("cw:move",{index:Number(b.dataset.i)}));
}
function capacity(i){const r=Math.floor(i/5),c=i%5;return((r===0||r===4)&&(c===0||c===4))?2:(r===0||r===4||c===0||c===4)?3:4}
function colorClass(hex){return {"#ff5c7a":"red","#20b7df":"blue","#7b61ff":"purple","#f2b84b":"yellow"}[hex]||""}
cwSocket.on("cw:room",setupRoom);
cwSocket.on("cw:joined",m=>{cwIsHost=false;cwMe=m.playerId;cwToken=m.playerToken||cwToken;localStorage.setItem("cwPlayerId",cwMe);if(cwToken)localStorage.setItem("cwPlayerToken",cwToken);cwCodeValue=m.code});
cwSocket.on("cw:state",s=>{cwState=s;render()});
cwSocket.on("cw:error",e=>toast(e.message||"Something went wrong"));
cwSocket.on("connect",()=>{
 const qs=new URLSearchParams(location.search);const join=qs.get("join");
 if(cwToken&&cwCodeValue&&!join)send("cw:resume",{code:cwCodeValue,token:cwToken,name:localStorage.getItem("cwPlayerName")||""});
 if(join){cw$("room").value=join;cw$("joinHint").textContent=`Room ${join} — enter your name and join.`;cwShow("joinPage")}
});
cw$("create").onclick=()=>send("cw:create");
cw$("join").onclick=()=>cwShow("joinPage");
cw$("back").onclick=()=>cwShow("home");
cw$("joinNow").onclick=()=>{const name=cw$("name").value.trim(),code=cw$("room").value.trim();if(!name||!/^\d{4}$/.test(code))return toast("Enter your name and 4-digit room code.");localStorage.setItem("cwPlayerName",name);send("cw:join",{code,name})};
cw$("start").onclick=()=>send("cw:start",{code:cwCodeValue});
cw$("restart").onclick=()=>send("cw:restart",{code:cwCodeValue});
cw$("again").onclick=()=>{cwShow("lobby");send("cw:restart",{code:cwCodeValue})};
cw$("refresh").onclick=()=>render();
cw$("leave").onclick=()=>{localStorage.removeItem("cwPlayerId");localStorage.removeItem("cwPlayerToken");location.href="/color-war.html"};
