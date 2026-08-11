const s=io({transports:["websocket","polling"],reconnection:true,reconnectionAttempts:10,reconnectionDelay:500});
s.on("connect",()=>addCls(document.documentElement,"tvConnected"));
s.on("disconnect",()=>removeCls(document.documentElement,"tvConnected"));
const $=id=>document.getElementById(id);
const addCls=(el,...c)=>{if(el?.classList)el.classList.add(...c)};
const removeCls=(el,...c)=>{if(el?.classList)el.classList.remove(...c)};
let room=new URLSearchParams(location.search).get("room");
const screenToken=location.pathname.startsWith("/screen/")?decodeURIComponent(location.pathname.split("/")[2]||""):"";
async function resolveScreen(){
 if(room){window.__tvRoomCode=room;return room;}
 if(!screenToken)return prompt("Enter room code");
 try{
   const r=await fetch(`/api/screen/${encodeURIComponent(screenToken)}`);
   const d=await r.json();
   if(!r.ok)throw new Error(d.error||"Screen link expired");
   room=d.roomCode;
   window.__tvRoomCode=room;
   return room;
 }catch(e){document.body.innerHTML=`<main style="padding:40px;text-align:center"><h1>Screen link unavailable</h1><p>${e.message}</p><p>Please ask the host to create a new room.</p></main>`;throw e}
}
let soundOn=true,audioCtx=null,lastPhase="",lastQuestion=-1,fastTimer=null,tvUniqueUrl="";
let questionAudio=null;
function playQuestionAudio(questionIndex){
  try{
    if(!questionAudio){questionAudio=new Audio("/assets/kbc-question.mp3");questionAudio.preload="auto";questionAudio.volume=0.85;}
    questionAudio.currentTime=0;
    questionAudio.play().catch(()=>{});
  }catch(e){}
}
const prizes=[10,20,30,40,50];
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}


function renderParticipants(x){
 const el=$("registrationGrid");
 const side=$("participantGrid");
 const users=(x.users||[]).slice(0,30);
 if(side)side.innerHTML="";
 if(!el)return;
 if(!users.length){el.innerHTML="<div class=muted>No registrations yet.</div>";return}
 el.innerHTML=users.map((u,i)=>{
   const selected=(x.pool||[]).some(p=>p.id===u.id);
   return `<div class="registrationPlayer ${selected?"selected":""}" data-id="${u.id}">
     <span class="registrationNum">${i+1}</span><b>${escapeHtml(u.name||"Player")}</b>
     ${selected?'<span class="selectedMark">✓</span>':""}
   </div>`;
 }).join("");
}

function renderTvQuestion(x){
 const removed=new Set((x.fiftyFiftyRemoved||[]).map(Number));
 const options=x.question.options.map((o,i)=>removed.has(i)?`<div class="fiftyRemoved"><b>${String.fromCharCode(65+i)}</b><span>OPTION REMOVED</span></div>`:`<div><b>${String.fromCharCode(65+i)}</b><span>${escapeHtml(o)}</span></div>`).join("");
 $("tvmain").innerHTML=`<div class="questionScreen ${x.current===4?"finalQuestion":""}"><div class=qmeta><span>QUESTION ${x.current+1} OF ${(x.totalQuestions||5)}</span><span>${escapeHtml(x.question.category||"General Knowledge")}</span><span>₹${Number(x.question.points||0).toLocaleString("en-IN")}</span><strong id="tvQuestionTimer" class="tvQuestionTimer">30.0s</strong></div>${x.current===1?'<div class="finalBadge">🛡️ SAFE HAVEN • ₹20</div>':x.current===3?'<div class="finalBadge">🛡️ SAFE HAVEN • ₹40</div>':x.current===4?'<div class="finalBadge">🏆 FINAL QUESTION • ₹50</div>':""}<h1>${escapeHtml(x.question.text)}</h1><div class=tvopts>${options}</div></div>`;
 updateTvQuestionTimer(x);
}
let tvQuestionClock=null;
function updateTvQuestionTimer(x){clearInterval(tvQuestionClock);const paint=()=>{const el=$("tvQuestionTimer");if(!el)return;let ms=Number(x.questionTimerRemaining||0);if(x.questionTimerRunning&&x.questionTimerStartAt)ms=Math.max(0,ms-(Date.now()-x.questionTimerStartAt));el.textContent=x.questionTimerPaused?`PAUSED • ${(ms/1000).toFixed(1)}s`:`${(ms/1000).toFixed(1)}s`;el.classList.toggle("paused",!!x.questionTimerPaused);};paint();if(x.questionTimerRunning)tvQuestionClock=setInterval(paint,100);}
function applyTv5050(x){const panel=document.querySelector(".questionScreen");if(!panel)return;const removed=new Set((x.fiftyFiftyRemoved||[]).map(Number));panel.querySelectorAll(".tvopts > div").forEach((el,i)=>{if(removed.has(i)){el.classList.add("fiftyRemoved");el.querySelector("span").textContent="OPTION REMOVED";}else{el.classList.remove("fiftyRemoved");if(x.question?.options?.[i])el.querySelector("span").textContent=x.question.options[i];}});updateTvQuestionTimer(x);}
function scheduleTvReload(reason){
 const room=window.__tvRoomCode||"tv";
 const key=`tvReload:${room}:${reason}`;
 if(sessionStorage.getItem(key)==="done")return;
 sessionStorage.setItem(key,"done");
 setTimeout(()=>location.reload(),5000);
}
function clearReloadMarkers(){
 ["registration","eliminated","finished"].forEach(k=>sessionStorage.removeItem(`tvReload:${window.__tvRoomCode||"tv"}:${k}`));
}

let winnerAudio=null;
let winnerTimer=null;
function startWinnerCelebrationAudio(until){
  if(winnerTimer)clearInterval(winnerTimer);
  const btn=$("winnerSoundBtn");
  const play=()=>{
    try{
      if(!winnerAudio){
        winnerAudio=new Audio("/assets/kbc-theme.mp3");
        winnerAudio.preload="auto";
        winnerAudio.volume=0.9;
      }
      winnerAudio.currentTime=0;
      winnerAudio.play().catch(()=>{});
      if(btn)btn.textContent="🔊 CELEBRATION MUSIC PLAYING";
    }catch(e){}
  };
  if(btn)btn.onclick=play;
  play();
  const tick=()=>{
    const left=Math.max(0,Math.ceil((until-Date.now())/1000));
    const el=$("winnerCountdown");if(el)el.textContent=left;
    if(left<=0){
      clearInterval(winnerTimer);
      if(winnerAudio){winnerAudio.pause();winnerAudio.currentTime=0;}
    }
  };
  tick();winnerTimer=setInterval(tick,250);
}
let latestTvState=null,pollTvClock=null;
function renderPoll(x){
 const stage=$("pollStage"),qr=$("pollQr"),results=$("pollResults");
 if(!stage||!results)return;
 const st=x?.pollActive!==undefined?x:latestTvState;
 if(!st||!st.pollActive){addCls(stage,"hidden");clearInterval(pollTvClock);return}
 removeCls(stage,"hidden");
 if(qr)qr.src=st.audiencePollQr||"";
 if($("pollUrl"))$("pollUrl").textContent=st.audiencePollUrl||"";
 if($("pollQuestionTitle"))$("pollQuestionTitle").textContent=st.question?.text||"Audience Poll";
 let pollTimerBadge=stage.querySelector(".pollTimerBadge");if(!pollTimerBadge){pollTimerBadge=document.createElement("div");pollTimerBadge.className="pollTimerBadge";stage.querySelector(".tvkicker")?.after(pollTimerBadge);}
 const timerText=()=>{let ms=Number(st.pollTimerRemaining||0);if(st.pollTimerRunning&&st.pollTimerStartAt)ms=Math.max(0,ms-(Date.now()-st.pollTimerStartAt));pollTimerBadge.textContent=`HOST TIMER • ${(ms/1000).toFixed(1)}s`;};
 clearInterval(pollTvClock);timerText();if(st.pollTimerRunning)pollTvClock=setInterval(timerText,100);
 const counts={0:0,1:0,2:0,3:0,...(st.pollCounts||{})},total=Object.values(counts).reduce((a,b)=>a+Number(b||0),0);
 const opts=st.question?.options||["Option A","Option B","Option C","Option D"];
 results.innerHTML=opts.map((o,i)=>{const n=Number(counts[i]||0),pct=total?Math.round(n*100/total):0;return `<div class="pollResultRow"><div class="pollResultHead"><b>${String.fromCharCode(65+i)}. ${o}</b><strong>${pct}%</strong></div><div class="pollTrack"><i style="width:${pct}%"></i></div><small>${n} vote${n===1?"":"s"}</small></div>`}).join("");
 if($("pollUrl"))$("pollUrl").textContent=st.audiencePollUrl||"";
}
function updateJoin(x){
 const stage=$("qrStage");
 if(!stage)return;
 const phase=x.phase||"lobby";
 const isLobby=phase==="lobby";
 const isRegistration=phase==="registration";
 if(isLobby){
   removeCls(stage,"hidden");
   addCls($("tvmain"),"qrMode");
   $("qrKicker").textContent="SCAN TO OPEN QUIZ TV";
   $("qrTitle").textContent="Live TV Screen";
   if($("centralQr")){
     $("centralQr").src=x.screenQr||"";
     $("centralQr").onerror=()=>{$("centralQr").alt="TV QR unavailable — refresh the TV screen or create a new room."};
   }
   if($("qrRoom"))$("qrRoom").textContent="";
   if($("qrHint"))$("qrHint").textContent="Scan this QR code to open the live TV screen on your phone.";
   if($("registrationGrid"))$("registrationGrid").innerHTML="";
 }else if(isRegistration){
   removeCls(stage,"hidden");
   addCls($("tvmain"),"qrMode");
   $("qrKicker").textContent="JOIN THE QUIZ";
   $("qrTitle").textContent="Scan to Register";
   if($("centralQr"))$("centralQr").src=x.joinQr||"";
   if($("qrRoom"))$("qrRoom").textContent=x.roomCode||"";
   if($("qrHint"))$("qrHint").textContent="Scan the QR code or enter the room code shown above.";
 }else{
   addCls(stage,"hidden");
   removeCls($("tvmain"),"qrMode");
 }
 if(x.screenUrl)tvUniqueUrl=x.screenUrl;
}

function tone(freq,duration,type="sine",gain=.045,delay=0){if(!soundOn)return;try{audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(0,audioCtx.currentTime+delay);g.gain.linearRampToValueAtTime(gain,audioCtx.currentTime+delay+.02);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+delay+duration);o.connect(g);g.connect(audioCtx.destination);o.start(audioCtx.currentTime+delay);o.stop(audioCtx.currentTime+delay+duration+.03)}catch(e){}}
function fanfare(){[523,659,784,1047].forEach((n,i)=>tone(n,.22,"sine",.06,i*.13))}
function wrong(){tone(180,.35,"sawtooth",.06);tone(110,.5,"sawtooth",.05,.18)}
function tick(){tone(700,.06,"square",.025)}
function renderLadder(current){
 const ladder=$("prizeLadder");if(!ladder)return;
 const five=[10,20,30,40,50];
 ladder.innerHTML=five.slice().reverse().map((v,ri)=>{
   const i=five.length-1-ri;
   return `<div class="ladderRow ${i===current?"active":""} ${i<current?"reached":""}">
     <span>${i+1}</span><b>₹${v.toLocaleString("en-IN")}</b>
   </div>`;
 }).join("");
}
function transition(title,sub=""){ removeCls($("tvmain"),"tv-enter");void $("tvmain").offsetWidth;$("tvmain").classList.add("tv-enter");$("tvmain").innerHTML=`<div class=transition><div class=spinnerRing></div><div class=tvkicker>${title}</div><h1>${sub}</h1></div>`}
function countdown(seconds,onDone,pool=[],allUsers=[]){
 let n=seconds;
 const selectedIds=new Set((pool||[]).map(p=>p.id));
 const roster=(allUsers||[]).slice(0,30);
 const fallback=(pool||[]).slice(0,7);
 const names=roster.length?roster:fallback;
 $("tvmain").innerHTML=`<div class=countdown>
   <div class=tvkicker>⚡ FASTEST FINGER SELECTION</div>
   <h1>SELECTING 7 PLAYERS</h1>
   <div class=selectionStatus id=selectionStatus>Drawing from ${names.length} registered players…</div>
   <div class=selectionDrawGrid id=selectionDrawGrid>${names.map((p,i)=>`<div class="drawPlayer" data-id="${p.id}"><span>${i+1}</span><b>${escapeHtml(p.name)}</b></div>`).join("")}</div>
   <div id=countNum>${n}</div>
   <p>Next round starts in seconds</p>
 </div>`;
 let spin=0;
 const drawId=setInterval(()=>{
   const cards=[...document.querySelectorAll(".drawPlayer")];
   cards.forEach(c=>c.classList.remove("drawing","finalSelected"));
   if(cards.length){
     const chosen=[];
     while(chosen.length<Math.min(7,cards.length)){
       const c=cards[(spin+chosen.length*5)%cards.length];
       if(!chosen.includes(c))chosen.push(c);
     }
     chosen.forEach(c=>c.classList.add("drawing"));
   }
   spin++;
 },180);
 const tick=()=>{
   if($("countNum"))$("countNum").textContent=n;
   if(n<=1){
     document.querySelectorAll(".drawPlayer").forEach(c=>{
       c.classList.remove("drawing");
       if(selectedIds.has(c.dataset.id))c.classList.add("finalSelected");
     });
     if($("selectionStatus"))$("selectionStatus").textContent=`✓ 7 PLAYERS SELECTED`;
   }
 };
 tick();
 const id=setInterval(()=>{n--;if(n>0){tick()}else{clearInterval(id);clearInterval(drawId);$("countNum").textContent="GO!";tone(1100,.25,"sine",.08);setTimeout(onDone,500)}},1000);
}
function progressFor(x,employeeCode){return (x.fastestProgress||[]).find(p=>p.employeeCode===employeeCode)}
function renderPlayerCard(p,pr,sequence){
 const typed=pr?.sequence||[];
 const slots=sequence.map((_,i)=>`<span class="letterSlot ${i<typed.length?"correctLetter":""}">${i<typed.length?String.fromCharCode(65+typed[i]):"_"}</span>`).join("");
 const status=pr?.status||"READY";
 const time=pr?`${pr.time.toFixed(0)} ms`:"0 ms";
 const wrongState=status.startsWith("WRONG");
 return `<div class="ffCard ${wrongState?"wrongState":""}">
   <div class="ffName"><span>${p.name}</span><small>${p.employeeCode}</small></div>
   <div class="ffSlots">${slots}</div>
   <div class="ffMeta"><b>${time}</b><em>${status}</em></div>
 </div>`;
}
function showFastest(x){
 clearInterval(fastTimer);
 const seq=x.fastestSequence||[];
 $("tvmain").innerHTML=`<div class=fastestScreen>
   <div class=tvkicker>⚡ FASTEST FINGER MINI-GAME</div>
   <h1>REPEAT THE SEQUENCE</h1>
   <div class=selectedCount>7 PLAYERS • FIRST COMPLETE WINS</div>
   <div class=sequenceTv>${seq.map(n=>String.fromCharCode(65+n)).join(" • ")}</div>
   <div class=ffGrid id=ffGrid>${x.pool.map(p=>renderPlayerCard(p,progressFor(x,p.employeeCode),seq)).join("")}</div>
   <div class=tvTimer><span id=tvSeconds>15.0</span><small>SECONDS</small></div>
 </div>`;
 const tickTimer=()=>{const ms=Math.max(0,x.fastestStartAt+x.fastestDurationMs-Date.now());if($("tvSeconds"))$("tvSeconds").textContent=(ms/1000).toFixed(1);if(ms<=0){clearInterval(fastTimer);wrong()}};
 tickTimer();fastTimer=setInterval(tickTimer,50);
}
function updateFastestProgress(x){
 if(x.phase!=="fastest"||!$("ffGrid"))return;
 const seq=x.fastestSequence||[];
 $("ffGrid").innerHTML=x.pool.map(p=>renderPlayerCard(p,progressFor(x,p.employeeCode),seq)).join("");
}
resolveScreen().then(code=>{
  if(!code)throw new Error("No room code available");
  s.emit("join",{code,role:"tv",name:"TV Screen",employeeCode:"TV"});
}).catch(()=>{});
$("fullscreen")?.addEventListener("click",()=>document.documentElement.requestFullscreen?.());
$("soundToggle")?.addEventListener("click",()=>{soundOn=!soundOn;if($("soundToggle"))$("soundToggle").textContent=soundOn?"🔊":"🔇"});
s.on("errorMsg",msg=>{
  console.error(msg);
  // A TV opened through /screen/<token> is already bound to its room.
  // Never surface participant-input validation errors on the TV screen.
  if(String(msg).toLowerCase().includes("room code must be exactly 4 digits")) return;
  const toast=$("toast");
  if(toast){toast.textContent=msg;toast.className="tvError"}
});
s.on("answerLocked",a=>{
  const panel=document.querySelector(".questionScreen");if(!panel)return;
  const opts=panel.querySelectorAll(".tvopts div");
  opts.forEach((el,i)=>{removeCls(el,"selectedAnswer","correctAnswer","wrongAnswer");if(i===a.choice)addCls(el,"selectedAnswer");});
  let lock=panel.querySelector(".answerLock");if(lock)lock.remove();
  lock=document.createElement("div");lock.className="answerLock pending";
  lock.innerHTML=`<span>🔒 ANSWER LOCKED</span> ${escapeHtml(a.contestant?.name||"Contestant")} selected <b>${String.fromCharCode(65+a.choice)}. ${escapeHtml(a.option)}</b><small> Waiting for host approval…</small>`;
  panel.appendChild(lock);tone(520,.12,"sine",.04);
});
s.on("contestantQuit",a=>{
 const panel=document.getElementById("tvmain"); if(!panel)return;
 panel.innerHTML=`<div class="elimination"><div class="tvkicker">🚪 CONTESTANT WALKED AWAY</div><div class="winnerCrown">🏆</div><h1>${escapeHtml(a.contestant?.name||"Contestant")}</h1><p>They chose to quit and take the guaranteed amount.</p><div class="securedPoints">GUARANTEED PRIZE <b>₹${Number(a.amount||0).toLocaleString("en-IN")}</b></div><div class="nextBadge">NEXT: FASTEST FINGER</div></div>`;
 setTimeout(()=>{if(latestTvState&&latestTvState.phase==="fastest")render(latestTvState);},4000);
});

s.on("contestantAnswer",a=>{
  const panel=document.querySelector(".questionScreen");if(!panel)return;
  const opts=panel.querySelectorAll(".tvopts div");
  opts.forEach((el,i)=>{removeCls(el,"selectedAnswer","correctAnswer","wrongAnswer");if(i===a.choice)addCls(el,"selectedAnswer");});
  let lock=document.querySelector(".answerLock");if(lock)lock.remove();
  lock=document.createElement("div");lock.className="answerLock pending";
  lock.innerHTML=`<span>🔒 ANSWER LOCKED</span> ${a.contestant.name} selected <b>${String.fromCharCode(65+a.choice)}. ${a.option}</b><small> Waiting for host approval…</small>`;
  panel.appendChild(lock);tone(520,.12,"sine",.04);
});


s.on("answerRevealed",a=>{
  const panel=document.querySelector(".questionScreen");if(!panel)return;
  const opts=panel.querySelectorAll(".tvopts div");
  opts.forEach((el,i)=>{removeCls(el,"selectedAnswer","correctAnswer","wrongAnswer");if(i===a.choice)addCls(el,a.correct?"correctAnswer":"wrongAnswer");});
  const lock=document.querySelector(".answerLock");if(lock)lock.remove();
  const result=document.createElement("div");result.className=`answerLock ${a.correct?"correctResult":"wrongResult"}`;
  result.innerHTML=a.correct?`<span>✓ CORRECT ANSWER</span> ${a.contestant.name} selected <b>${String.fromCharCode(65+a.choice)}. ${a.option}</b>`:`<span>✕ WRONG ANSWER</span> ${a.contestant.name} selected <b>${String.fromCharCode(65+a.choice)}. ${a.option}</b>`;
  panel.appendChild(result);
  a.correct?fanfare():wrong();
});
s.on("poll",c=>{
  if(!latestTvState)return;
  latestTvState.pollCounts={0:0,1:0,2:0,3:0,...c};
  renderPoll(latestTvState);
});
s.on("state",x=>{ latestTvState=x;try{
 updateJoin(x);renderParticipants(x);$("roomLabel").textContent=x.phase.toUpperCase();renderLadder(x.current);
 renderPoll(x);

 if(x.phase==="registration"){
   scheduleTvReload("registration");
   removeCls($("tvmain"),"tv-enter");
   return;
 }
 if(x.phase==="eliminated"){
   scheduleTvReload("eliminated");
 }
 if(x.phase==="finished"){
   scheduleTvReload("finished");
 }
 if(x.phase==="lobby"){
   removeCls($("tvmain"),"tv-enter");
   return;
 }
 if(x.phase==="question"&&x.question&&x.pendingAnswer){
   setTimeout(()=>{
     const panel=document.querySelector(".questionScreen");
     if(!panel)return;
     const opts=panel.querySelectorAll(".tvopts div");
     opts.forEach((el,i)=>{removeCls(el,"selectedAnswer","correctAnswer","wrongAnswer");if(i===x.pendingAnswer.choice)addCls(el,"selectedAnswer");});
     let lock=panel.querySelector(".answerLock");if(lock)lock.remove();
     lock=document.createElement("div");lock.className="answerLock pending";
     lock.innerHTML=`<span>🔒 ANSWER LOCKED</span> ${escapeHtml(x.pendingAnswer.name)} selected <b>${String.fromCharCode(65+x.pendingAnswer.choice)}. ${escapeHtml(x.pendingAnswer.option)}</b><small> Waiting for host approval…</small>`;
     panel.appendChild(lock);
   },50);
 }
 if(x.phase==="fastest"&&lastPhase==="fastest"){updateFastestProgress(x);return}
 if(x.phase!==lastPhase){
   if(x.phase==="fastest"){countdown(5,()=>showFastest(x),x.pool,x.users)}
   else if(x.phase==="fastestResult"){fanfare()}
   else if(x.phase==="eliminated"){wrong()}
   else if(x.phase==="finished"){fanfare()}
   lastPhase=x.phase;
 }
 if(x.phase!=="fastestResult")removeCls(document.body,"tvResultMode");
 if(x.phase==="fastest")return;
 if(x.phase==="fastestResult"){
 addCls(document.body,"tvResultMode");
 $("tvmain").innerHTML=`<div class=winnerScreen><div class=tvkicker>FASTEST FINGER WINNER</div><div class=winnerCrown>🏆</div><h1>${x.winner.name}</h1><div class=winnerTime>${x.winner.time.toFixed(0)} <small>MS</small></div><p>Press Start Quiz on the Host screen to begin the new game at Question 1.</p></div>`;return}
 if(x.phase==="fastestTimeout"){$("tvmain").innerHTML=`<div class=winnerScreen><div class=tvkicker>TIME UP</div><h1>⏱️ NOBODY FINISHED</h1><p>Host can restart Fastest Finger with the same 7 players.</p></div>`;return}
 if(x.phase==="eliminated"){
 const e=x.eliminatedContestant;
 $("tvmain").innerHTML=`<div class=elimination><div class=tvkicker>CONTESTANT ELIMINATED</div><div class=wrongX>✕</div><h1>WRONG ANSWER</h1><h2>${e?e.name:"Contestant"}</h2><p>Well played!</p><div class=securedPoints>PRIZE WON <b>₹${Number(e?.prizeWon??0).toLocaleString("en-IN")}</b></div><div class=nextBadge>NEXT: FASTEST FINGER</div></div>`;return}
 if(x.phase==="question"&&x.question){if(lastQuestion!==x.current){playQuestionAudio(x.current);transition("NEW CONTESTANT GAME",`QUESTION ${x.current+1} OF ${(x.totalQuestions||5)}`);setTimeout(()=>{renderTvQuestion(x);tone(440,.18);tone(660,.22,"sine",.05,.18);if(latestTvState?.pollActive){renderPoll(latestTvState);}},650);lastQuestion=x.current}else{applyTv5050(x);}return}
 if(x.phase==="winnerCelebration"){
  const winner=x.winner||{};
  const until=Number(x.winnerCelebrationUntil||Date.now()+30000);
  $("tvmain").innerHTML=`<div class="winnerCelebration">
    <div class="tvkicker">🏆 GAMESARENA QUIZ • FINAL CHECK</div>
    <div class="winnerCrown">🏆</div>
    <div class="winnerCheck">ANSWER CHECK</div>
    <h1 class="winnerName">${winner.name||"Champion"}</h1>
    <p class="winnerCongrats">ALL 5 ANSWERS CORRECT</p>
    <div class="winnerPoints">₹50</div>
    <div class="winnerCountdown" id="winnerCountdown">30</div>
    <button class="soundPrompt" id="winnerSoundBtn">🔊 PLAY CELEBRATION MUSIC</button>
  </div>`;
  startWinnerCelebrationAudio(until);
  return;
}
if(x.phase==="finished"){$("tvmain").innerHTML=`<div class=winnerScreen><div class=tvkicker>GAMESARENA QUIZ</div><div class=winnerCrown>🏆</div><h1>GAME COMPLETE</h1><p>Congratulations to our champions!</p></div>`;return}

 $("tvmain").innerHTML=`<div class=lobby><div class=tvkicker>GAMESARENA QUIZ</div><h1>Get Ready!</h1></div>`;
}catch(e){
 console.error("TV state render error",e);
 const toast=$("toast");
 if(toast){toast.textContent="TV display error: "+e.message;toast.className="tvError"}
}
});
