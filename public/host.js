const s=io({transports:["polling","websocket"],reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:500,reconnectionDelayMax:3000,timeout:10000}),$=id=>document.getElementById(id);
let hostRoomToken=localStorage.getItem("gamesarena_host_token")||"";
let createRoomPending=false,hostAuthenticated=false;

async function checkHostAuth(){
  try{
    const r=await fetch("/api/host/me",{credentials:"same-origin"});
    const j=await r.json();
    hostAuthenticated=!!j.ok;
  }catch{hostAuthenticated=false}
  const modal=$("hostLoginModal");
  if(modal)modal.classList.toggle("hidden",hostAuthenticated);
  if(!hostAuthenticated){
    hostRoomToken="";
    localStorage.removeItem("gamesarena_host_token");
    if(s.connected)s.disconnect();
  }else if(!s.connected){
    s.connect();
  }
}
async function hostLogin(e){
  e.preventDefault();
  const err=$("hostLoginError"),btn=e.target.querySelector("button[type=submit]");
  err.hidden=true;btn.disabled=true;btn.textContent="Signing in…";
  try{
    const r=await fetch("/api/host/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({username:$("hostUsername").value,password:$("hostPassword").value})});
    const j=await r.json(); if(!r.ok)throw new Error(j.error||"Invalid credentials");
    hostAuthenticated=true;$("hostLoginModal").classList.add("hidden");
    if(s.connected)s.disconnect();
    s.connect();
  }catch(ex){err.hidden=false;err.textContent=ex.message}
  finally{btn.disabled=false;btn.textContent="🔐 Sign in"}
}
async function hostLogout(){
  try{await fetch("/api/host/logout",{method:"POST",credentials:"same-origin"})}catch{}
  hostAuthenticated=false;hostRoomToken="";localStorage.removeItem("gamesarena_host_token");
  location.reload();
}
document.getElementById("hostLoginForm")?.addEventListener("submit",hostLogin);
checkHostAuth();

s.on("connect",()=>{
  if(!hostAuthenticated)return;
  if(hostRoomToken) {
    s.emit("host:resume",{token:hostRoomToken});
  } else if(createRoomPending) {
    createRoomPending=false;
    createRoom();
  }
});
s.on("hostAuthRequired",()=>{
  hostAuthenticated=false;
  $("hostLoginModal")?.classList.remove("hidden");
  $("hostLoginError").textContent="Please sign in again.";
  $("hostLoginError").hidden=false;
});
let fastInterval=null,audiencePollOpen=false;
function createRoom(){
  if(!hostAuthenticated){$("hostLoginModal")?.classList.remove("hidden");return;}
  if(createRoomPending)return;

  // A click always means "give me a fresh room". Do not resume the
  // previous room from localStorage after this action.
  hostRoomToken="";
  localStorage.removeItem("gamesarena_host_token");

  if(!s.connected){
    createRoomPending=true;
    $("createStatus").innerHTML="🔄 <b>Connecting to GamesArena… a new room will be created automatically.</b>";
    const btn=$("create");
    if(btn){btn.disabled=true;btn.textContent="⏳ Waiting for connection…";}
    return;
  }

  createRoomPending=true;
  const btn=$("create");
  if(btn){btn.disabled=true;btn.textContent="⏳ Creating New Room…";}
  $("createStatus").innerHTML="⏳ <b>Creating a fresh game room…</b>";
  s.emit("host:create");
}
const demoSteps=[
 {title:"Registration",text:"Open Registration and display the room QR/code on the TV. Audience and contestants can join."},
 {title:"Fastest Finger",text:"Pick 7 players. The TV animates the selection, then gives the contestants a 5-second ready countdown."},
 {title:"Winner",text:"The fastest correct contestant is announced on the TV before the quiz begins."},
 {title:"Question",text:"The contestant sees the question and four options. The host sees the correct-answer hint."},
 {title:"50:50",text:"50:50 removes exactly two wrong options and remains disabled for the rest of the quiz."},
 {title:"Audience Poll",text:"The contestant requests the poll. Host approves it. Votes update live on the contestant, host and TV."},
 {title:"Lock & Approve",text:"Contestant locks an answer. Host approves/rejects. The TV highlights the selected answer and reveals green/red."},
 {title:"Wrong Answer",text:"Wrong answer shows the contestant, secured points and Well Played before the next Fastest Finger round."},
 {title:"Final Question",text:"Question 5 is the ₹50 final. A correct final answer triggers the champion celebration."},
 {title:"Complete",text:"All five answers correct: champion name, ₹50 and celebration screen with theme music."}
];
let demoIndex=0;
function openDemo(){demoIndex=0;$("demoModal")?.classList.remove("hidden");renderDemo()}
function closeDemo(){$("demoModal")?.classList.add("hidden")}
function renderDemo(){
 const el=$("demoStage"); if(!el)return;
 const d=demoSteps[demoIndex];
 el.innerHTML=`<div class="demoProgress">${demoSteps.map((_,i)=>`<i class="${i===demoIndex?"on":i<demoIndex?"done":""}"></i>`).join("")}</div>
 <div class="demoNumber">STEP ${demoIndex+1} / ${demoSteps.length}</div><h3>${d.title}</h3><p>${d.text}</p>`;
}
function demoNext(){demoIndex=Math.min(demoSteps.length-1,demoIndex+1);renderDemo()}
function demoPrev(){demoIndex=Math.max(0,demoIndex-1);renderDemo()}function openReg(){s.emit("host:openRegistration")}function pick7(){s.emit("host:pick7")}function restartFastest(){s.emit("host:restartFastest")}function startQuiz(){
  const phase=window.__hostPhase||"";
  if(phase!=="fastestResult"){
    const winner=window.__hostWinnerName;
    $("status").innerHTML=winner
      ? `⏳ <b>${winner}</b> is selected. Wait for the Fastest Finger result.`
      : "⚡ <b>Select 7 players and complete Fastest Finger first.</b>";
    return;
  }
  s.emit("host:startQuiz");
}function next7(){s.emit("host:nextFastest")}function nextQ(){s.emit("host:nextQuestion")}function toggleAudiencePoll(){
  const st=window.__hostState||{};
  if(st.pollTimerRunning){
    s.emit("host:audiencePollStop");
    return;
  }
  if(st.pollActive){
    if(Number(st.audienceConnected||0)>0) s.emit("host:startAudiencePollTimer");
    else s.emit("host:audiencePollStart");
    return;
  }
  s.emit("host:audiencePollStart");
}
function updatePollButton(){
  const b=$("audiencePollBtn"),start=$("audiencePollStartBtn"); if(!b)return;
  const st=window.__hostState||{};
  const ready=!!st.pollActive;
  const running=!!st.pollTimerRunning;
  const connected=Number(st.audienceConnected||0);
  if(running){
    b.textContent="🛑 Stop Audience Poll"; b.classList.add("danger"); b.disabled=false;
    if(start){start.classList.add("hidden");start.disabled=true;}
  }else if(ready){
    b.textContent="🗳️ Poll Shown • Waiting for Audience"; b.classList.remove("danger"); b.disabled=false;
    if(start){start.classList.toggle("hidden",connected<1);start.disabled=connected<1;start.textContent=connected>0?`▶️ START 60s POLL • ${connected} SCANNED`:"⏳ WAITING FOR AUDIENCE SCAN…";}
  }else{
    b.textContent="🗳️ Show Audience Poll"; b.classList.remove("danger"); b.disabled=false;
    if(start){start.classList.add("hidden");start.disabled=true;}
  }
}function participants(){const room=$("code").textContent.trim();if(room&&room!=="----")location.href=`/registered.html?room=${room}`}function restartEvent(){if(confirm("Reset the entire event?"))s.emit("host:restartEvent")}
function drawTimer(x){
 clearInterval(fastInterval);
 if(x.phase!=="fastest")$("fastTimer").textContent="";
 const qTick=()=>{
   const qel=$("questionTimer");
   if(qel){
     let ms=Number(x.questionTimerRemaining||0);
     if(x.questionTimerRunning&&x.questionTimerStartAt)ms=Math.max(0,ms-(Date.now()-x.questionTimerStartAt));
     qel.textContent=`${(ms/1000).toFixed(1)}s`;
     qel.classList.toggle("paused",!!x.questionTimerPaused);
   }
   const pel=$("pollTimer");
   if(pel){
     let ms=Number(x.pollTimerRemaining||0);
     if(x.pollTimerRunning&&x.pollTimerStartAt)ms=Math.max(0,ms-(Date.now()-x.pollTimerStartAt));
     pel.textContent=`${(ms/1000).toFixed(1)}s`;
   }
 };
 qTick();
 if(x.questionTimerRunning||x.pollTimerRunning)fastInterval=setInterval(qTick,100);
 if(x.phase==="fastest"){
   const tick=()=>{const ms=Math.max(0,x.fastestStartAt+x.fastestDurationMs-Date.now());$("fastTimer").textContent=ms>5000?`GET READY • ${(ms/1000-5).toFixed(1)}s`:`FASTEST FINGER • ${(ms/1000).toFixed(1)}s`;if(ms<=0)clearInterval(fastInterval)};
   tick();clearInterval(fastInterval);fastInterval=setInterval(tick,50);
 }
}
function pauseQuestionTimer(){s.emit("host:pauseQuestionTimer")}
function resumeQuestionTimer(){s.emit("host:resumeQuestionTimer")}
function letters(seq){return (seq||[]).map(n=>String.fromCharCode(65+n)).join(" ")}
s.on("room",d=>{
  if(d.hostToken){
    hostRoomToken=d.hostToken;
    localStorage.setItem("gamesarena_host_token",d.hostToken);
  }

  $("code").textContent=d.code;
  $("url").href=d.joinUrl;$("url").textContent=`Open participant page ↗`;
  $("qr").src=d.qr;
  $("screenUrl").innerHTML=`📺 TV URL: <a href="${d.screenUrl}" target="_blank" rel="noopener">${d.screenUrl}</a>`;
  if($("paymentQr"))$("paymentQr").src=d.paymentQr||"";
  if($("paymentUrl")){$("paymentUrl").href=d.paymentUrl||"/payment.html";$("paymentUrl").textContent="Open payment form ↗";}
  $("area").classList.remove("hidden");

  createRoomPending=false;
  const btn=$("create");
  if(btn){
    btn.disabled=false;
    btn.textContent="＋ Create New Room";
  }
  $("createStatus").innerHTML="🟢 <b>Room "+d.code+" is ready.</b> Create New Room will generate a completely new code.";
});
s.on("disconnect",()=>{$("createStatus").innerHTML="🔄 <b>Connection interrupted — reconnecting…</b>";if($("status"))$("status").innerHTML="🔄 <b>Connection interrupted — reconnecting…</b>";});
s.on("connect",()=>{if($("createStatus")&&$("code")?.textContent==="----")$("createStatus").innerHTML="🟢 <b>Connected — ready to create a room.</b>";if($("status")&&$("code")?.textContent&&$("code").textContent!=="----")$("status").innerHTML="🟢 <b>Connected</b>";});
s.on("connect_error",()=>{if($("status"))$("status").innerHTML="🔄 <b>Reconnecting to GamesArena…</b>";});
s.on("errorMsg",alert);
s.on("answerLocked",a=>{
 $("answerReview").classList.remove("hidden");
 $("answerReview").innerHTML=`<div class="reviewTitle">🔒 ANSWER LOCKED</div><div class="reviewAnswer">${a.contestant.name} selected <b>${String.fromCharCode(65+a.choice)}. ${a.option}</b></div><div class="reviewButtons"><button class="approve" onclick="approveAnswer()">✓ APPROVE / REVEAL</button><button class="reject" onclick="rejectAnswer()">↶ REJECT / UNLOCK</button></div>`;
});
s.on("answerRevealed",a=>{
 $("answerReview").classList.add("hidden");
 $("status").innerHTML=a.correct?`✅ Correct answer approved — ${a.contestant.name} continues.`:`❌ Wrong answer — ${a.contestant.name} is eliminated.`;
});
s.on("answerRejected",a=>{
 $("answerReview").classList.add("hidden");
 $("status").innerHTML=`↶ Answer unlocked for ${a.contestant.name}.`;
});
function approveAnswer(){s.emit("host:approveAnswer")}
function rejectAnswer(){s.emit("host:rejectAnswer")}
function approveQuit(){s.emit("host:approveQuit")}
function rejectQuit(){s.emit("host:rejectQuit")}

function clearSafeQuitSidePanel(){
 const panel=$("safeQuitSidePanel");
 if(panel){panel.classList.add("hidden");panel.innerHTML="";}
}
function showSafeQuitRequest(a){
 const review=$("answerReview");
 const name=a?.contestant?.name||a?.name||"Contestant";
 const amount=Number(a?.amount||0);
 window.__pendingQuitUi={name,amount};

 // Keep the high-priority Safe Quit action immediately below the QR.
 const side=$("safeQuitSidePanel");
 if(side){
   side.classList.remove("hidden");
   side.innerHTML=`<div class="safeQuitSideKicker">🚪 SAFE QUIT REQUEST</div>
     <div class="safeQuitSideName">${name}</div>
     <div class="safeQuitSideText">Requesting to walk away with</div>
     <div class="safeQuitSideAmount">₹${amount.toLocaleString("en-IN")}</div>
     <div class="safeQuitSideButtons">
       <button type="button" class="approve" onclick="approveQuit()">✓ APPROVE</button>
       <button type="button" class="reject" onclick="rejectQuit()">✕ REJECT</button>
     </div>`;
 }
 // Do not duplicate Safe Quit in the main review area.
 if(review){review.classList.add("hidden");review.innerHTML="";}
 const el=$("status");
 if(el){el.classList.remove("hidden");el.innerHTML=`🚪 <b>Safe Quit Request</b> — ${name} is waiting for Host approval.`;}
}
s.on("quitRequested",a=>showSafeQuitRequest(a));
s.on("quitRejected",a=>{
 window.__pendingQuitUi=null;
 clearSafeQuitSidePanel();
 const review=$("answerReview"); if(review){review.classList.add("hidden");review.innerHTML="";}
 const el=$("status"); if(el){el.classList.remove("hidden");el.innerHTML=`↩️ Safe Quit rejected for ${a.contestant?.name||"contestant"}. The game continues.`;}
});
s.on("contestantQuit",a=>{
 window.__pendingQuitUi=null;
 clearSafeQuitSidePanel();
 const review=$("answerReview"); if(review){review.classList.add("hidden");review.innerHTML="";}
 const el=$("status");if(el){el.classList.remove("hidden");el.innerHTML=`🚪 <b>${a.contestant?.name||"Contestant"} walked away with ₹${Number(a.amount||0).toLocaleString("en-IN")}</b>.`;}
});
function updateFlowControls(x){
  if(!x.pendingQuit && !window.__pendingQuitUi) clearSafeQuitSidePanel();
  window.__hostPhase=x.phase||"";
  window.__hostWinnerName=x.winner?.name||x.contestant?.name||"";
  const phase=x.phase||"";
  const canPick=["registration","lobby","fastestTimeout","eliminated","finished"].includes(phase);
  const canRestart=phase==="fastestTimeout" && Array.isArray(x.pool) && x.pool.length>0;
  const canNext7=["fastestResult","fastestTimeout","eliminated"].includes(phase);
  const canStart=phase==="fastestResult" && !!(x.winner||x.contestant);
  const canNextQ=phase==="question" && !x.pendingAnswer && !x.pendingQuit;
  const canPoll=phase==="question" && !!x.winner;

  const set=(id,disabled)=>{const el=$(id);if(el)el.disabled=disabled};
  set("pick7Btn",!canPick);
  set("restartFastestBtn",!canRestart);
  set("next7Btn",!canNext7);
  set("startQuizBtn",!canStart);
  const startBtn=$("startQuizBtn");
  if(startBtn) startBtn.textContent=canStart?"▶️ START QUIZ — "+(x.winner?.name||x.contestant?.name||"WINNER"):"▶️ Start Quiz";
  set("nextQuestionBtn",!canNextQ);
  const pollBtn=$("audiencePollBtn");
  if(pollBtn){
    const pollNeedsScan=!!x.pollActive&&!x.pollVotingOpen&&Number(x.audienceConnected||0)<1;
    pollBtn.disabled=!canPoll||pollNeedsScan;
  }
  set("pauseQuestionTimerBtn",!(canPoll&&x.questionTimerRunning));
  set("resumeQuestionTimerBtn",!(canPoll&&x.questionTimerPaused&&!x.pollActive));

  const labels={
    lobby:"SETUP",
    registration:"REGISTRATION OPEN",
    fastest:"FASTEST FINGER",
    fastestResult:"WINNER READY",
    fastestTimeout:"FASTEST FINGER TIMEOUT",
    question:`QUESTION ${Math.max(1,(x.current||0)+1)} OF ${x.totalQuestions||5}`,
    eliminated:"PLAYER ELIMINATED",
    winnerCelebration:"GAME COMPLETE",
    finished:"READY FOR NEXT ROUND"
  };
  const fs=$("flowState");
  if(fs)fs.textContent=labels[phase]||String(phase).toUpperCase();
}

s.on("state",x=>{ window.__hostState=x; audiencePollOpen=!!x.pollActive;renderHostAudiencePoll(x);updatePollButton();updateFlowControls(x);
 $("reg").textContent=x.registered;
 const users=x.users||[];
 const played=users.filter(u=>u.status==="completed"||u.status==="eliminated"||u.played||u.inQuiz).length;
 const eliminated=users.filter(u=>u.status==="eliminated").length;
 const waiting=users.filter(u=>!u.played&&!u.inQuiz&&!u.completed&&!u.eliminated&&!u.inPool).length;
 $("active").textContent=x.active;
 if($("played"))$("played").textContent=played;
 if($("eliminated"))$("eliminated").textContent=eliminated;
 if($("waiting"))$("waiting").textContent=waiting;
 drawTimer(x);

 const msg={
 registration:"📝 Registration is OPEN.",
 fastest:`⚡ FASTEST FINGER — ${x.pool.length} selected. Watching live responses below.`,
 fastestResult:x.winner?`🏆 ${x.winner.name} won Fastest Finger in <b>${x.winner.time.toFixed(0)} ms</b>. Press Start Quiz when ready.`:"",
 fastestTimeout:"⏱️ Nobody completed the sequence. You can restart Fastest Finger with the SAME 7 players.",
 eliminated:"❌ Contestant eliminated. A NEW GAME will start with a fresh Fastest Finger round…",
 finished:"🎉 GAME COMPLETE"
 }[x.phase]||(x.phase==="question"?"":"Waiting…");
 $("status").classList.toggle("hidden",x.phase==="question");
 if(x.pendingAnswer){
 $("answerReview").classList.remove("hidden");
 $("answerReview").innerHTML=`<div class="reviewTitle">🔒 ANSWER LOCKED</div><div class="reviewAnswer">${x.pendingAnswer.name} selected <b>${String.fromCharCode(65+x.pendingAnswer.choice)}. ${x.pendingAnswer.option}</b></div><div class="reviewButtons"><button class="approve" onclick="approveAnswer()">✓ APPROVE / REVEAL</button><button class="reject" onclick="rejectAnswer()">↶ REJECT / UNLOCK</button></div>`;
}else if(x.pendingQuit){
 showSafeQuitRequest({contestant:{name:x.pendingQuit.name,employeeCode:x.pendingQuit.employeeCode,id:x.pendingQuit.playerId},amount:x.pendingQuit.amount});
}else if(window.__pendingQuitUi){
 showSafeQuitRequest({contestant:{name:window.__pendingQuitUi.name},amount:window.__pendingQuitUi.amount});
}else if(x.pendingPollRequest){
 $("answerReview").classList.remove("hidden");
 $("answerReview").innerHTML=`<div class="reviewTitle">🗳️ AUDIENCE POLL REQUEST</div><div class="reviewAnswer"><b>${x.pendingPollRequest.name}</b> requested the Audience Poll lifeline.</div><div class="reviewButtons"><button class="approve" onclick="approveAudiencePoll()">✓ APPROVE POLL</button><button class="reject" onclick="rejectAudiencePoll()">✕ REJECT POLL</button></div>`;
}else{$("answerReview").classList.add("hidden")} $("status").innerHTML=msg;
 $("fastQrBox").classList.toggle("hidden",!x.fastestJoinQr || !["fastest","fastestResult","fastestTimeout"].includes(x.phase));
 if(x.fastestJoinQr) $("fastQr").src=x.fastestJoinQr;

 $("pool").innerHTML=x.pool.length?
   `<div class="selectedGrid">${x.pool.map((p,i)=>{
     const pr=(x.fastestProgress||[]).find(v=>v.employeeCode===p.employeeCode);
     const time=pr?`${pr.time.toFixed(0)} ms`:"—";
     return `<div class="selectedCard"><div class="selectedNum">${i+1}</div><div><b>${p.name}</b><small>${p.employeeCode}</small></div><strong>${time}</strong></div>`;
   }).join("")}</div>`:"<div class=muted>No players selected yet.</div>";

 $("fastResults").innerHTML=x.fastestTimes?.length?
   `<h3>Fastest Finger Times</h3>`+x.fastestTimes.sort((a,b)=>a.time-b.time).map(v=>`<div class=row><span>${v.name} <small>${v.employeeCode}</small></span><b>${v.status==="COMPLETED"?v.time.toFixed(0)+" ms":v.status}</b></div>`).join(""):"";

 const fixedLadder=[10,20,30,40,50];
$("hostLadder").innerHTML=fixedLadder.map((v,i)=>`<div class="row ${i===x.current?"ladderActive":""}"><span>Q${i+1}</span><b>₹${v.toLocaleString("en-IN")}</b></div>`).join("");
 $("board").innerHTML=x.users.filter(u=>u.status!=="eliminated").sort((a,b)=>b.score-a.score).map((u,i)=>`<div class="row participantStatusRow"><span>#${i+1} ${u.name}</span><b>${u.score}</b><em class="statusPill ${String(u.status||"waiting").toLowerCase()}">${String(u.status||"WAITING").toUpperCase()}</em></div>`).join("");
});

s.on("hostQuestion",q=>{ window.__hostQuestion=q;
 const old=document.getElementById("hostQuestion");
 if(!old)return;
 if(!q){old.innerHTML="";return}
 old.innerHTML=`<div class="hostQuestionCard"><div class="eyebrow">HOST ONLY • ${q.difficulty?"LEVEL "+q.difficulty:""}</div><h3>${q.text}</h3><div class="hostOptions">${q.options.map((o,i)=>`<div class="${i===q.answer?"correctHint":""}"><b>${String.fromCharCode(65+i)}</b> ${o}${i===q.answer?" <span>✓ CORRECT</span>":""}</div>`).join("")}</div></div>`;
});

function renderHostAudiencePoll(x){
 const panel=$("hostAudiencePoll"),results=$("hostAudiencePollResults");
 if(!panel||!results)return;
 if(!x?.pollActive){panel.classList.add("hidden");results.innerHTML="";return;}
 panel.classList.remove("hidden");
 const q=x.question;
 if($("hostAudiencePollQuestion")){
   const connected=Number(x.audienceConnected||0);
   const phase=x.pollTimerRunning?"LIVE • 60 SECOND COUNTDOWN":connected>0?`READY • ${connected} AUDIENCE SCANNED`:"SCAN THE QR CODE ON TV";
   $("hostAudiencePollQuestion").textContent=`${q?.text||"Audience Poll"} — ${phase}`;
 }
 const c={0:0,1:0,2:0,3:0,...(x.pollCounts||{})},total=Object.values(c).reduce((a,b)=>a+Number(b||0),0);
 const opts=q?.options||["Option A","Option B","Option C","Option D"];
 results.innerHTML=opts.map((o,i)=>{const n=Number(c[i]||0),pct=total?Math.round(n*100/total):0;return `<div class="pollVoteRow"><div><b>${String.fromCharCode(65+i)}. ${o}</b><strong>${pct}%</strong></div><div class="pollTrack"><i style="width:${pct}%"></i></div><small>${n} vote${n===1?"":"s"}</small></div>`}).join("")+`<div class="pollTotal">${total} total vote${total===1?"":"s"}</div>`;
}

function approveAudiencePoll(){s.emit("host:approveAudiencePoll")}
function rejectAudiencePoll(){s.emit("host:rejectAudiencePoll")}
s.on("poll",counts=>{ if(!audiencePollOpen)return; renderHostAudiencePoll({pollActive:true,pollCounts:counts,question:window.__hostQuestion||null}); });
s.on("audiencePollStarted",d=>{if($("status"))$("status").innerHTML=`🗳️ <b>Audience Poll approved</b> — ${d.contestant?.name||"Contestant"} can use the audience lifeline.`});
s.on("audiencePollRejected",d=>{if($("status"))$("status").innerHTML=`↶ <b>Audience Poll rejected</b> — ${d.contestant?.name||"Contestant"}`});
s.on("audiencePollTimeUp",()=>{audiencePollOpen=false;updatePollButton();if($("status"))$("status").innerHTML="⏱️ <b>Audience Poll time is up.</b> The question timer has resumed."});


/* ===== Payment Inventory / Player Log ===== */
function showPaymentPanel(html){const p=$("paymentInventoryPanel");if(!p)return;p.classList.remove("hidden");p.innerHTML=html}
async function apiHost(url,options={}){
 const r=await fetch(url,{credentials:"same-origin",...options});
 const j=await r.json().catch(()=>({error:"Invalid server response"}));
 if(r.status===401){$("hostLoginModal")?.classList.remove("hidden");throw new Error("Host login required.")}
 if(!r.ok)throw new Error(j.error||"Request failed");
 return j;
}
function paymentRow(row,action=true){
 const payload=encodeURIComponent(JSON.stringify(row));
 return `<div class="paymentRow"><b>${escapeHtml(row.playerName)}</b><small>Register: ${escapeHtml(row.registerNumber)} • Phone: ${escapeHtml(row.phone)}</small><small>${escapeHtml(row.paymentDate)} • ${escapeHtml(row.paymentMethod)} • ₹${Number(row.amountPaid||0).toFixed(2)}</small><small>${row.transactionReference?`Ref: ${escapeHtml(row.transactionReference)}`:"No reference number"}${row.status?` • ${escapeHtml(row.status)}`:""}</small>${action?`<button class="primary" onclick="reviewPaymentEncoded('${payload}')">Review &amp; Save</button>`:""}</div>`
}
function reviewPaymentEncoded(payload){reviewPayment(JSON.parse(decodeURIComponent(payload)))}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
async function loadPaymentSubmissions(){
 try{
  const j=await apiHost("/api/host/payment-submissions");
  showPaymentPanel(`<div style="font-weight:900;margin-bottom:8px">PENDING SUBMISSIONS (${j.rows.length})</div>${j.rows.length?j.rows.map(x=>paymentRow(x,true)).join(""):"<small>No pending payment submissions.</small>"}`);
 }catch(e){showPaymentPanel(`<div class="paymentRow">${escapeHtml(e.message)}</div>`)}
}
let hostPlayersCache=[];
async function loadHostPlayers(selectedRegister=""){
 try{
  const j=await apiHost("/api/host/players");
  hostPlayersCache=j.rows||[];
  const sel=$("payPlayerSelect");
  if(!sel)return;
  sel.innerHTML='<option value="">Select a registered player…</option>'+
    hostPlayersCache.map(p=>`<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.playerName)} • ${escapeHtml(p.registerNumber||"No register")} • ${escapeHtml(p.phoneNumber||"No phone")}</option>`).join("");
  const match=hostPlayersCache.find(p=>String(p.registerNumber||"")===String(selectedRegister||""));
  if(match)sel.value=String(match.id);
 }catch(err){
  console.warn("Could not load registered players:",err.message);
 }
}
function fillPaymentPlayerFromSelection(){
 const sel=$("payPlayerSelect"),id=sel?.value;
 const p=hostPlayersCache.find(x=>String(x.id)===String(id));
 if(!p)return;
 $("payPlayerName").value=p.playerName||"";
 $("payRegisterNumber").value=p.registerNumber||"";
 $("payPhone").value=p.phoneNumber||"";
}
$("payPlayerSelect")?.addEventListener("change",fillPaymentPlayerFromSelection);
async function reviewPayment(row){
 $("paymentSubmissionId").value=row.id||"";
 $("payPlayerName").value=row.playerName||"";
 $("payRegisterNumber").value=row.registerNumber||"";
 $("payPhone").value=row.phone||"";
 $("payDate").value=String(row.paymentDate||"").slice(0,10);
 $("payEntryFee").value=Number(row.entryFee||0);
 $("payAmountPaid").value=Number(row.amountPaid||0);
 $("payMethod").value=row.paymentMethod||"Other";
 $("payReference").value=row.transactionReference||"";
 $("payNotes").value=row.notes||"";
 $("paymentEditModal").classList.remove("hidden");
 await loadHostPlayers(row.registerNumber||"");
}
function closePaymentModal(){$("paymentEditModal")?.classList.add("hidden")}
$("paymentEditForm")?.addEventListener("submit",async e=>{
 e.preventDefault();
 const b=e.target.querySelector("button[type=submit]");b.disabled=true;b.textContent="Saving…";
 try{
  await apiHost("/api/host/payments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
   submissionId:Number($("paymentSubmissionId").value)||null,
   playerName:$("payPlayerName").value,registerNumber:$("payRegisterNumber").value,phone:$("payPhone").value,
   paymentDate:$("payDate").value,entryFee:Number($("payEntryFee").value),amountPaid:Number($("payAmountPaid").value),
   paymentMethod:$("payMethod").value,transactionReference:$("payReference").value,notes:$("payNotes").value
  })});
  closePaymentModal();await loadPaymentSubmissions();alert("Payment record saved to the database.");
 }catch(err){alert(err.message)}
 finally{b.disabled=false;b.textContent="✓ Save to Database"}
});
function openPaymentSearch(){
 showPaymentPanel(`<div class="paymentSearch"><input id="paymentSearchInput" placeholder="Search name, phone or register number"><button class="primary" onclick="searchPayments()">Search</button></div><div id="paymentSearchResults"><small>Enter a search term.</small></div>`);
 $("paymentSearchInput")?.focus();
}
async function searchPayments(){
 const q=$("paymentSearchInput")?.value.trim()||"";
 try{
  const j=await apiHost("/api/host/payments?q="+encodeURIComponent(q));
  $("paymentSearchResults").innerHTML=j.rows.length?j.rows.map(x=>paymentRow(x,false)).join(""):"<small>No payment records found.</small>";
 }catch(e){$("paymentSearchResults").innerHTML=`<div class="paymentRow">${escapeHtml(e.message)}</div>`}
}
async function loadPlayerLogs(){
 showPaymentPanel(`<div class="paymentSearch"><input id="playerLogSearchInput" placeholder="Search player name, phone or register number"><button class="primary" onclick="searchPlayerLogs()">Search</button></div><div id="playerLogResults"><small>Enter a search term or click Search to load recent history.</small></div>`);
 await searchPlayerLogs();
}
async function searchPlayerLogs(){
 const q=$("playerLogSearchInput")?.value.trim()||"";
 try{
  const j=await apiHost("/api/host/player-logs?q="+encodeURIComponent(q));
  $("playerLogResults").innerHTML=j.rows.length?j.rows.map(x=>`<div class="paymentRow"><b>${escapeHtml(x.playerName)}</b><small>Register: ${escapeHtml(x.registerNumber)} • Phone: ${escapeHtml(x.phone||"—")}</small><small>${escapeHtml(new Date(x.playedAt).toLocaleString())} • ${escapeHtml(x.resultStatus)} • Won ₹${Number(x.amountWon||0).toFixed(2)}</small><small>Room ${escapeHtml(x.roomCode)} • Entry ₹${Number(x.entryFee||0).toFixed(2)} ${x.safeQuit?"• SAFE QUIT":""}</small></div>`).join(""):"<small>No player history found.</small>";
 }catch(e){$("playerLogResults").innerHTML=`<div class="paymentRow">${escapeHtml(e.message)}</div>`}
}
