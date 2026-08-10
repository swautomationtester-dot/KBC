const s=io({transports:["websocket","polling"]}),$=id=>document.getElementById(id);
let fastInterval=null,audiencePollOpen=false;
function createRoom(){s.emit("host:create")}
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
}function next7(){s.emit("host:nextFastest")}function nextQ(){s.emit("host:nextQuestion")}function toggleAudiencePoll(){audiencePollOpen=!audiencePollOpen;s.emit(audiencePollOpen?"host:audiencePollStart":"host:audiencePollStop");updatePollButton()}function updatePollButton(){const b=$("audiencePollBtn");if(!b)return;b.textContent=audiencePollOpen?"🛑 Close Audience Poll":"🗳️ Ask Audience Poll";b.classList.toggle("danger",audiencePollOpen)}function participants(){const room=$("code").textContent.trim();if(room&&room!=="----")location.href=`/registered.html?room=${room}`}function restartEvent(){if(confirm("Reset the entire event?"))s.emit("host:restartEvent")}
function drawTimer(x){
 clearInterval(fastInterval);
 if(x.phase!=="fastest"){$("fastTimer").textContent="";return}
 const tick=()=>{const ms=Math.max(0,x.fastestStartAt+x.fastestDurationMs-Date.now());$("fastTimer").textContent=ms>5000?`GET READY • ${(ms/1000-5).toFixed(1)}s`:`FASTEST FINGER • ${(ms/1000).toFixed(1)}s`;if(ms<=0)clearInterval(fastInterval)};
 tick();fastInterval=setInterval(tick,50);
}
function letters(seq){return (seq||[]).map(n=>String.fromCharCode(65+n)).join(" ")}
s.on("room",d=>{$("code").textContent=d.code;$("url").textContent=d.joinUrl;$("qr").src=d.qr;$("screenUrl").innerHTML=`📺 TV URL: <a href="${d.screenUrl}" target="_blank" rel="noopener">${d.screenUrl}</a>`;$("area").classList.remove("hidden");$("create").disabled=true});
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

function updateFlowControls(x){
  window.__hostPhase=x.phase||"";
  window.__hostWinnerName=x.winner?.name||x.contestant?.name||"";
  const phase=x.phase||"";
  const canPick=["registration","lobby","fastestTimeout","eliminated","finished"].includes(phase);
  const canRestart=phase==="fastestTimeout" && Array.isArray(x.pool) && x.pool.length>0;
  const canNext7=["fastestResult","fastestTimeout","eliminated"].includes(phase);
  const canStart=phase==="fastestResult" && !!(x.winner||x.contestant);
  const canNextQ=phase==="question" && !x.pendingAnswer;
  const canPoll=phase==="question" && !!x.winner;

  const set=(id,disabled)=>{const el=$(id);if(el)el.disabled=disabled};
  set("pick7Btn",!canPick);
  set("restartFastestBtn",!canRestart);
  set("next7Btn",!canNext7);
  set("startQuizBtn",!canStart);
  const startBtn=$("startQuizBtn");
  if(startBtn) startBtn.textContent=canStart?"▶️ START QUIZ — "+(x.winner?.name||x.contestant?.name||"WINNER"):"▶️ Start Quiz";
  set("nextQuestionBtn",!canNextQ);
  set("audiencePollBtn",!canPoll);

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

s.on("state",x=>{ audiencePollOpen=!!x.pollActive;renderHostAudiencePoll(x);updatePollButton();updateFlowControls(x);
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
 if($("hostAudiencePollQuestion"))$("hostAudiencePollQuestion").textContent=q?.text||"Audience Poll";
 const c={0:0,1:0,2:0,3:0,...(x.pollCounts||{})},total=Object.values(c).reduce((a,b)=>a+Number(b||0),0);
 const opts=q?.options||["Option A","Option B","Option C","Option D"];
 results.innerHTML=opts.map((o,i)=>{const n=Number(c[i]||0),pct=total?Math.round(n*100/total):0;return `<div class="pollVoteRow"><div><b>${String.fromCharCode(65+i)}. ${o}</b><strong>${pct}%</strong></div><div class="pollTrack"><i style="width:${pct}%"></i></div><small>${n} vote${n===1?"":"s"}</small></div>`}).join("")+`<div class="pollTotal">${total} total vote${total===1?"":"s"}</div>`;
}

function approveAudiencePoll(){s.emit("host:approveAudiencePoll")}
function rejectAudiencePoll(){s.emit("host:rejectAudiencePoll")}
s.on("poll",counts=>{ if(!audiencePollOpen)return; renderHostAudiencePoll({pollActive:true,pollCounts:counts,question:window.__hostQuestion||null}); });
s.on("audiencePollStarted",d=>{if($("status"))$("status").innerHTML=`🗳️ <b>Audience Poll approved</b> — ${d.contestant?.name||"Contestant"} can use the audience lifeline.`});
s.on("audiencePollRejected",d=>{if($("status"))$("status").innerHTML=`↶ <b>Audience Poll rejected</b> — ${d.contestant?.name||"Contestant"}`});
