const path=require("path"),fs=require("fs"),http=require("http"),express=require("express"),crypto=require("crypto");
const {Server}=require("socket.io"),QRCode=require("qrcode"),mysql=require("mysql2/promise");
const independenceBank=require("./questions.json");
const app=express(),server=http.createServer(app),io=new Server(server,{cors:{origin:true}});
const PORT=Number(process.env.PORT)||10000;
const PUBLIC_URL=(process.env.PUBLIC_URL||"").replace(/\/$/,"");
function getPublicUrlForSocket(s){
  const configured=String(PUBLIC_URL||"").trim();
  const configuredIsLocal=!configured || /localhost|127\\.0\\.0\\.1/i.test(configured);
  if(!configuredIsLocal)return configured;
  const h=s.handshake?.headers||{};
  const proto=String(h["x-forwarded-proto"]||h["x-forwarded-scheme"]||"http").split(",")[0].trim().replace(/:$/,"");
  const host=String(h["x-forwarded-host"]||h.host||"").split(",")[0].trim();
  if(host && !/localhost|127\\.0\\.0\\.1/i.test(host)) return `${proto}://${host}`;
  return `http://localhost:${PORT}`;
}

const DATA_DIR=path.join(__dirname,"data");
const REGISTERED_USERS_FILE=path.join(DATA_DIR,"registered-users.json");

function loadRegisteredUsers(){
  try{
    fs.mkdirSync(DATA_DIR,{recursive:true});
    if(!fs.existsSync(REGISTERED_USERS_FILE)) return new Map();
    const raw=JSON.parse(fs.readFileSync(REGISTERED_USERS_FILE,"utf8"));
    return new Map((Array.isArray(raw)?raw:[]).map(u=>[String(u.employeeCode),u]));
  }catch(err){
    console.error("Could not load registered users:",err.message);
    return new Map();
  }
}

const registeredUsers=loadRegisteredUsers();

function saveRegisteredUsers(){
  fs.mkdirSync(DATA_DIR,{recursive:true});
  const tmp=REGISTERED_USERS_FILE+".tmp";
  fs.writeFileSync(tmp,JSON.stringify([...registeredUsers.values()],null,2),"utf8");
  fs.renameSync(tmp,REGISTERED_USERS_FILE);
}

function registerUserOnce({name,employeeCode,roomCode}){
  const key=String(employeeCode).trim();
  if(registeredUsers.has(key)) return false;
  registeredUsers.set(key,{
    name:String(name).trim(),
    employeeCode:key,
    registeredAt:Date.now(),
    registeredRoom:String(roomCode||"")
  });
  saveRegisteredUsers();
  return true;
}

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
const GAME_POINTS=[10,20,30,40,50];
const GAME_DIFFICULTY=[1,2,3,4,5];
const TOTAL_QUESTIONS=5;
const QUESTION_BANK_VERSION="GAMESARENA-KBC-KIDS-WARMUP-HARD-FINISH-v3";

function shuffleCopy(arr){
 const a=Array.isArray(arr)?arr.slice():[];
 for(let i=a.length-1;i>0;i--){
   const j=Math.floor(Math.random()*(i+1));
   [a[i],a[j]]=[a[j],a[i]];
 }
 return a;
}
function buildGameQuestions(bank,usedIds=new Set()){
  // KBC-style difficulty progression:
  // Q1–Q2 always start with Kids General Knowledge (easy warm-up).
  // Q3 introduces a moderate question.
  // Q4–Q5 are deliberately harder.
  // Politics is kept EASY/MODERATE only; Bollywood/Indian Cinema is excluded.
  const targets=[
    {category:"Kids General Knowledge",difficulty:1,displayDifficulty:1},
    {category:"Kids General Knowledge",difficulty:2,displayDifficulty:2},
    {category:"Politics & Indian Polity",difficulty:2,displayDifficulty:3},
    {category:"Technology",difficulty:4,displayDifficulty:4},
    {category:"South Indian Cinema",difficulty:4,displayDifficulty:5}
  ];
  const used=new Set(usedIds||[]);
  const selected=[];
  for(const target of targets){
    const exact=(bank||[]).filter(q=>q.category===target.category&&Number(q.difficulty)===target.difficulty&&!used.has(q.id));
    const sameCat=(bank||[]).filter(q=>q.category===target.category&&!used.has(q.id));
    const pool=exact.length?exact:sameCat;
    if(!pool.length)continue;
    const copy=structuredClone(shuffleCopy(pool)[0]);
    copy._displayDifficulty=target.displayDifficulty;
    selected.push(copy); used.add(copy.id);
  }
  if(selected.length<TOTAL_QUESTIONS){
    const fallback=shuffleCopy((bank||[]).filter(q=>!used.has(q.id)))
      .sort((a,b)=>Number(b.difficulty||1)-Number(a.difficulty||1));
    for(const q of fallback){
      if(selected.length>=TOTAL_QUESTIONS)break;
      const copy=structuredClone(q);
      copy._displayDifficulty=Math.min(5,selected.length+1);
      selected.push(copy); used.add(copy.id);
    }
  }
  const game=selected.slice(0,TOTAL_QUESTIONS);
  game.forEach((q,index)=>{
    const original=q.options.slice(),correct=original[q.answer];
    q.options=shuffleCopy(original); q.answer=q.options.indexOf(correct);
    q.points=GAME_POINTS[index];
    q.difficulty=Number(q._displayDifficulty||Math.min(5,index+1));
    delete q._displayDifficulty;
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

function makeRoom(){return{host:null,users:new Map(),questions:[],current:-1,phase:"lobby",pool:[],winner:null,completed:new Set(),played:new Set(),failed:new Set(),answers:new Map(),pendingAnswer:null,pendingPollRequest:null,poll:new Map(),lifelines:new Set(),fiftyFiftyRemoved:new Map(),timer:null,fastestSize:7,fastestStartAt:0,fastestDurationMs:15000,fastestSequence:[],fastestTimes:new Map(),fastestProgress:new Map(),fastestToken:"",fastestJoinUrl:"",fastestJoinQr:"",screenToken:"",screenUrl:"",screenQr:"",audiencePollUrl:"",audiencePollQr:"",pollActive:false,winnerCelebrationUntil:0,contestantId:null,eliminatedContestant:null,ladder:[10,20,30,40,50],safeHavens:[20,40],contestantQuit:null,pendingQuit:null,usedQuestionIds:new Set()}}
function active(r){return [...r.users.values()].filter(u=>u.status==="active")}
function emitState(code){
 const r=rooms.get(code);if(!r)return;
 const q=r.questions[r.current];
 const now=Date.now();
 const remaining=r.phase==="fastest"?Math.max(0,r.fastestStartAt+r.fastestDurationMs-now):0;
 io.to(code).emit("state",{
  phase:r.phase,current:r.current,totalQuestions:TOTAL_QUESTIONS,winnerCelebrationUntil:r.winnerCelebrationUntil||0,
  question:q?{id:q.id,category:q.category,difficulty:q.difficulty,text:q.text,options:q.options,points:q.points}:null,
  users:[...r.users.values()].map(u=>({id:u.id,name:u.name,employeeCode:u.employeeCode,score:u.score,status:u.status,assuredMoney:Number(u.assuredMoney||0),prizeWon:Number(u.prizeWon||0)})),
  registered:r.users.size,active:active(r).length,contestantId:r.contestantId||null,
  pool:r.pool.map(u=>({id:u.id,name:u.name,employeeCode:u.employeeCode})),
  winner:r.winner?{name:r.winner.name,employeeCode:r.winner.employeeCode,time:r.winner.time}:null,contestant:r.winner?{id:r.winner.id,name:r.winner.name,employeeCode:r.winner.employeeCode}:null,contestantAssuredMoney:r.winner?Number(r.users.get(r.winner.id)?.assuredMoney||0):0,eliminatedContestant:r.eliminatedContestant||null,contestantQuit:r.contestantQuit||null,pendingQuit:r.pendingQuit||null,safeHavens:r.safeHavens||[20,40],currentAnswer:r.answers.size?[...r.answers.values()][0]:null,pendingAnswer:r.pendingAnswer||null,pendingPollRequest:r.pendingPollRequest||null,
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
 // startFastest receives a room, not a socket. Use the room's public join URL
  // so Randomly Select 7 cannot crash with "s is not defined".
  const publicBase = r.joinUrl ? new URL(r.joinUrl).origin : (PUBLIC_URL || "");
  r.fastestJoinUrl=`${publicBase}/join.html?room=${encodeURIComponent(roomCode)}&game=${encodeURIComponent(r.fastestToken)}`;
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
const CM_CARDS=[
 {key:"apple",image:"/assets/cardmatch/apple.svg"},
 {key:"rocket",image:"/assets/cardmatch/rocket.svg"},
 {key:"panda",image:"/assets/cardmatch/panda.svg"},
 {key:"rainbow",image:"/assets/cardmatch/rainbow.svg"},
 {key:"football",image:"/assets/cardmatch/football.svg"},
 {key:"pizza",image:"/assets/cardmatch/pizza.svg"},
 {key:"fox",image:"/assets/cardmatch/fox.svg"},
 {key:"guitar",image:"/assets/cardmatch/guitar.svg"}
];
const CM_COLORS=["#ff5c7a","#5c8dff","#20c997","#ffb020"];
function cmDeck(){
 const pairs=CM_CARDS.flatMap(x=>[x,x]);
 return pairs.map((x,id)=>({id,key:x.key,image:x.image,matched:false})).sort(()=>Math.random()-0.5);
}
function cmCode(){let c;do c=String(Math.floor(1000+Math.random()*9000));while(cardMatchRooms.has(c));return c}
function cmNextIndex(r){return r.players.length?((r.turn+1)%r.players.length):0}
function cmState(r){
 const next=r.status==="playing"&&r.players.length>1?cmNextIndex(r):null;
 return {
  code:r.code,status:r.status,turn:r.turn,nextTurn:next,flipped:r.flipped,
  deck:Array.isArray(r.deck)?r.deck:[],
  players:r.players.map(p=>({id:p.id,name:p.name,color:p.color,score:p.score})),
  winner:r.winner||[]
 };
}
function cmBroadcast(r){io.to(r.channel).emit("cm:state",cmState(r))}
function cmReset(r,keepScores=false){
 r.deck=cmDeck();r.flipped=[];r.turn=0;r.status="playing";r.winner=[];
 if(!keepScores)r.players.forEach(p=>p.score=0);
}
io.on("connection",s=>{
 s.on("cm:create",()=>{
   const code=cmCode(),channel="cardmatch-"+code;
   const tvToken=crypto.randomBytes(24).toString("hex");
   const r={code,channel,tv:s.id,tvToken,players:[],deck:[],flipped:[],turn:0,status:"lobby",winner:[],joinUrl:""};
   cardMatchRooms.set(code,r);s.join(channel);s.data.cmRoom=code;s.data.cmRole="tv";s.data.cmTvToken=tvToken;
   const proto=String(s.handshake.headers["x-forwarded-proto"]||"http").split(",")[0].trim().replace(/:$/,""),host=String(s.handshake.headers.host||"").trim();
   r.joinUrl=`${proto}://${host}/card-match.html?join=${code}`;
   s.emit("cm:room",{code,tvToken,joinUrl:r.joinUrl});cmBroadcast(r);
 });
 s.on("cm:join",({code,name}={})=>{
   const r=cardMatchRooms.get(String(code||""));if(!r)return s.emit("cm:error",{message:"Room not found."});
   if(r.status!=="lobby")return s.emit("cm:error",{message:"Game already started."});
   if(r.players.length>=4)return s.emit("cm:error",{message:"Room is full."});
   const playerToken=crypto.randomBytes(24).toString("hex");
   const p={id:s.id,token:playerToken,name:String(name||"Player").trim().slice(0,18),score:0,color:CM_COLORS[r.players.length%CM_COLORS.length]};
   r.players.push(p);s.join(r.channel);s.data.cmRoom=r.code;s.data.cmRole="player";s.data.cmPlayerToken=playerToken;
   s.emit("cm:joined",{playerId:p.id,playerToken,code:r.code});cmBroadcast(r);
 });
 s.on("cm:resume",({code,playerToken,name}={})=>{
   const r=cardMatchRooms.get(String(code||""));if(!r)return s.emit("cm:error",{message:"Room not found. Create a new room if this room expired."});
   const p=r.players.find(x=>x.token===String(playerToken||""));
   if(!p)return s.emit("cm:error",{message:"Player session expired. Please join the room again."});
   p.id=s.id;
   if(name && String(name).trim())p.name=String(name).trim().slice(0,18);
   s.join(r.channel);s.data.cmRoom=r.code;s.data.cmRole="player";s.data.cmPlayerToken=p.token;
   s.emit("cm:joined",{playerId:p.id,playerToken:p.token,code:r.code,resumed:true});
   s.emit("cm:state",cmState(r));
   cmBroadcast(r);
 });
 s.on("cm:tv-resume",({code,tvToken}={})=>{
   const r=cardMatchRooms.get(String(code||""));
   if(!r || r.tvToken!==String(tvToken||""))return s.emit("cm:error",{message:"TV session expired. Create a new TV game."});
   r.tv=s.id;s.join(r.channel);s.data.cmRoom=r.code;s.data.cmRole="tv";s.data.cmTvToken=r.tvToken;
   s.emit("cm:room",{code:r.code,tvToken:r.tvToken,joinUrl:r.joinUrl||""});
   s.emit("cm:state",cmState(r));
   cmBroadcast(r);
 });
 s.on("cm:start",({code}={})=>{
   const roomCode=String(code||s.data.cmRoom||"").trim(),r=cardMatchRooms.get(roomCode);
   if(!r)return s.emit("cm:error",{message:"The game room is no longer available. Create a new game."});
   if(s.id!==r.tv)return s.emit("cm:error",{message:"Only the TV that created this room can start the match."});
   if(r.players.length<2)return s.emit("cm:error",{message:"At least 2 players must join before starting."});
   cmReset(r);cmBroadcast(r);
 });
 s.on("cm:restart",({code}={})=>{
   const roomCode=String(code||s.data.cmRoom||"").trim(),r=cardMatchRooms.get(roomCode);
   if(!r)return s.emit("cm:error",{message:"The game room is no longer available."});
   if(s.id!==r.tv)return s.emit("cm:error",{message:"Only the TV can restart the match."});
   if(r.players.length<2)return s.emit("cm:error",{message:"At least 2 players must join before restarting."});
   cmReset(r,false);cmBroadcast(r);
 });
 s.on("cm:refresh",({code}={})=>{
   const roomCode=String(code||s.data.cmRoom||"").trim(),r=cardMatchRooms.get(roomCode);
   if(!r)return s.emit("cm:error",{message:"The game room is no longer available."});
   if(s.id!==r.tv)return s.emit("cm:error",{message:"Only the TV can sync the game."});
   if(r.status!=="playing")return cmBroadcast(r);
   // Sync only: never create a new deck and never close matched cards.
   cmBroadcast(r);
 });
 s.on("cm:flip",({cardId}={})=>{
   const r=cardMatchRooms.get(String(s.data.cmRoom||""));if(!r||r.status!=="playing")return;
   const idx=r.players.findIndex(p=>p.id===s.id);if(idx!==r.turn||r.flipped.length>=2)return;
   const c=r.deck.find(x=>x.id===Number(cardId));if(!c||c.matched||r.flipped.includes(c.id))return;
   r.flipped.push(c.id);cmBroadcast(r);
   if(r.flipped.length===2){
    const a=r.deck.find(x=>x.id===r.flipped[0]),b=r.deck.find(x=>x.id===r.flipped[1]);
    setTimeout(()=>{
      if(!cardMatchRooms.has(r.code))return;
      if(a.key===b.key){const owner=r.players[r.turn];a.matched=b.matched=true;a.matchedBy=owner.id;b.matchedBy=owner.id;a.matchedByColor=owner.color;b.matchedByColor=owner.color;owner.score++}
      else r.turn=(r.turn+1)%r.players.length;
      r.flipped=[];
      if(r.deck.every(x=>x.matched)){r.status="finished";const max=Math.max(...r.players.map(p=>p.score));r.winner=r.players.filter(p=>p.score===max).map(p=>p.name)}
      cmBroadcast(r);
    },800);
   }
 });
 s.on("disconnect",()=>{
   const code=s.data.cmRoom;
   const r=code?cardMatchRooms.get(code):null;
   if(!r)return;
   // Do not delete players on transient disconnects. Their player token
   // lets the browser resume the same seat after Socket.IO reconnects.
   if(r.tv===s.id) r.tv=null;
 });
 s.on("host:resume",({token}={})=>{
 const wanted=String(token||"").trim();
 if(!wanted)return;
 for(const [code,r] of rooms){
   if(r.hostToken!==wanted)continue;
   if(r.hostDisconnectTimer){clearTimeout(r.hostDisconnectTimer);r.hostDisconnectTimer=null}
   r.host=s.id;s.join(code);s.data.room=code;s.data.role="host";
   s.emit("room",{code,hostToken:r.hostToken,joinUrl:r.joinUrl,qr:r.joinQr,screenUrl:r.screenUrl,screenQr:r.screenQr,audiencePollUrl:r.audiencePollUrl,audiencePollQr:r.audiencePollQr});
   emitState(code);
   return;
 }
});
s.on("host:create",async(_payload={},ack)=>{
  try{
    // Always create a fresh room; never reuse the previous host session.
    let code;do code=String(Math.floor(1000+Math.random()*9000));while(rooms.has(code));
    const r=makeRoom();
    r.host=s.id;
    r.hostToken=crypto.randomBytes(24).toString("hex");
    r.hostDisconnectTimer=null;
    r.questions=[];
    rooms.set(code,r);
    s.join(code);
    s.data.room=code;
    s.data.role="host";

    // Prefer PUBLIC_URL on production so QR codes never contain localhost.
    const base=String(PUBLIC_URL||"").trim()||getPublicUrlForSocket(s);
    const joinUrl=`${base}/join.html?room=${code}`;
    r.joinUrl=joinUrl;
    r.joinQr=await QRCode.toDataURL(joinUrl,{margin:1,width:320});
    r.screenToken=crypto.randomBytes(14).toString("base64url");
    r.screenUrl=`${base}/screen/${r.screenToken}`;
    r.screenQr=await QRCode.toDataURL(r.screenUrl,{margin:1,width:280});
    r.audiencePollUrl=`${base}/audience.html?room=${code}`;
    r.audiencePollQr=await QRCode.toDataURL(r.audiencePollUrl,{margin:1,width:320});

    const payload={
      code,hostToken:r.hostToken,joinUrl,qr:r.joinQr,
      screenUrl:r.screenUrl,screenQr:r.screenQr,
      audiencePollUrl:r.audiencePollUrl,audiencePollQr:r.audiencePollQr
    };
    s.emit("room",payload);
    if(typeof ack==="function")ack({ok:true,...payload});
    emitState(code);
  }catch(err){
    console.error("host:create failed:",err);
    if(typeof ack==="function")ack({ok:false,error:"Unable to create the game room. Please try again."});
    s.emit("errorMsg","Unable to create the game room. Please try again.");
  }
});
 
s.on("player:resume",({code,name,employeeCode,game}={})=>{
 code=String(code||"").trim(); name=String(name||"").trim(); employeeCode=String(employeeCode||"").trim();
 const r=rooms.get(code);
 if(!r||!employeeCode)return s.emit("errorMsg","Game session expired. Please join again.");
 const existing=[...r.users.entries()].find(([,u])=>u.employeeCode===employeeCode);
 if(!existing)return s.emit("errorMsg","Player session not found. Please join again.");
 const u=existing[1];
 if(name && u.name!==name)return s.emit("errorMsg","Player details do not match.");
 r.users.delete(existing[0]);
 u.id=s.id;
 r.users.set(s.id,u);
 s.join(code);s.data.room=code;s.data.role="player";
 s.emit("joined",{name:u.name,employeeCode:u.employeeCode,resumed:true});
 emitState(code);
});
s.on("join",({code,name,employeeCode,role="player",game})=>{code=String(code||"").trim();const r=rooms.get(code);if(!/^\d{4}$/.test(code))return s.emit("errorMsg","Room code must be exactly 4 digits.");if(!r)return s.emit("errorMsg","Room not found. Ask the host for a new code.");
 if(game){const ec=String(employeeCode||"").trim();if(game!==r.fastestToken)return s.emit("errorMsg","This Fastest Finger QR is no longer active.");if(!/^\d+$/.test(ec))return s.emit("errorMsg","Register number must contain numbers only.");if(!r.pool.some(p=>p.employeeCode===ec))return s.emit("errorMsg","You are not selected for this Fastest Finger round.");}
 s.join(code);s.data.room=code;s.data.role=role;if(role==="audience"||role==="tv"||role==="roster"){s.emit("joined",{name:role==="tv"?"TV Screen":role==="roster"?"Roster Viewer":"Audience"});emitState(code);return}name=String(name||"").trim();employeeCode=String(employeeCode||"").trim();if(!/^[A-Za-z]+(?:[ ][A-Za-z]+)*$/.test(name))return s.emit("errorMsg","Name must contain alphabets only.");if(!/^\d+$/.test(employeeCode))return s.emit("errorMsg","Register number must contain numbers only.");if([...r.users.values()].some(u=>u.employeeCode===employeeCode))return s.emit("errorMsg","This register number is already registered in this game.");
 if(registeredUsers.has(employeeCode))return s.emit("errorMsg","This register number is already registered. You cannot register again.");
 if(!registerUserOnce({name,employeeCode,roomCode:code}))return s.emit("errorMsg","This register number is already registered. You cannot register again.");
 r.users.set(s.id,{id:s.id,name,employeeCode,score:0,assuredMoney:0,prizeWon:0,status:"active",inPool:false,lifelinesUsed:{"5050":false,"audience":false,"phone":false},registeredAt:Date.now()});
 s.emit("joined",{name,employeeCode});emitState(code)});
 s.on("host:registeredUsers",()=>{
 const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;
 s.emit("registeredUsers",[...registeredUsers.values()].sort((a,b)=>a.registeredAt-b.registeredAt));
});
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
 r.questions=buildGameQuestions(bank,r.usedQuestionIds);
 r.questions.forEach(q=>r.usedQuestionIds.add(q.id));
 r.phase="question";r.current=0;r.answers.clear();r.pendingAnswer=null;r.pendingQuit=null;r.pendingPollRequest=null;r.poll.clear();r.lifelines.clear();r.fiftyFiftyRemoved.clear();r.eliminatedContestant=null;r.contestantQuit=null;if(r.winner){
   r.winner.lifelinesUsed={"5050":false,"audience":false,"phone":false};
   const contestantUser=r.users.get(r.winner.id);
   if(contestantUser){contestantUser.lifelinesUsed={"5050":false,"audience":false,"phone":false};contestantUser.assuredMoney=0;contestantUser.prizeWon=0;}
 }
 emitState(s.data.room);
});
 s.on("host:nextFastest",async()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;await pick7(r);emitState(s.data.room)});
 s.on("host:restartFastest",async()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;if(!r.pool.length)return;await restartFastest(r);emitState(s.data.room)});
 s.on("host:nextQuestion",()=>{
 const r=rooms.get(s.data.room);if(!r||r.host!==s.id||r.phase!=="question")return;
 if(r.pendingQuit){s.emit("errorMsg","Approve or reject the pending Safe Quit request before moving to the next question.");return;}
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
 s.on("host:restartEvent",()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;for(const u of r.users.values()){u.score=0;u.assuredMoney=0;u.prizeWon=0;u.status="active";u.inPool=false;u.lifelinesUsed={"5050":false,"audience":false,"phone":false}}r.contestantId=null;r.failed.clear();r.completed.clear();r.played.clear();r.pool=[];r.usedQuestionIds.clear();r.winner=null;r.current=-1;r.fiftyFiftyRemoved.clear();r.eliminatedContestant=null;r.contestantQuit=null;r.pendingQuit=null;r.phase="registration";emitState(s.data.room)});
 s.on("player:answer",({choice})=>{
  const r=rooms.get(s.data.room);if(!r||r.phase!=="question")return;
  const u=r.users.get(s.id);
  if(!u||u.status!=="active"||!r.winner||r.winner.id!==s.id)return;
  if(r.pendingAnswer||r.pendingQuit)return;
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
    if(r.current===1)u.assuredMoney=20;
    if(r.current===3)u.assuredMoney=40;
    u.prizeWon=Number(u.assuredMoney||0);
    io.to(s.data.room).emit("answerResult",{correct:true,points:q.points,approved:true,assuredMoney:u.assuredMoney||0});
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
    u.prizeWon=0;
    u.status="eliminated";
    r.eliminatedContestant={
      id:u.id,
      name:u.name,
      employeeCode:u.employeeCode,
      score:u.score,
      pointsEarned:0,
      prizeWon:0,
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
      pointsEarned:0,
      prizeWon:0
    });
    // Targeted event keeps the eliminated contestant on the 30-second
    // farewell screen even while the room moves on to the next Fastest Finger.
    io.to(u.id).emit("eliminationNotice",{
      name:u.name,
      employeeCode:u.employeeCode,
      score:u.score,
      pointsEarned:0,
      prizeWon:0,
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

 s.on("player:quit",()=>{
  const r=rooms.get(s.data.room); if(!r||r.phase!=="question")return;
  const u=r.users.get(s.id);
  if(!u||u.status!=="active"||!r.winner||r.winner.id!==s.id)return;
  if(r.pendingAnswer){s.emit("errorMsg","Your answer is already locked. The Host must reveal it first.");return;}
  if(r.pendingQuit){s.emit("errorMsg","Your Safe Quit request is already waiting for Host approval.");return;}
  const amount=Number(u.assuredMoney||0);
  if(amount!==20&&amount!==40){
    s.emit("errorMsg","Safe Quit is available only after securing ₹20 or ₹40.");
    return;
  }
  r.pendingQuit={playerId:u.id,id:u.id,name:u.name,employeeCode:u.employeeCode,amount,requestedAt:Date.now()};
  io.to(s.data.room).emit("quitRequested",{contestant:{id:u.id,name:u.name,employeeCode:u.employeeCode},amount});
  io.to(u.id).emit("quitPending",{amount});
  emitState(s.data.room);
 });

 s.on("host:approveQuit",()=>{
  const r=rooms.get(s.data.room);if(!r||r.host!==s.id||r.phase!=="question"||!r.pendingQuit)return;
  const pending=r.pendingQuit,u=r.users.get(pending.playerId);
  if(!u){r.pendingQuit=null;emitState(s.data.room);return;}
  const amount=Number(u.assuredMoney||0);
  if(amount!==20&&amount!==40){
    r.pendingQuit=null;
    io.to(u.id).emit("quitRejected",{reason:"The Safe Quit amount is no longer available."});
    emitState(s.data.room);return;
  }
  u.prizeWon=amount;u.status="quit";
  r.contestantQuit={id:u.id,name:u.name,employeeCode:u.employeeCode,amount,at:Date.now()};
  r.pendingQuit=null;
  io.to(s.data.room).emit("contestantQuit",{contestant:{name:u.name,employeeCode:u.employeeCode},amount});
  io.to(u.id).emit("quitAccepted",{amount});
  r.pendingAnswer=null;r.pendingPollRequest=null;r.poll.clear();
  nextContestant(s.data.room);
  setTimeout(()=>{const x=rooms.get(s.data.room);if(x&&x.contestantQuit&&x.contestantQuit.employeeCode===u.employeeCode){x.contestantQuit=null;emitState(s.data.room);}},5000);
 });

 s.on("host:rejectQuit",()=>{
  const r=rooms.get(s.data.room);if(!r||r.host!==s.id||!r.pendingQuit)return;
  const pending=r.pendingQuit;r.pendingQuit=null;
  io.to(pending.playerId).emit("quitRejected",{reason:"Host rejected the Safe Quit request. You can continue the game."});
  io.to(s.data.room).emit("quitRejected",{contestant:{name:pending.name,employeeCode:pending.employeeCode}});
  emitState(s.data.room);
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
 s.on("disconnect",()=>{
 const roomCode=s.data.room,r=rooms.get(roomCode);
 if(!r)return;
 if(r.host===s.id){
   // Keep the room alive during transient proxy/Wi-Fi/socket reconnects.
   // The host can resume using the token stored in the browser.
   r.host=null;
   if(r.hostDisconnectTimer)clearTimeout(r.hostDisconnectTimer);
   r.hostDisconnectTimer=setTimeout(()=>{
     const x=rooms.get(roomCode);
     if(x && !x.host){
       clearTimeout(x.timer);
       io.to(roomCode).emit("errorMsg","Host disconnected. Room closed.");
       rooms.delete(roomCode);
     }
   },90000);
   io.to(roomCode).emit("hostConnection","Host reconnecting…");
 }
});
});
initDb().then(()=>server.listen(PORT,"0.0.0.0",()=>console.log(`Perficient Office Quiz Arena v4 listening on 0.0.0.0:${PORT}`))).catch(e=>{console.error("Startup error:",e);process.exit(1)});
