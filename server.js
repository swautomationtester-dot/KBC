const path=require("path"),http=require("http"),express=require("express"),crypto=require("crypto");
const {Server}=require("socket.io"),QRCode=require("qrcode"),mysql=require("mysql2/promise");
const independenceBank=require("./questions.json");
const app=express(),server=http.createServer(app),io=new Server(server,{cors:{origin:true}});
const PORT=Number(process.env.PORT)||10000;
const PUBLIC_URL=(process.env.PUBLIC_URL||`http://localhost:${PORT}`).replace(/\/$/,"");
const ADMIN_USERNAME=process.env.ADMIN_USERNAME||"admin";
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"change-me";
const adminSessions=new Map();
function makeAdminToken(){return crypto.randomBytes(32).toString("hex")}
function getCookie(req,name){
 const raw=req.headers.cookie||"";
 const m=raw.match(new RegExp("(?:^|;\\s*)"+name+"=([^;]+)"));
 return m?decodeURIComponent(m[1]):"";
}
function isAdmin(req){
 const token=getCookie(req,"quiz_admin");
 return !!token && adminSessions.has(token);
}
function requireAdmin(req,res,next){
 if(!isAdmin(req))return res.status(401).json({error:"Admin login required."});
 next();
}
app.use(express.json());app.use(express.static(path.join(__dirname,"public")));

const fallback=[];
let db=null;
async function initDb(){
 if(!process.env.DB_HOST)return;
 db=await mysql.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,port:Number(process.env.DB_PORT||3306),connectionLimit:5});
 await db.query(`CREATE TABLE IF NOT EXISTS questions(id INT AUTO_INCREMENT PRIMARY KEY,text_q TEXT NOT NULL,option_a VARCHAR(500) NOT NULL,option_b VARCHAR(500) NOT NULL,option_c VARCHAR(500) NOT NULL,option_d VARCHAR(500) NOT NULL,answer_idx TINYINT NOT NULL,points INT NOT NULL DEFAULT 100)`);
 // v59: bundled questions.json is authoritative; do not seed the old
 // fallback questions into the database.
}
async function questions(){
 const bank=JSON.parse(fs.readFileSync(path.join(__dirname,"questions.json"),"utf8"));
 return structuredClone(bank);
}

// Build a fresh 5-question game from the question bank.
// Questions progress from easy to hard and never repeat the same source fact
// within a game. Options are shuffled so the correct answer is not always
// in the same position.
const GAME_POINTS=[1000,2000,5000,10000,50000];
const GAME_DIFFICULTY=[1,2,3,4,5];
const TOTAL_QUESTIONS=5;
const QUESTION_BANK_VERSION="INDIA-INDEPENDENCE-10-v1";

function shuffleCopy(arr){
 const a=Array.isArray(arr)?arr.slice():[];
 for(let i=a.length-1;i>0;i--){
   const j=Math.floor(Math.random()*(i+1));
   [a[i],a[j]]=[a[j],a[i]];
 }
 return a;
}
function buildGameQuestions(bank){
 const groups=[
   (bank||[]).filter(q=>Number(q.difficulty)===1),
   (bank||[]).filter(q=>Number(q.difficulty)===2),
   (bank||[]).filter(q=>Number(q.difficulty)===3),
   (bank||[]).filter(q=>Number(q.difficulty)===4)
 ];
 const selected=[];
 [1,1,1,2].forEach((count,g)=>selected.push(...shuffleCopy(groups[g]).slice(0,count)));
 const game=selected.slice(0,TOTAL_QUESTIONS);
 game.forEach((q,index)=>{
   const original=q.options.slice(), correct=original[q.answer];
   q.options=shuffleCopy(original);
   q.answer=q.options.indexOf(correct);
   q.points=GAME_POINTS[index];
   q.difficulty=index+1;
 });
 return game;
}

const rooms=new Map();
function pollCounts(poll){
  const c={0:0,1:0,2:0,3:0};
  for(const choice of (poll?.values?.()||[])){
    const v=Number(choice);
    if(v>=0&&v<=3)c[v]++;
  }
  return c;
}

function makeRoom(){return{host:null,users:new Map(),questions:[],current:-1,phase:"lobby",pool:[],winner:null,completed:new Set(),played:new Set(),failed:new Set(),answers:new Map(),pendingAnswer:null,pendingPollRequest:null,poll:new Map(),lifelines:new Set(),fiftyFiftyRemoved:new Map(),timer:null,fastestSize:7,fastestStartAt:0,fastestDurationMs:15000,fastestSequence:[],fastestTimes:new Map(),fastestProgress:new Map(),fastestToken:"",fastestJoinUrl:"",fastestJoinQr:"",screenToken:"",screenUrl:"",screenQr:"",audiencePollUrl:"",audiencePollQr:"",pollActive:false,winnerCelebrationUntil:0,contestantId:null,eliminatedContestant:null,ladder:[1000,2000,5000,10000,50000]}}
function active(r){return [...r.users.values()].filter(u=>u.status==="active")}
function emitState(code){
 const r=rooms.get(code);if(!r)return;
 const q=r.questions[r.current];
 const now=Date.now();
 const remaining=r.phase==="fastest"?Math.max(0,r.fastestStartAt+r.fastestDurationMs-now):0;
 io.to(code).emit("state",{
  phase:r.phase,current:r.current,totalQuestions:TOTAL_QUESTIONS,winnerCelebrationUntil:r.winnerCelebrationUntil||0,
  question:q?{text:q.text,options:q.options,points:q.points}:null,
  users:[...r.users.values()].map(u=>({id:u.id,name:u.name,employeeCode:u.employeeCode,score:u.score,status:u.status})),
  registered:r.users.size,active:active(r).length,contestantId:r.contestantId||null,
  pool:r.pool.map(u=>({id:u.id,name:u.name,employeeCode:u.employeeCode})),
  winner:r.winner?{name:r.winner.name,employeeCode:r.winner.employeeCode,time:r.winner.time}:null,contestant:r.winner?{id:r.winner.id,name:r.winner.name,employeeCode:r.winner.employeeCode}:null,eliminatedContestant:r.eliminatedContestant||null,currentAnswer:r.answers.size?[...r.answers.values()][0]:null,pendingAnswer:r.pendingAnswer||null,pendingPollRequest:r.pendingPollRequest||null,
  fastestStartAt:r.fastestStartAt,
  fastestDurationMs:r.fastestDurationMs,
  fastestRemaining:remaining,
  fastestSequence:r.fastestSequence,
  fastestTimes:[...r.fastestTimes.entries()].map(([employeeCode,v])=>({employeeCode,name:v.name,time:v.time,status:v.status})),
  fastestProgress:[...r.fastestProgress.entries()].map(([employeeCode,v])=>({employeeCode,name:v.name,sequence:v.sequence,time:v.time,status:v.status,attempts:v.attempts})),
  roomCode:code,
  joinUrl:r.joinUrl,
  joinQr:r.joinQr,
  audiencePollUrl:r.audiencePollUrl,
  audiencePollQr:r.audiencePollQr,
  pollActive:r.pollActive,
  // Expose poll results as answer-choice counts (0..3), never as
  // audience socket-id -> choice pairs. This keeps every client in sync
  // after the state broadcast that follows a vote.
  pollCounts:pollCounts(r.poll),
  fiftyFiftyRemoved:(r.current>=0)?(r.fiftyFiftyRemoved.get(r.current)||[]):[],
  lifelines:(r.winner&&r.current>=0)?{
    "5050":!!r.winner.lifelinesUsed?.["5050"],
    "audience":!!r.winner.lifelinesUsed?.audience,
    "phone":!!r.winner.lifelinesUsed?.phone
  }:{},
  fastestToken:r.fastestToken,
  fastestJoinUrl:r.fastestJoinUrl,
  fastestJoinQr:r.fastestJoinQr,
  screenUrl:r.screenUrl,
  screenQr:r.screenQr,
  ladder:r.ladder
 });
 // Never expose the correct answer to players, TV or audience.
 if(r.host){
   const hostSocket=io.sockets.sockets.get(r.host);
   if(hostSocket){
     hostSocket.emit("hostQuestion", q?{text:q.text,options:q.options,answer:q.answer,points:q.points,difficulty:q.difficulty,sourceFact:q.sourceFact}:null);
   }
 }
}
async function startFastest(r, keepPool=false){
 if(!keepPool){
  // A player who has already entered the main quiz is permanently out of
  // the Fastest Finger queue for this event. Players who only missed a
  // Fastest Finger round remain eligible for a later selection.
  const eligible=[...r.users.values()]
    .filter(u=>u.status==="active")
    .filter(u=>!r.played.has(u.employeeCode))
    .filter(u=>!r.completed.has(u.employeeCode))
    .filter(u=>u.id!==r.contestantId)
    .filter(u=>!u.inPool);
  r.pool=eligible.sort(()=>Math.random()-.5).slice(0,Math.min(r.fastestSize,eligible.length));
 }
 r.winner=null;
 r.fastestTimes=new Map();
 r.fastestProgress=new Map();
 r.fastestSequence=Array.from({length:5},()=>Math.floor(Math.random()*4));
 r.fastestToken=crypto.randomBytes(12).toString("base64url");
 const roomCode=[...rooms.entries()].find(([,room])=>room===r)?.[0]||"";
 r.fastestJoinUrl=`${PUBLIC_URL}/join.html?room=${encodeURIComponent(roomCode)}&game=${encodeURIComponent(r.fastestToken)}`;
 r.fastestJoinQr=await QRCode.toDataURL(r.fastestJoinUrl,{margin:1,width:280});
 if(!r.pool.length){r.phase="finished";return}
 r.pool.forEach(u=>u.inPool=true);
 r.fastestStartAt=Date.now()+5000;
 r.phase="fastest";
 clearTimeout(r.timer);
 r.timer=setTimeout(()=>{
   if(r.phase!=="fastest")return;
   r.phase="fastestTimeout";
   r.pool.forEach(u=>{
     // This Fastest Finger round is over for everyone. They remain
     // registered and can be selected again in a future round unless they
     // have actually entered the main quiz.
     u.inPool=false;
     const existing=r.fastestProgress.get(u.employeeCode);
     if(!r.fastestTimes.has(u.employeeCode))
       r.fastestTimes.set(u.employeeCode,{name:u.name,time:r.fastestDurationMs,status:"TIMEOUT"});
     r.fastestProgress.set(u.employeeCode,{
       name:u.name,
       sequence:existing?.sequence||[],
       time:r.fastestDurationMs,
       status:"TIMEOUT",
       attempts:existing?.attempts||0
     });
   });
   const code=[...rooms.entries()].find(([,room])=>room===r)?.[0];
   if(code)emitState(code);
 },5000+r.fastestDurationMs);
}
async function pick7(r){ await startFastest(r,false); }
async function restartFastest(r){ await startFastest(r,true); }
function nextContestant(code){
 const r=rooms.get(code);if(!r)return;
 r.phase="eliminated";
 r.current=-1;
 emitState(code);
 clearTimeout(r.timer);
 r.timer=setTimeout(async ()=>{
   const x=rooms.get(code);if(!x)return;
   x.current=-1;
   x.pendingAnswer=null;
   x.winner=null;
   x.pool=[];
   x.contestantId=null;
   x.eliminatedContestant=null;
   // The contestant has already played the main quiz and must not return
   // to the Fastest Finger queue. Only players who lost Fastest Finger
   // itself remain eligible for later selections.
   for(const u of x.users.values()) u.inPool=false;
   await startFastest(x,false);
   emitState(code);
 },5000);
}


app.get("/api/screen/:token",(req,res)=>{
 const entry=[...rooms.entries()].find(([,r])=>r.screenToken===req.params.token);
 if(!entry)return res.status(404).json({error:"This TV screen link has expired or is invalid."});
 res.json({roomCode:entry[0]});
});
app.get("/screen/:token",(req,res)=>{
 const entry=[...rooms.entries()].find(([,r])=>r.screenToken===req.params.token);
 if(!entry)return res.status(404).send("This TV screen link has expired or is invalid.");
 res.sendFile(path.join(__dirname,"public","tv.html"));
});
app.get("/health",(req,res)=>res.json({ok:true,service:"perficient-office-quiz-arena",version:"52.0.0"}));
app.get("/api/questions",async(req,res)=>{try{res.json(await questions())}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/admin/login",(req,res)=>{
 const {username,password}=req.body||{};
 if(String(username||"")!==ADMIN_USERNAME || String(password||"")!==ADMIN_PASSWORD)
   return res.status(401).json({ok:false,error:"Invalid admin username or password."});
 const token=makeAdminToken();
 adminSessions.set(token,{createdAt:Date.now()});
 res.setHeader("Set-Cookie",`quiz_admin=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`);
 res.json({ok:true});
});
app.post("/api/admin/logout",(req,res)=>{
 const token=getCookie(req,"quiz_admin");
 if(token)adminSessions.delete(token);
 res.setHeader("Set-Cookie","quiz_admin=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
 res.json({ok:true});
});
app.get("/api/admin/me",(req,res)=>res.json({ok:isAdmin(req)}));
app.get("/api/questions",requireAdmin,async(req,res)=>res.json(await questions()));
app.post("/api/questions",requireAdmin,async(req,res)=>{
 if(!db)return res.status(400).json({error:"Database not configured"});
 const {text,options,answer,points}=req.body||{};
 if(!text||!Array.isArray(options)||options.length!==4)return res.status(400).json({error:"Invalid question"});
 await db.query("INSERT INTO questions(text_q,option_a,option_b,option_c,option_d,answer_idx,points) VALUES(?,?,?,?,?,?,?)",[text,...options,answer,points]);
 res.json({ok:true});
});


// ===== Card Match mini-game =====
const cardMatchRooms=new Map();
const CM_ICONS=["🍎","🚀","🐼","🌈","⚽","🍕","🦊","🎸","🌟","🐸","🍩","🦄"];
function cmDeck(){const a=CM_ICONS.slice(0,8);return [...a,...a].map((icon,id)=>({id,icon,matched:false})).sort(()=>Math.random()-0.5)}
function cmCode(){let c;do c=String(Math.floor(1000+Math.random()*9000));while(cardMatchRooms.has(c));return c}
function cmState(r){return {code:r.code,status:r.status,turn:r.turn,flipped:r.flipped,deck:r.deck,players:r.players.map(p=>({id:p.id,name:p.name,color:p.color,score:p.score})),winner:r.winner}}
function cmBroadcast(r){io.to(r.channel).emit("cm:state",cmState(r))}
function cmReset(r){r.deck=cmDeck();r.flipped=[];r.turn=0;r.status="playing";r.winner=[];r.players.forEach(p=>p.score=0)}
io.on("connection",s=>{
 s.on("cm:create",()=>{
   const code=cmCode(),channel="cardmatch-"+code;
   const r={code,channel,tv:s.id,players:[],deck:[],flipped:[],turn:0,status:"lobby",winner:[]};
   cardMatchRooms.set(code,r);s.join(channel);s.data.cmRoom=code;s.data.cmRole="tv";
   const proto=String(s.handshake.headers["x-forwarded-proto"]||"http").split(",")[0].trim().replace(/:$/,""),host=String(s.handshake.headers.host||"").trim();
   s.emit("cm:room",{code,joinUrl:`${proto}://${host}/card-match.html?join=${code}`});cmBroadcast(r);
 });
 s.on("cm:join",({code,name}={})=>{
   const r=cardMatchRooms.get(String(code||""));if(!r)return s.emit("cm:error",{message:"Room not found."});
   if(r.status!=="lobby")return s.emit("cm:error",{message:"Game already started."});
   if(r.players.length>=4)return s.emit("cm:error",{message:"Room is full."});
   const p={id:s.id,name:String(name||"Player").trim().slice(0,18),score:0,color:["#ff5c7a","#5c8dff","#20c997","#ffb020"][r.players.length]};
   r.players.push(p);s.join(r.channel);s.data.cmRoom=r.code;s.data.cmRole="player";s.emit("cm:joined",{playerId:p.id,code:r.code});cmBroadcast(r);
 });
 s.on("cm:start",({code}={})=>{
   const roomCode=String(code||s.data.cmRoom||"").trim();
   const r=cardMatchRooms.get(roomCode);
   if(!r)return s.emit("cm:error",{message:"The game room is no longer available. Create a new game."});
   if(s.id!==r.tv)return s.emit("cm:error",{message:"Only the TV that created this room can start the match."});
   if(r.players.length<2)return s.emit("cm:error",{message:"At least 2 players must join before starting."});
   cmReset(r);cmBroadcast(r);
 });
 s.on("cm:restart",({code}={})=>{
   const roomCode=String(code||s.data.cmRoom||"").trim();
   const r=cardMatchRooms.get(roomCode);
   if(!r)return s.emit("cm:error",{message:"The game room is no longer available."});
   if(s.id!==r.tv)return s.emit("cm:error",{message:"Only the TV can restart the match."});
   if(r.players.length<2)return s.emit("cm:error",{message:"At least 2 players must join before restarting."});
   cmReset(r);cmBroadcast(r);
 });
 s.on("cm:flip",({cardId}={})=>{
   const r=cardMatchRooms.get(String(s.data.cmRoom||""));if(!r||r.status!=="playing")return;
   const idx=r.players.findIndex(p=>p.id===s.id);if(idx!==r.turn||r.flipped.length>=2)return;
   const c=r.deck.find(x=>x.id===Number(cardId));if(!c||c.matched||r.flipped.includes(c.id))return;
   r.flipped.push(c.id);cmBroadcast(r);
   if(r.flipped.length===2){const a=r.deck.find(x=>x.id===r.flipped[0]),b=r.deck.find(x=>x.id===r.flipped[1]);
     setTimeout(()=>{if(!cardMatchRooms.has(r.code))return;
       if(a.icon===b.icon){a.matched=b.matched=true;r.players[r.turn].score++}else r.turn=(r.turn+1)%r.players.length;
       r.flipped=[];
       if(r.deck.every(x=>x.matched)){r.status="finished";const max=Math.max(...r.players.map(p=>p.score));r.winner=r.players.filter(p=>p.score===max).map(p=>p.name)}
       cmBroadcast(r);
     },800);
   }
 });

 s.on("host:create",async()=>{let code;do code=String(Math.floor(1000+Math.random()*9000));while(rooms.has(code));const r=makeRoom();r.host=s.id;r.questions=[];rooms.set(code,r);s.join(code);s.data.room=code;s.data.role="host";const joinUrl=`${PUBLIC_URL}/join.html?room=${code}`;r.joinUrl=joinUrl;r.joinQr=await QRCode.toDataURL(joinUrl);r.screenToken=crypto.randomBytes(14).toString("base64url");r.screenUrl=`${PUBLIC_URL}/screen/${r.screenToken}`;r.screenQr=await QRCode.toDataURL(r.screenUrl,{margin:1,width:280});r.audiencePollUrl=`${PUBLIC_URL}/audience.html?room=${code}`;r.audiencePollQr=await QRCode.toDataURL(r.audiencePollUrl,{margin:1,width:320});s.emit("room",{code,joinUrl,qr:r.joinQr,screenUrl:r.screenUrl,screenQr:r.screenQr,audiencePollUrl:r.audiencePollUrl,audiencePollQr:r.audiencePollQr});emitState(code)});
 s.on("join",({code,name,employeeCode,role="player",game})=>{code=String(code||"").trim();const r=rooms.get(code);if(!/^\d{4}$/.test(code))return s.emit("errorMsg","Room code must be exactly 4 digits.");if(!r)return s.emit("errorMsg","Room not found. Ask the host for a new code.");
 if(game){const ec=String(employeeCode||"").trim();if(game!==r.fastestToken)return s.emit("errorMsg","This Fastest Finger QR is no longer active.");if(!/^\d+$/.test(ec))return s.emit("errorMsg","Register number must contain numbers only.");if(!r.pool.some(p=>p.employeeCode===ec))return s.emit("errorMsg","You are not selected for this Fastest Finger round.");}
 s.join(code);s.data.room=code;s.data.role=role;if(role==="audience"||role==="tv"||role==="roster"){s.emit("joined",{name:role==="tv"?"TV Screen":role==="roster"?"Roster Viewer":"Audience"});emitState(code);return}name=String(name||"").trim();employeeCode=String(employeeCode||"").trim();if(!/^[A-Za-z]+(?:[ ][A-Za-z]+)*$/.test(name))return s.emit("errorMsg","Name must contain alphabets only.");if(!/^\d+$/.test(employeeCode))return s.emit("errorMsg","Register number must contain numbers only.");if([...r.users.values()].some(u=>u.employeeCode===employeeCode))return s.emit("errorMsg","This register number is already registered.");r.users.set(s.id,{id:s.id,name,employeeCode,score:0,status:"active",inPool:false,lifelinesUsed:{"5050":false,"audience":false,"phone":false},registeredAt:Date.now()});s.emit("joined",{name,employeeCode});emitState(code)});
 s.on("host:showParticipants",()=>{
  const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;
  s.emit("participantsList",[...r.users.values()].map(u=>({name:u.name,employeeCode:u.employeeCode,score:u.score,status:u.status,registeredAt:u.registeredAt})));
});
s.on("host:openRegistration",()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;r.pollActive=false;r.poll.clear();r.phase="registration";emitState(s.data.room)});
 s.on("player:requestAudiencePoll",()=>{
  const r=rooms.get(s.data.room);if(!r||r.phase!=="question")return;
  const u=r.users.get(s.id);if(!u||u.status!=="active"||!r.winner||r.winner.id!==s.id)return;
  if(r.pollActive||r.pendingPollRequest)return;
  r.pendingPollRequest={id:s.id,name:u.name,employeeCode:u.employeeCode,requestedAt:Date.now()};
  io.to(s.data.room).emit("audiencePollRequested",{contestant:{name:u.name,employeeCode:u.employeeCode}});
  emitState(s.data.room);
 });
 s.on("host:approveAudiencePoll",()=>{
  const r=rooms.get(s.data.room);if(!r||r.host!==s.id||!r.pendingPollRequest||r.phase!=="question")return;
  const req=r.pendingPollRequest;r.pendingPollRequest=null;r.poll.clear();r.pollActive=true;
  const lifelineKey=`${req.id}:${r.current}:audience`;
  r.lifelines.add(lifelineKey);
  if(r.winner?.id===req.id) r.winner.lifelinesUsed={...(r.winner.lifelinesUsed||{}),audience:true};
  io.to(req.id).emit("audiencePollApproved",{contestant:req,counts:pollCounts(r.poll)});
  io.to(s.data.room).emit("audiencePollStarted",{contestant:req});
  emitState(s.data.room);
 });
 s.on("host:rejectAudiencePoll",()=>{
  const r=rooms.get(s.data.room);if(!r||r.host!==s.id||!r.pendingPollRequest)return;
  const req=r.pendingPollRequest;r.pendingPollRequest=null;
  io.to(req.id).emit("audiencePollRejected",{contestant:req});
  io.to(s.data.room).emit("audiencePollRejected",{contestant:req});
  emitState(s.data.room);
 });
 s.on("host:audiencePollStart",()=>{
 const r=rooms.get(s.data.room);if(!r||r.host!==s.id||r.phase!=="question")return;
 if(!r.winner)return;
 const key=`${r.winner.id}:${r.current}:audience`;
 if(r.lifelines.has(key)){
   s.emit("errorMsg","Audience Poll has already been used for this question.");
   return;
 }
 r.pendingPollRequest=null;
 r.poll.clear();
 r.pollActive=true;
 const lifelineKey=`${r.winner.id}:${r.current}:audience`;
 r.lifelines.add(lifelineKey);
 r.winner.lifelinesUsed={...(r.winner.lifelinesUsed||{}),audience:true};
 io.to(r.winner.id).emit("audiencePollApproved",{contestant:{name:r.winner.name,employeeCode:r.winner.employeeCode},counts:pollCounts(r.poll)});
 io.to(s.data.room).emit("audiencePollStarted",{contestant:{name:r.winner.name,employeeCode:r.winner.employeeCode}});
 emitState(s.data.room);
});
 s.on("host:audiencePollStop",()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;r.pollActive=false;io.to(s.data.room).emit("audiencePollStopped");emitState(s.data.room)});
 s.on("host:pick7",async()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;await pick7(r);emitState(s.data.room)});
 s.on("fastest:progress",({value})=>{
  const r=rooms.get(s.data.room);
  if(!r||r.phase!=="fastest")return;
  const u=r.users.get(s.id);
  if(!u||u.status!=="active"||!r.pool.some(p=>p.id===s.id))return;
  const now=Date.now();
  if(now<r.fastestStartAt||now>r.fastestStartAt+r.fastestDurationMs)return;

  let p=r.fastestProgress.get(u.employeeCode);
  if(!p){
    p={name:u.name,sequence:[],time:0,status:"READY",attempts:0};
    r.fastestProgress.set(u.employeeCode,p);
  }
  if(r.winner)return;

  const v=Number(value);
  const expected=r.fastestSequence[p.sequence.length];
  const elapsed=now-r.fastestStartAt;

  if(v!==expected){
    p.sequence=[];
    p.time=elapsed;
    p.status="WRONG — RESET";
    p.attempts++;
    s.emit("fastestProgressResult",{correct:false,reset:true,elapsed});
    emitState(s.data.room);
    return;
  }

  p.sequence.push(v);
  p.time=elapsed;
  p.status=p.sequence.length===r.fastestSequence.length?"COMPLETED":"IN PROGRESS";
  s.emit("fastestProgressResult",{correct:true,index:p.sequence.length-1,complete:p.status==="COMPLETED",elapsed});

  if(p.status==="COMPLETED"){
    r.fastestTimes.set(u.employeeCode,{name:u.name,time:elapsed,status:"COMPLETED"});
    if(!r.winner){
      r.winner={...u,time:elapsed};
      r.pool.filter(other=>other.id!==s.id).forEach(other=>{
        // They lost this Fastest Finger round, but remain eligible for
        // a later round.
        other.status="active";
        other.inPool=false;
      });
      u.inPool=false;
      r.pool=[u];
      r.phase="fastestResult";
      clearTimeout(r.timer);
    }
  }
  emitState(s.data.room);
 });

 s.on("host:startQuiz",async()=>{
 const r=rooms.get(s.data.room);
 if(!r||r.host!==s.id)return;
 if(!r.winner || r.phase!=="fastestResult"){
   s.emit("errorMsg","Fastest Finger must have a winner before the main quiz can start.");
   return;
 }
 r.contestantId=r.winner.id;
 // Mark the player as having participated as soon as the host starts the
 // quiz. This prevents the same player from appearing in any later
 // Fastest Finger selection, even if they are eliminated before the quiz is completed.
 r.played.add(r.winner.employeeCode);
 const bank=await questions();
 r.questions=buildGameQuestions(bank);
 r.phase="question";r.current=0;r.answers.clear();r.pendingAnswer=null;r.pendingPollRequest=null;r.poll.clear();r.lifelines.clear();r.fiftyFiftyRemoved.clear();r.eliminatedContestant=null;if(r.winner){
   r.winner.lifelinesUsed={"5050":false,"audience":false,"phone":false};
   const contestantUser=r.users.get(r.winner.id);
   if(contestantUser)contestantUser.lifelinesUsed={"5050":false,"audience":false,"phone":false};
 }
 emitState(s.data.room);
});
 s.on("host:nextFastest",async()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;await pick7(r);emitState(s.data.room)});
 s.on("host:restartFastest",async()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;if(!r.pool.length)return;await restartFastest(r);emitState(s.data.room)});
 s.on("host:nextQuestion",()=>{
 const r=rooms.get(s.data.room);if(!r||r.host!==s.id||r.phase!=="question")return;
 r.current++;
 r.answers.clear();r.pendingAnswer=null;r.pendingPollRequest=null;r.poll.clear();r.lifelines.clear();
 if(r.current>=TOTAL_QUESTIONS||r.current>=r.questions.length){
   r.phase="finished";r.current=-1;
   clearTimeout(r.timer);
   r.timer=setTimeout(()=>{
     const x=rooms.get(s.data.room);if(!x)return;
     x.winner=null;x.pool=[];x.pendingAnswer=null;x.pendingPollRequest=null;
     for(const u of x.users.values())u.inPool=false;
     x.phase="registration";emitState(s.data.room);
   },5000);
 }else r.phase="question";
 emitState(s.data.room);
});
 s.on("host:restartEvent",()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;for(const u of r.users.values()){u.score=0;u.status="active";u.inPool=false;u.lifelinesUsed={"5050":false,"audience":false,"phone":false}}r.contestantId=null;r.failed.clear();r.completed.clear();r.played.clear();r.pool=[];r.winner=null;r.current=-1;r.fiftyFiftyRemoved.clear();r.eliminatedContestant=null;r.phase="registration";emitState(s.data.room)});
 s.on("player:answer",({choice})=>{
  const r=rooms.get(s.data.room);if(!r||r.phase!=="question")return;
  const u=r.users.get(s.id);
  if(!u||u.status!=="active"||!r.winner||r.winner.id!==s.id)return;
  if(r.pendingAnswer)return;
  const q=r.questions[r.current],picked=Number(choice);
  if(picked<0||picked>3)return;
  r.pendingAnswer={playerId:s.id,name:u.name,employeeCode:u.employeeCode,choice:picked,option:q.options[picked],lockedAt:Date.now()};
  io.to(s.data.room).emit("answerLocked",{
    contestant:{name:u.name,employeeCode:u.employeeCode},
    choice:picked,option:q.options[picked]
  });
  emitState(s.data.room);
 });

 s.on("host:approveAnswer",()=>{
  const r=rooms.get(s.data.room);if(!r||r.host!==s.id||r.phase!=="question"||!r.pendingAnswer)return;
  const pending=r.pendingAnswer,u=r.users.get(pending.playerId),q=r.questions[r.current];
  if(!u)return;
  const ok=pending.choice===q.answer;
  r.answers.set(pending.playerId,{choice:pending.choice,ok,approved:true});
  r.pendingAnswer=null;
  io.to(s.data.room).emit("answerRevealed",{
    contestant:{name:u.name,employeeCode:u.employeeCode},
    choice:pending.choice,option:q.options[pending.choice],correct:ok,correctChoice:q.answer,points:q.points
  });
  if(ok){
    u.score=q.points;
    u.status="active";
    io.to(s.data.room).emit("answerResult",{correct:true,points:q.points,approved:true});
    emitState(s.data.room);
    clearTimeout(r.timer);
    r.timer=setTimeout(()=>{
      const x=rooms.get(s.data.room);
      if(!x||x.phase!=="question"||x.current<0)return;
      x.current++;
      x.answers.clear();
      x.pendingAnswer=null;
      x.poll.clear();
      x.lifelines.clear();
      if(x.current>=TOTAL_QUESTIONS||x.current>=x.questions.length){
        x.phase="winnerCelebration";
        x.current=-1;
        x.winnerCelebrationUntil=Date.now()+30000;
        clearTimeout(x.timer);
        x.timer=setTimeout(async ()=>{
          const y=rooms.get(s.data.room);
          if(!y)return;
          if(y.winner?.employeeCode){
            y.completed.add(y.winner.employeeCode);
            const finished=y.users.get(y.winner.id);
            if(finished){
              finished.status="completed";
              finished.inPool=false;
            }
          }
          y.contestantId=null;
          y.winner=null;y.pool=[];y.pendingAnswer=null;y.pendingPollRequest=null;
          y.winnerCelebrationUntil=0;
          for(const u of y.users.values()){u.inPool=false}
          await startFastest(y,false);
          emitState(s.data.room);
        },30000);
      }else{
        x.phase="question";
      }
      emitState(s.data.room);
    },3000);
  }else{
    u.status="eliminated";
    r.eliminatedContestant={
      id:u.id,
      name:u.name,
      employeeCode:u.employeeCode,
      score:u.score,
      pointsEarned:u.score,
      eliminatedAt:Date.now(),
      until:Date.now()+30000
    };
    const eliminationUntil=Date.now()+30000;
    r.eliminatedContestant.until=eliminationUntil;
    io.to(s.data.room).emit("answerResult",{
      correct:false,
      eliminated:true,
      approved:true,
      contestant:{name:u.name,employeeCode:u.employeeCode},
      pointsEarned:u.score
    });
    // Targeted event keeps the eliminated contestant on the 30-second
    // farewell screen even while the room moves on to the next Fastest Finger.
    io.to(u.id).emit("eliminationNotice",{
      name:u.name,
      employeeCode:u.employeeCode,
      score:u.score,
      pointsEarned:u.score,
      until:eliminationUntil
    });
    nextContestant(s.data.room);
    setTimeout(()=>{
      const x=rooms.get(s.data.room);
      if(x&&x.eliminatedContestant&&x.eliminatedContestant.employeeCode===u.employeeCode){
        x.eliminatedContestant=null;
        emitState(s.data.room);
      }
    },30000);
  }
 });

 s.on("host:rejectAnswer",()=>{
  const r=rooms.get(s.data.room);if(!r||r.host!==s.id||!r.pendingAnswer)return;
  const pending=r.pendingAnswer;r.pendingAnswer=null;
  io.to(s.data.room).emit("answerRejected",{contestant:{name:pending.name,employeeCode:pending.employeeCode}});
  emitState(s.data.room);
 });

 s.on("audience:poll",({choice},ack)=>{
  const ok=(value)=>{if(typeof ack==="function")ack(value)};
  const r=rooms.get(s.data.room);
  if(!r){ok({ok:false,error:"You are not connected to a quiz room."});return}
  if(r.phase!=="question"||!r.pollActive){ok({ok:false,error:"The audience poll is closed."});return}
  // One vote per connected audience device for the current poll.
  if(r.poll.has(s.id)){ok({ok:false,error:"You have already voted in this audience poll."});return}
  const v=Number(choice);
  if(!Number.isInteger(v)||v<0||v>3){ok({ok:false,error:"Invalid poll choice."});return}
  r.poll.set(s.id,v);
  const c=pollCounts(r.poll);
  ok({ok:true,choice:v,count:c[v]||0,total:r.poll.size});
  io.to(s.data.room).emit("poll",c);
  emitState(s.data.room);
});
 s.on("lifeline",({type})=>{
 const r=rooms.get(s.data.room);if(!r||r.phase!=="question")return;
 const u=r.users.get(s.id);if(!u||u.status!=="active"||!r.winner||r.winner.id!==s.id)return;
 u.lifelinesUsed=u.lifelinesUsed||{"5050":false,"audience":false,"phone":false};
 if(u.lifelinesUsed[type]){s.emit("lifelineResult",{type,error:`${type==="5050"?"50:50":type==="audience"?"Audience Poll":"Phone-a-Friend"} has already been used for this quiz.`});return;}
 const q=r.questions[r.current];
 if(type==="5050"){
   u.lifelinesUsed["5050"]=true;
   if(r.winner && r.winner.id===u.id){
     r.winner.lifelinesUsed=r.winner.lifelinesUsed||{"5050":false,"audience":false,"phone":false};
     r.winner.lifelinesUsed["5050"]=true;
   }
   const remove=q.options.map((_,i)=>i).filter(i=>i!==q.answer).sort(()=>Math.random()-.5).slice(0,2);
   r.fiftyFiftyRemoved.set(r.current,remove);
   s.emit("lifelineResult",{type,remove,used:true});
   emitState(s.data.room);
 }else if(type==="audience"){
   if(!r.pollActive){s.emit("lifelineResult",{type,error:"The host has not opened the Audience Poll yet."});return;}
   u.lifelinesUsed.audience=true;
   if(r.winner && r.winner.id===u.id){
     r.winner.lifelinesUsed=r.winner.lifelinesUsed||{"5050":false,"audience":false,"phone":false};
     r.winner.lifelinesUsed.audience=true;
   }
   s.emit("lifelineResult",{type,counts:pollCounts(r.poll),used:true});
   emitState(s.data.room);
 }else if(type==="phone"){
   u.lifelinesUsed.phone=true;
   if(r.winner && r.winner.id===u.id){
     r.winner.lifelinesUsed=r.winner.lifelinesUsed||{"5050":false,"audience":false,"phone":false};
     r.winner.lifelinesUsed.phone=true;
   }
   s.emit("lifelineResult",{type,message:"Ask a colleague and then choose your answer.",used:true});
   emitState(s.data.room);
 }
});
 s.on("disconnect",()=>{const r=rooms.get(s.data.room);if(!r)return;if(r.host===s.id){clearTimeout(r.timer);io.to(s.data.room).emit("errorMsg","Host disconnected. Room closed.");rooms.delete(s.data.room)}});
});
initDb().then(()=>server.listen(PORT,"0.0.0.0",()=>console.log(`Perficient Office Quiz Arena v4 listening on 0.0.0.0:${PORT}`))).catch(e=>{console.error("Startup error:",e);process.exit(1)});
