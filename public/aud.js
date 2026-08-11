const s=io({transports:["websocket","polling"],reconnection:true}),$=id=>document.getElementById(id);
const q=new URLSearchParams(location.search);
const roomFromUrl=(q.get("room")||"").trim().toUpperCase();
if(roomFromUrl && $("room"))$("room").value=roomFromUrl;
let pollActive=false,selected=null,joined=false,submitted=false;

function setStatus(text,kind=""){
 const el=$("status");if(!el)return;
 el.textContent=text;el.className=`box ${kind}`.trim();
}
function join(){
 const code=($("room")?.value||"").trim().toUpperCase();
 if(!code){setStatus("Enter the room code first.","errorText");return}
 setStatus("Connecting to the audience poll…");
 s.emit("join",{code,role:"audience",name:"Audience",employeeCode:"AUD-"+Math.random().toString(36).slice(2,8)});
}
s.on("connect",()=>{if(roomFromUrl&&!joined)join()});
s.on("joined",()=>{
 joined=true;
 $("area")?.classList.remove("hidden");
 setStatus(pollActive?"🗳️ Poll is open — select your answer.":"Waiting for the Host to open the audience poll…");
});
s.on("errorMsg",msg=>setStatus(msg,"errorText"));

function renderAnswers(x){
 if(!x.question)return;
 const qEl=$("q"),aEl=$("answers");
 if(qEl)qEl.textContent=x.question.text;
 if(!aEl)return;
 aEl.innerHTML=x.question.options.map((o,i)=>
   `<button class="answer ${selected===i?"selectedAnswer":""} ${submitted&&selected===i?"submittedAnswer":""}" data-choice="${i}" ${submitted||!window.__audienceVotingOpen?"disabled":""}>
    <b>${String.fromCharCode(65+i)}.</b> ${o}
   </button>`).join("");
 aEl.querySelectorAll(".answer").forEach(b=>b.addEventListener("click",()=>{
   if(!pollActive||!window.__audienceVotingOpen||submitted)return;
   selected=Number(b.dataset.choice);
   aEl.querySelectorAll(".answer").forEach(z=>z.classList.remove("selectedAnswer","submittedAnswer"));
   b.classList.add("selectedAnswer");
   setStatus(`Answer ${String.fromCharCode(65+selected)} selected. Sending your vote…`);
   s.emit("audience:poll",{choice:selected},result=>{
     if(result?.ok){
       submitted=true;
       b.classList.remove("selectedAnswer");
       b.classList.add("submittedAnswer");
       aEl.querySelectorAll(".answer").forEach(z=>z.disabled=true);
       setStatus(`✓ Vote submitted: ${String.fromCharCode(65+selected)}. Your vote is counted live.`);
     }else{
       setStatus(result?.error||"Vote was not accepted.","errorText");
     }
   });
 }));
}

function renderPoll(c){
 const total=Object.values(c||{}).reduce((a,b)=>a+Number(b||0),0);
 const el=$("poll");if(!el)return;
 el.innerHTML=total?[0,1,2,3].map(i=>{
   const p=Math.round((Number(c[i]||0)*100)/total);
   return `<div class="bar"><i style="width:${p}%"></i><span>${String.fromCharCode(65+i)}</span><em>${p}%</em></div>`;
 }).join(""):"<div class=muted>Waiting for votes…</div>";
}

s.on("state",x=>{
 const wasSubmitted=submitted;
 const previousChoice=selected;
 pollActive=!!x.pollActive;
 const votingOpen=!!x.pollVotingOpen; window.__audienceVotingOpen=votingOpen;
 if(!pollActive){submitted=false;selected=null}
 if(x.question)renderAnswers(x);
 if(x.pollCounts)renderPoll(x.pollCounts);
 if(wasSubmitted && previousChoice!==null && pollActive){
   submitted=true;selected=previousChoice;
   renderAnswers(x);
 }
 setStatus(pollActive
   ?(submitted?`✓ Vote submitted: ${String.fromCharCode(65+selected)}. Your vote is counted live.`:votingOpen?"🗳️ Poll is live — select your answer.":"📺 Poll is ready. Waiting for the Host to start the 60-second countdown…")
   :"Waiting for the Host to open the audience poll…");
});
s.on("poll",c=>{
 renderPoll(c);
 const total=Object.values(c||{}).reduce((a,b)=>a+Number(b||0),0);
 if(pollActive && window.__audienceVotingOpen && joined && !submitted) setStatus(`🗳️ Poll is live — ${total} vote${total===1?"":"s"} received. Select your answer.`);
});

s.on("audiencePollStopped",()=>{pollActive=false;submitted=false;selected=null;renderAnswers({question:null});setStatus("Waiting for the Host to open the audience poll…");});
