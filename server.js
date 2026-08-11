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
const QUESTION_TIME_MS=30000;
const AUDIENCE_POLL_TIME_MS=60000;
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

function makeRoom(){return{host:null,users:new Map(),questions:[],current:-1,phase:"lobby",pool:[],winner:null,completed:new Set(),played:new Set(),failed:new Set(),answers:new Map(),pendingAnswer:null,pendingPollRequest:null,poll:new Map(),lifelines:new Set(),fiftyFiftyRemoved:new Map(),timer:null,fastestSize:7,fastestStartAt:0,fastestDurationMs:15000,fastestSequence:[],fastestTimes:new Map(),fastestProgress:new Map(),fastestToken:"",fastestJoinUrl:"",fastestJoinQr:"",screenToken:"",screenUrl:"",screenQr:"",audiencePollUrl:"",audiencePollQr:"",pollActive:false,pollVotingOpen:false,winnerCelebrationUntil:0,contestantId:null,eliminatedContestant:null,ladder:[10,20,30,40,50],safeHavens:[20,40],contestantQuit:null,pendingQuit:null,usedQuestionIds:new Set(),questionTimerTimeout:null,questionTimerStartAt:0,questionTimerRemainingMs:QUESTION_TIME_MS,questionTimerPaused:false,pollTimerTimeout:null,pollTimerStartAt:0,pollTimerRemainingMs:AUDIENCE_POLL_TIME_MS,pollTimerRunning:false}}
function active(r){return [...r.users.values()].filter(u=>u.status==="active")}
function clearQuestionTimer(r){clearTimeout(r.questionTimerTimeout);r.questionTimerTimeout=null;}
function questionRemaining(r){if(r.phase!=="question")return 0;if(r.questionTimerPaused)return Math.max(0,Number(r.questionTimerRemainingMs||0));if(r.questionTimerStartAt)return Math.max(0,Number(r.questionTimerRemainingMs||QUESTION_TIME_MS)-(Date.now()-r.questionTimerStartAt));return Math.max(0,Number(r.questionTimerRemainingMs||QUESTION_TIME_MS));}
function pauseQuestionTimer(r){if(r.phase!=="question"||r.questionTimerPaused)return false;r.questionTimerRemainingMs=questionRemaining(r);r.questionTimerStartAt=0;r.questionTimerPaused=true;clearQuestionTimer(r);return true;}
function startQuestionTimer(r,remaining=QUESTION_TIME_MS){clearQuestionTimer(r);r.questionTimerRemainingMs=Math.max(0,Number(remaining||0));r.questionTimerPaused=false;r.questionTimerStartAt=Date.now();if(r.questionTimerRemainingMs<=0){questionTimeExpired(r);return;}r.questionTimerTimeout=setTimeout(()=>questionTimeExpired(r),r.questionTimerRemainingMs);}
function questionTimeExpired(r){if(r.phase!=="question"||r.current<0)return;r.questionTimerRemainingMs=0;r.questionTimerStartAt=0;r.questionTimerPaused=false;r.questionTimerTimeout=null;if(r.pendingAnswer){const code=[...rooms.entries()].find(([,room])=>room===r)?.[0];if(code)emitState(code);return;}const u=r.winner&&r.users.get(r.winner.id);if(!u)return;u.prizeWon=0;u.status="eliminated";r.eliminatedContestant={id:u.id,name:u.name,employeeCode:u.employeeCode,score:u.score,pointsEarned:0,prizeWon:0,eliminatedAt:Date.now(),reason:"TIME_UP",until:Date.now()+30000};const code=[...rooms.entries()].find(([,room])=>room===r)?.[0];if(code){io.to(code).emit("answerResult",{correct:false,eliminated:true,timeout:true,approved:true,contestant:{name:u.name,employeeCode:u.employeeCode},pointsEarned:0,prizeWon:0});io.to(u.id).emit("eliminationNotice",{name:u.name,employeeCode:u.employeeCode,score:u.score,pointsEarned:0,prizeWon:0,until:Date.now()+30000,reason:"TIME_UP"});nextContestant(code);}}
function clearAudiencePollTimer(r){clearTimeout(r.pollTimerTimeout);r.pollTimerTimeout=null;r.pollTimerStartAt=0;r.pollTimerRunning=false;r.pollTimerRemainingMs=AUDIENCE_POLL_TIME_MS;}
function pollRemaining(r){if(!r.pollTimerRunning)return Math.max(0,Number(r.pollTimerRemainingMs||0));return Math.max(0,Number(r.pollTimerRemainingMs||0)-(Date.now()-r.pollTimerStartAt));}
function audienceConnectedCount(code){
 const ids=io.sockets.adapter.rooms.get(code)||new Set();let count=0;
 ids.forEach(id=>{const sock=io.sockets.sockets.get(id);if(sock?.data?.room===code&&sock.data.role==="audience")count++;});
 return count;
}
function startAudiencePollTimer(r){
 clearAudiencePollTimer(r);r.pollActive=true;r.pollVotingOpen=true;r.pollTimerRemainingMs=AUDIENCE_POLL_TIME_MS;
 r.pollTimerStartAt=Date.now();r.pollTimerRunning=true;
 r.pollTimerTimeout=setTimeout(()=>stopAudiencePoll(r,true),AUDIENCE_POLL_TIME_MS);
}
function stopAudiencePoll(r,expired=false){
 if(!r.pollActive&&!r.pollTimerRunning)return;
 r.pollTimerRemainingMs=pollRemaining(r);clearAudiencePollTimer(r);r.pollActive=false;r.pollVotingOpen=false;
 const code=[...rooms.entries()].find(([,room])=>room===r)?.[0];
 if(code)io.to(code).emit(expired?"audiencePollTimeUp":"audiencePollStopped");
 if(r.phase==="question"&&!r.pendingAnswer)startQuestionTimer(r,questionRemaining(r)||QUESTION_TIME_MS);
 if(code)emitState(code);
}
function resetQuestionClock(r){clearQuestionTimer(r);r.questionTimerStartAt=0;r.questionTimerRemainingMs=QUESTION_TIME_MS;r.questionTimerPaused=false;clearAudiencePollTimer(r);}
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
  pollVotingOpen:!!r.pollVotingOpen,
  audienceConnected:audienceConnectedCount(code),
  // Expose poll results as answer-choice counts (0..3), never as
  // audience socket-id -> choice pairs. This keeps every client in sync
  // after the state broadcast that follows a vote.
  pollCounts:pollCounts(r.poll),
  questionTimerRemaining:questionRemaining(r),
  questionTimerRunning:r.phase==="question"&&!r.questionTimerPaused&&!!r.questionTimerStartAt,
  questionTimerStartAt:r.questionTimerStartAt||0,
  questionTimerPaused:!!r.questionTimerPaused,
  questionTimerTotalMs:QUESTION_TIME_MS,
  pollTimerRemaining:pollRemaining(r),
  pollTimerRunning:!!r.pollTimerRunning,
  pollTimerStartAt:r.pollTimerStartAt||0,
  pollTimerTotalMs:AUDIENCE_POLL_TIME_MS,
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



// ===== Color War mini-game =====
const colorWarRooms=new Map();
const CW_COLORS=["#ff5c7a","#20b7df","#7b61ff","#f2b84b"];
const CW_SIZE=5;
function cwCode(){let c;do c=String(Math.floor(1000+Math.random()*9000));while(colorWarRooms.has(c));return c}
function cwCapacity(i){
  const row=Math.floor(i/CW_SIZE),col=i%CW_SIZE;
  if((row===0||row===CW_SIZE-1)&&(col===0||col===CW_SIZE-1))return 2;
  if(row===0||row===CW_SIZE-1||col===0||col===CW_SIZE-1)return 3;
  return 4;
}
function cwNeighbors(i){
  const row=Math.floor(i/CW_SIZE),col=i%CW_SIZE,out=[];
  if(row>0)out.push(i-CW_SIZE);if(row<CW_SIZE-1)out.push(i+CW_SIZE);
  if(col>0)out.push(i-1);if(col<CW_SIZE-1)out.push(i+1);
  return out;
}
function cwBoard(){return Array.from({length:CW_SIZE*CW_SIZE},()=>({owner:null,count:0}))}
function cwState(r){
  return {
    code:r.code,status:r.status,hostOnline:!!r.host,hostId:r.host,
    tvToken:r.tvToken,
    joinUrl:r.joinUrl,tvUrl:r.tvUrl,joinQr:r.joinQr,tvQr:r.tvQr,
    current:r.current,
    board:r.board,
    winner:r.winner||null,
    players:r.players.map(p=>({id:p.id,name:p.name,color:p.color,hadCell:p.hadCell,eliminated:p.eliminated}))
  };
}
function cwBroadcast(r){io.to(r.channel).emit("cw:state",cwState(r))}
function cwReset(r){
  r.board=cwBoard();r.status="playing";r.current=0;r.winner=null;
  r.players.forEach(p=>{p.hadCell=false;p.eliminated=false});
}
function cwAdvance(r){
  for(let n=0;n<r.players.length;n++){
    r.current=(r.current+1)%r.players.length;
    const p=r.players[r.current];
    if(p&&!p.eliminated)return;
  }
}
function cwApplyMove(r,pid,index){
  if(r.status!=="playing")return {ok:false,error:"The battle is not running."};
  const pidx=r.players.findIndex(p=>p.id===pid);
  if(pidx<0||pidx!==r.current)return {ok:false,error:"It is not your turn."};
  if(!Number.isInteger(index)||index<0||index>=r.board.length)return {ok:false,error:"Invalid cell."};
  const cell=r.board[index];
  if(cell.owner!==null&&cell.owner!==pid)return {ok:false,error:"You can only play an empty cell or your own color."};
  cell.owner=pid;cell.count++;r.players[pidx].hadCell=true;

  const queue=[index],guard=new Set();
  while(queue.length){
    const i=queue.shift(),c=r.board[i],cap=cwCapacity(i);
    if(c.count<cap)continue;
    c.count-=cap;
    if(c.count===0)c.owner=null;
    for(const n of cwNeighbors(i)){
      const t=r.board[n];t.owner=pid;t.count++;
      r.players[pidx].hadCell=true;
      if(t.count>=cwCapacity(n)&&!guard.has(n)){guard.add(n);queue.push(n)}
    }
  }

  // Players who have already entered the battle are eliminated once they
  // have no territory left. Players who have not moved yet remain eligible.
  r.players.forEach(x=>{
    if(x.hadCell)x.eliminated=!r.board.some(c=>c.owner===x.id);
  });

  const moved=r.players.filter(x=>x.hadCell);
  const active=moved.filter(x=>!x.eliminated);
  if(r.players.length>=2 && moved.length===r.players.length && active.length<=1){
    r.winner=active[0]?.id||null;r.status="finished";return {ok:true};
  }
  cwAdvance(r);
  return {ok:true};
}
io.on("connection",s=>{
  s.on("cw:create",async()=>{
    const code=cwCode(),channel="colorwar-"+code,tvToken=crypto.randomBytes(24).toString("hex");
    const base=getPublicUrlForSocket(s);
    const joinUrl=`${base}/color-war.html?join=${code}`;
    const tvUrl=`${base}/color-war-tv.html?room=${code}&token=${tvToken}`;
    const joinQr=await QRCode.toDataURL(joinUrl,{margin:1,width:320});
    const tvQr=await QRCode.toDataURL(tvUrl,{margin:1,width:320});
    const r={code,channel,tv:s.id,tvToken,host:s.id,players:[],board:cwBoard(),current:0,status:"lobby",winner:null,joinUrl,tvUrl,joinQr,tvQr};
    colorWarRooms.set(code,r);s.join(channel);s.data.cwRoom=code;s.data.cwRole="host";
    s.emit("cw:room",{code,tvToken,joinUrl,tvUrl,joinQr,tvQr});cwBroadcast(r);
  });
  s.on("cw:join",({code,name}={})=>{
    const r=colorWarRooms.get(String(code||"").trim());
    if(!r)return s.emit("cw:error",{message:"Room not found."});
    if(r.status!=="lobby")return s.emit("cw:error",{message:"The battle has already started."});
    if(r.players.length>=4)return s.emit("cw:error",{message:"Room is full — maximum 4 players."});
    const p={id:s.id,token:crypto.randomBytes(24).toString("hex"),name:String(name||"Player").trim().slice(0,18),color:CW_COLORS[r.players.length],hadCell:false,eliminated:false};
    r.players.push(p);s.join(r.channel);s.data.cwRoom=r.code;s.data.cwRole="player";
    s.emit("cw:joined",{playerId:p.id,playerToken:p.token,code:r.code});cwBroadcast(r);
  });
  s.on("cw:resume",({code,token,name}={})=>{
    const r=colorWarRooms.get(String(code||"").trim());
    if(!r)return s.emit("cw:error",{message:"Room not found. Create a new room if the room expired."});
    const p=r.players.find(x=>x.token===String(token||""));
    if(!p)return s.emit("cw:error",{message:"Player session expired. Please join the room again."});
    p.id=s.id;if(name&&String(name).trim())p.name=String(name).trim().slice(0,18);
    s.join(r.channel);s.data.cwRoom=r.code;s.data.cwRole="player";
    s.emit("cw:joined",{playerId:p.id,playerToken:p.token,code:r.code,resumed:true});cwBroadcast(r);
  });
  s.on("cw:start",({code}={})=>{
    const r=colorWarRooms.get(String(code||s.data.cwRoom||"").trim());
    if(!r)return s.emit("cw:error",{message:"Room no longer exists."});
    if(r.host!==s.id)return s.emit("cw:error",{message:"Only the host can start the battle."});
    if(r.players.length<2)return s.emit("cw:error",{message:"At least 2 players must join."});
    cwReset(r);cwBroadcast(r);
  });
  s.on("cw:restart",({code}={})=>{
    const r=colorWarRooms.get(String(code||s.data.cwRoom||"").trim());
    if(!r)return s.emit("cw:error",{message:"Room no longer exists."});
    if(r.host!==s.id)return s.emit("cw:error",{message:"Only the host can restart the battle."});
    if(r.players.length<2)return s.emit("cw:error",{message:"At least 2 players must join."});
    cwReset(r);cwBroadcast(r);
  });
  s.on("cw:move",({index}={})=>{
    const r=colorWarRooms.get(String(s.data.cwRoom||""));if(!r||s.data.cwRole!=="player")return;
    const result=cwApplyMove(r,s.id,Number(index));
    if(!result.ok)s.emit("cw:error",{message:result.error});
    cwBroadcast(r);
  });
  s.on("cw:tv",({code,token}={})=>{
    const r=colorWarRooms.get(String(code||"").trim());
    if(!r||r.tvToken!==String(token||""))return s.emit("cw:error",{message:"TV link expired. Create a new Color War room."});
    s.join(r.channel);s.data.cwRoom=r.code;s.data.cwRole="tv";s.emit("cw:state",cwState(r));
  });
  s.on("cw:host-resume",({code}={})=>{
    const r=colorWarRooms.get(String(code||"").trim());
    if(!r)return s.emit("cw:error",{message:"Room not found."});
    r.host=s.id;s.data.cwRoom=r.code;s.data.cwRole="host";s.join(r.channel);s.emit("cw:state",cwState(r));
  });
  s.on("disconnect",()=>{
    const code=s.data.cwRoom,r=code?colorWarRooms.get(code):null;
    if(!r)return;
    if(r.host===s.id)r.host=null;
  });
});
setInterval(()=>{
  const cutoff=Date.now()-6*60*60*1000;
  for(const [code,r] of colorWarRooms){
    if(r.lastActivity&&r.lastActivity<cutoff)colorWarRooms.delete(code);
  }
},60*60*1000);

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
 const now=Date.now();
 const players=r.players.map(p=>{
  const live=(r.status==="playing" && r.players[r.turn]?.id===p.id && r.turnStartedAt)?Math.max(0,now-r.turnStartedAt):0;
  return {id:p.id,name:p.name,color:p.color,score:p.score,timeMs:(p.timeMs||0)+live};
 });
 return {
  code:r.code,status:r.status,turn:r.turn,nextTurn:next,flipped:r.flipped,
  turnStartedAt:r.turnStartedAt||null,
  deck:Array.isArray(r.deck)?r.deck:[],
  players,
  winner:r.winner||[],
  winnerReason:r.winnerReason||""
 };
}
function cmBroadcast(r){io.to(r.channel).emit("cm:state",cmState(r))}
function cmReset(r,keepScores=false){
 r.deck=cmDeck();r.flipped=[];r.turn=0;r.status="playing";r.winner=[];r.winnerReason="";
 r.turnStartedAt=Date.now();
 r.players.forEach(p=>{p.timeMs=keepScores?(p.timeMs||0):0;if(!keepScores)p.score=0;});
}
io.on("connection",s=>{
 s.on("cm:create",()=>{
   const code=cmCode(),channel="cardmatch-"+code;
   const tvToken=crypto.randomBytes(24).toString("hex");
   const r={code,channel,tv:s.id,tvToken,players:[],deck:[],flipped:[],turn:0,status:"lobby",winner:[],winnerReason:"",turnStartedAt:null,joinUrl:""};
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
   const p={id:s.id,token:playerToken,name:String(name||"Player").trim().slice(0,18),score:0,timeMs:0,color:CM_COLORS[r.players.length%CM_COLORS.length]};
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
      const owner=r.players[r.turn];
      if(owner && r.turnStartedAt) owner.timeMs=(owner.timeMs||0)+Math.max(0,Date.now()-r.turnStartedAt);
      if(a.key===b.key){
        a.matched=b.matched=true;a.matchedBy=owner.id;b.matchedBy=owner.id;a.matchedByColor=owner.color;b.matchedByColor=owner.color;owner.score++;
      } else {
        r.turn=(r.turn+1)%r.players.length;
      }
      r.flipped=[];
      r.turnStartedAt=Date.now();
      if(r.deck.every(x=>x.matched)){
        r.status="finished";
        r.turnStartedAt=null;
        const max=Math.max(...r.players.map(p=>p.score));
        const tied=r.players.filter(p=>p.score===max);
        if(tied.length===1){
          r.winner=[tied[0].name];
          r.winnerReason="Most pairs";
        }else{
          const minTime=Math.min(...tied.map(p=>p.timeMs||0));
          const fastest=tied.filter(p=>(p.timeMs||0)===minTime);
          r.winner=fastest.map(p=>p.name);
          r.winnerReason=fastest.length===1?"Tie on pairs — fastest total turn time":"Exact tie on pairs and time";
        }
      }
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
s.on("host:openRegistration",()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;r.pollActive=false;r.pollVotingOpen=false;r.poll.clear();r.phase="registration";emitState(s.data.room)});
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
  const req=r.pendingPollRequest;r.pendingPollRequest=null;r.poll.clear();
  r.pollActive=true;r.pollVotingOpen=false;clearAudiencePollTimer(r);pauseQuestionTimer(r);
  io.to(req.id).emit("audiencePollApproved",{contestant:req,counts:pollCounts(r.poll),waitingForHost:true});
  io.to(s.data.room).emit("audiencePollStarted",{contestant:{name:req.name,employeeCode:req.employeeCode},waitingForAudience:true});
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
 if(r.pollActive&&r.pollVotingOpen){stopAudiencePoll(r,false);return;}
 if(!r.pollActive){r.poll.clear();pauseQuestionTimer(r);r.pollActive=true;r.pollVotingOpen=false;clearAudiencePollTimer(r);}
 const connected=audienceConnectedCount(s.data.room);
 if(connected<1){
   emitState(s.data.room);
   s.emit("errorMsg","Show the Audience Poll and wait for at least one audience member to scan the QR.");
   return;
 }
 const lifelineKey=`${r.winner.id}:${r.current}:audience`;
 r.lifelines.add(lifelineKey);
 r.winner.lifelinesUsed={...(r.winner.lifelinesUsed||{}),audience:true};
 startAudiencePollTimer(r);
 io.to(r.winner.id).emit("audiencePollApproved",{contestant:{name:r.winner.name,employeeCode:r.winner.employeeCode},counts:pollCounts(r.poll)});
 io.to(s.data.room).emit("audiencePollStarted",{contestant:{name:r.winner.name,employeeCode:r.winner.employeeCode},started:true,durationMs:AUDIENCE_POLL_TIME_MS});
 emitState(s.data.room);
});
s.on("host:audiencePollStop",()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;stopAudiencePoll(r,false)});
 s.on("host:pauseQuestionTimer",()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id||r.phase!=="question")return;pauseQuestionTimer(r);emitState(s.data.room);});
 s.on("host:resumeQuestionTimer",()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id||r.phase!=="question")return;if(r.pollActive)return;startQuestionTimer(r,questionRemaining(r)||QUESTION_TIME_MS);emitState(s.data.room);});
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
 r.phase="question";r.current=0;r.answers.clear();r.pendingAnswer=null;r.pendingQuit=null;r.pendingPollRequest=null;r.poll.clear();r.pollActive=false;r.pollVotingOpen=false;r.lifelines.clear();r.fiftyFiftyRemoved.clear();r.eliminatedContestant=null;r.contestantQuit=null;resetQuestionClock(r);if(r.winner){
   r.winner.lifelinesUsed={"5050":false,"audience":false,"phone":false};
   const contestantUser=r.users.get(r.winner.id);
   if(contestantUser){contestantUser.lifelinesUsed={"5050":false,"audience":false,"phone":false};contestantUser.assuredMoney=0;contestantUser.prizeWon=0;}
 }
 startQuestionTimer(r);
 emitState(s.data.room);
});
 s.on("host:nextFastest",async()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;await pick7(r);emitState(s.data.room)});
 s.on("host:restartFastest",async()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;if(!r.pool.length)return;await restartFastest(r);emitState(s.data.room)});
 s.on("host:nextQuestion",()=>{
 const r=rooms.get(s.data.room);if(!r||r.host!==s.id||r.phase!=="question")return;
 if(r.pendingQuit){s.emit("errorMsg","Approve or reject the pending Safe Quit request before moving to the next question.");return;}
 clearQuestionTimer(r);clearAudiencePollTimer(r);
 r.current++;
 r.answers.clear();r.pendingAnswer=null;r.pendingPollRequest=null;r.poll.clear();r.pollActive=false;r.pollVotingOpen=false;r.lifelines.clear();
 if(r.current>=TOTAL_QUESTIONS||r.current>=r.questions.length){
   r.phase="finished";r.current=-1;
   clearTimeout(r.timer);
   r.timer=setTimeout(()=>{
     const x=rooms.get(s.data.room);if(!x)return;
     x.winner=null;x.pool=[];x.pendingAnswer=null;x.pendingPollRequest=null;
     for(const u of x.users.values())u.inPool=false;
     x.phase="registration";emitState(s.data.room);
   },5000);
 }else {r.phase="question";resetQuestionClock(r);startQuestionTimer(r);}
 emitState(s.data.room);
});
 s.on("host:restartEvent",()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;for(const u of r.users.values()){u.score=0;u.assuredMoney=0;u.prizeWon=0;u.status="active";u.inPool=false;u.lifelinesUsed={"5050":false,"audience":false,"phone":false}}r.contestantId=null;r.failed.clear();r.completed.clear();r.played.clear();r.pool=[];r.usedQuestionIds.clear();r.winner=null;r.current=-1;r.fiftyFiftyRemoved.clear();r.eliminatedContestant=null;r.contestantQuit=null;r.pendingQuit=null;r.pollActive=false;r.pollVotingOpen=false;r.phase="registration";emitState(s.data.room)});
 s.on("player:answer",({choice})=>{
  const r=rooms.get(s.data.room);if(!r||r.phase!=="question")return;
  const u=r.users.get(s.id);
  if(!u||u.status!=="active"||!r.winner||r.winner.id!==s.id)return;
  if(r.pendingAnswer||r.pendingQuit)return;
  const q=r.questions[r.current],picked=Number(choice);
  if(picked<0||picked>3)return;
  pauseQuestionTimer(r);
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
  clearQuestionTimer(r);clearAudiencePollTimer(r);
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
        clearQuestionTimer(x);clearAudiencePollTimer(x);
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
        resetQuestionClock(x);
        startQuestionTimer(x);
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
  startQuestionTimer(r,questionRemaining(r)||QUESTION_TIME_MS);
  io.to(s.data.room).emit("answerRejected",{contestant:{name:pending.name,employeeCode:pending.employeeCode}});
  emitState(s.data.room);
 });

 s.on("audience:poll",({choice},ack)=>{
  const ok=(value)=>{if(typeof ack==="function")ack(value)};
  const r=rooms.get(s.data.room);
  if(!r){ok({ok:false,error:"You are not connected to a quiz room."});return}
  if(r.phase!=="question"||!r.pollActive||!r.pollVotingOpen){ok({ok:false,error:"The Host is preparing the poll. Please wait for the 60-second countdown."});return}
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
 if(s.data.role==="audience" && r.pollActive)emitState(roomCode);
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



// ========================= GamesArena Runner =========================
// Original GamesArena platformer inspired by classic side-scrolling platform games.
// Phones are controllers; the TV browser renders the shared game world.
const RUNNER_ROOM_GRACE_MS=10*60*1000;
function runnerKeepAlive(r){
  if(r.cleanupTimer)clearTimeout(r.cleanupTimer);
  r.cleanupTimer=setTimeout(()=>{
    const x=runnerRooms.get(r.code);
    if(x && !x.players.size && !x.host){
      clearInterval(x.timer);
      runnerRooms.delete(r.code);
    }
  },RUNNER_ROOM_GRACE_MS);
}
const runnerNs=io.of('/runner');
const runnerRooms=new Map();
const RUNNER_COLORS=['#ff5b5b','#20b7df','#7b61ff','#f2b84b'];
const RUNNER_MAX=4, RUNNER_W=3200, RUNNER_H=720, RUNNER_TICK=50;
const RUNNER_PLATFORMS=[
 {x:0,y:620,w:520,h:100},{x:610,y:540,w:360,h:28},{x:1050,y:455,w:300,h:28},
 {x:1430,y:560,w:420,h:28},{x:1940,y:470,w:330,h:28},{x:2370,y:390,w:320,h:28},
 {x:2780,y:520,w:420,h:28},{x:900,y:650,w:700,h:70},{x:1800,y:650,w:1200,h:70}
];
const RUNNER_COINS=[
 {x:250,y:560},{x:700,y:480},{x:790,y:480},{x:1160,y:395},{x:1260,y:395},
 {x:1580,y:500},{x:1710,y:500},{x:2040,y:410},{x:2150,y:410},{x:2470,y:330},
 {x:2580,y:330},{x:2920,y:460},{x:3030,y:460}
];
const RUNNER_FINISH={x:3090,y:430};
function runnerCode(){let c;do c=String(Math.floor(1000+Math.random()*9000));while(runnerRooms.has(c));return c;}
function runnerRoom(){return{code:'',host:null,players:new Map(),phase:'lobby',startAt:0,timer:null,elapsed:0,coins:new Set(),winner:null};}
function runnerSpawn(i){
 return {x:90,y:560-i*42,vx:0,vy:0,onGround:false,coins:0,finished:false,finishTime:null,inputX:0,jump:false};
}
function runnerPublic(r){
 return {
  code:r.code,phase:r.phase,elapsed:r.phase==='race'?Date.now()-r.startAt:r.elapsed,
  platforms:RUNNER_PLATFORMS,coins:RUNNER_COINS.map((c,i)=>({...c,taken:r.coins.has(i)})),finish:RUNNER_FINISH,
  winner:r.winner,
  players:[...r.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,x:p.x,y:p.y,vx:p.vx,vy:p.vy,coins:p.coins,finished:p.finished,finishTime:p.finishTime}))
 };
}
function runnerBroadcast(code){const r=runnerRooms.get(code);if(r)runnerNs.to(code).emit('state',runnerPublic(r));}
function runnerTick(r){
 if(r.phase!=='race')return;
 const now=Date.now(),dt=Math.min(.05,(now-r._last)/1000);r._last=now;
 for(const p of r.players.values()){
   if(p.finished)continue;
   const dir=Math.max(-1,Math.min(1,p.inputX||0));
   p.vx += dir*.55;
   p.vx *= .84;
   p.vx=Math.max(-6,Math.min(6,p.vx));
   if(p.jump && p.onGround){p.vy=-12;p.onGround=false;}
   p.jump=false;
   p.vy=Math.min(14,p.vy+.65);
   const oldY=p.y;
   let nx=p.x+p.vx, ny=p.y+p.vy;
   p.onGround=false;
   for(const plat of RUNNER_PLATFORMS){
     const withinX=nx+28>plat.x && nx-28<plat.x+plat.w;
     if(withinX && oldY+42<=plat.y && ny+42>=plat.y && p.vy>=0){
       ny=plat.y-42;p.vy=0;p.onGround=true;
     }
   }
   p.x=Math.max(25,Math.min(RUNNER_W-25,nx));p.y=ny;
   if(p.y>RUNNER_H+100){p.x=90;p.y=520;p.vx=0;p.vy=0;}
   for(let i=0;i<RUNNER_COINS.length;i++){
     if(r.coins.has(i))continue;
     const c=RUNNER_COINS[i];
     if(Math.hypot(p.x-c.x,p.y-c.y)<48){r.coins.add(i);p.coins++;}
   }
   if(p.x>=RUNNER_FINISH.x && !p.finished){
     p.finished=true;p.finishTime=now-r.startAt;
     if(!r.winner)r.winner={id:p.id,name:p.name,color:p.color,time:p.finishTime,coins:p.coins};
   }
 }
 if([...r.players.values()].every(p=>p.finished||p.x>=RUNNER_FINISH.x)){
   r.phase='finished';r.elapsed=now-r.startAt;clearInterval(r.timer);r.timer=null;
 }
 runnerBroadcast(r.code);
}
runnerNs.on('connection',socket=>{
 socket.on('tv',({room}={})=>{
   const code=String(room||'').trim().toUpperCase(),r=runnerRooms.get(code);
   socket.data.requestedRoom=code; socket.data.tv=true;
   if(!r){
     socket.emit('waitingForRoom',{room:code,message:'Waiting for the Host to create or reconnect the game…'});
     return;
   }
   socket.join(code);socket.data.room=code;
   socket.emit('joined',{room:code,tv:true});runnerBroadcast(code);
 });
 socket.on('create',({name='Player'}={})=>{
   if(socket.data.room)return;
   const code=runnerCode(),r=runnerRoom();r.code=code;r.host=socket.id;
   const p={id:socket.id,name:String(name).slice(0,18)||'Player',color:RUNNER_COLORS[0],...runnerSpawn(0)};
   r.players.set(socket.id,p);runnerRooms.set(code,r);socket.join(code);socket.data.room=code;
   socket.emit('joined',{room:code,host:true});runnerBroadcast(code);
 });
 socket.on('join',({room,name='Player'}={})=>{
   const code=String(room||'').toUpperCase(),r=runnerRooms.get(code);
   if(!r)return socket.emit('errorMsg','Room not found.');
   if(r.players.size>=RUNNER_MAX)return socket.emit('errorMsg','Room is full.');
   if(r.phase!=='lobby')return socket.emit('errorMsg','Race already started.');
   const i=r.players.size,p={id:socket.id,name:String(name).slice(0,18)||'Player',color:RUNNER_COLORS[i],...runnerSpawn(i)};
   r.players.set(socket.id,p);socket.join(code);socket.data.room=code;
   socket.emit('joined',{room:code,host:false});runnerBroadcast(code);
 });
 socket.on('resume',({room,name='Host'}={})=>{
   const code=String(room||'').trim().toUpperCase(),r=runnerRooms.get(code);
   if(!r)return socket.emit('errorMsg','Room not found. Start a new game from the Runner controller.');
   if(r.host && r.host!==socket.id)return socket.emit('errorMsg','This room already has an active Host.');
   r.host=socket.id;
   r.hostDisconnectTimer&&clearTimeout(r.hostDisconnectTimer); r.hostDisconnectTimer=null;
   socket.join(code);socket.data.room=code;socket.data.host=true;
   // Reclaim the Host's player slot by matching the saved Host name.
   const oldHost=[...r.players.values()].find(p=>p.name===String(name).slice(0,18));
   if(oldHost){
     const oldId=oldHost.id; oldHost.id=socket.id;
     r.players.delete(oldId); r.players.set(socket.id,oldHost);
   }else{
     const p={id:socket.id,name:String(name).slice(0,18)||'Host',color:RUNNER_COLORS[0],...runnerSpawn(0)};
     r.players.set(socket.id,p);
   }
   socket.emit('joined',{room:code,host:true,resumed:true});runnerBroadcast(code);
 });
 socket.on('start',()=>{
   const r=runnerRooms.get(socket.data.room);
   if(!r||r.host!==socket.id||r.players.size<1||r.phase!=='lobby')return;
   r.phase='race';r.startAt=Date.now();r._last=Date.now();r.coins=new Set();r.winner=null;
   r.timer=setInterval(()=>runnerTick(r),RUNNER_TICK);runnerBroadcast(r.code);
 });
 socket.on('input',({x=0,jump=false}={})=>{
   const r=runnerRooms.get(socket.data.room),p=r?.players.get(socket.id);
   if(!p||r.phase!=='race')return;
   p.inputX=Math.max(-1,Math.min(1,Number(x)||0));if(jump)p.jump=true;
 });
 socket.on('restart',()=>{
   const r=runnerRooms.get(socket.data.room);if(!r||r.host!==socket.id)return;
   clearInterval(r.timer);r.timer=null;r.phase='lobby';r.startAt=0;r.elapsed=0;r.coins=new Set();r.winner=null;
   let i=0;for(const p of r.players.values())Object.assign(p,runnerSpawn(i++));
   runnerBroadcast(r.code);
 });
 socket.on('disconnect',()=>{
   const code=socket.data.room,r=runnerRooms.get(code);if(!r)return;
   if(socket.data.tv)return;
   if(r.host===socket.id){
     // Keep the room alive for mobile/Wi-Fi reconnects instead of deleting it.
     r.host=null;
     runnerKeepAlive(r);
   }
   // Do not remove a player immediately; their controller can reconnect.
   runnerBroadcast(code);
 });
});

// ========================= Mini Kart Race =========================
const kartNs=io.of('/kart');
const kartRooms=new Map();
const KART_COLORS=['#ff5b5b','#20b7df','#7b61ff','#f2b84b'];
const KART_MAX=4, KART_LAPS=3, KART_TICK=50;
function kartCode(){let c;do c=String(Math.floor(1000+Math.random()*9000));while(kartRooms.has(c));return c;}
function kartRoom(){return{code:'',host:null,players:new Map(),phase:'lobby',countdownUntil:0,startAt:0,lastTick:Date.now(),timer:null};}
function kartPublic(r){
 return {code:r.code,phase:r.phase,countdownRemaining:Math.max(0,r.countdownUntil-Date.now()),raceTime:r.phase==='race'?Date.now()-r.startAt:0,
 players:[...r.players.values()].map(x=>({id:x.id,name:x.name,color:x.color,x:x.x,y:x.y,vx:x.vx,vy:x.vy,lap:x.lap,progress:x.progress,finished:x.finished,finishTime:x.finishTime})),laps:KART_LAPS};
}
function kartBroadcast(code){const r=kartRooms.get(code);if(r)kartNs.to(code).emit('state',kartPublic(r));}
function kartSpawn(i){const row=Math.floor(i/2),side=i%2;return{x:0.5+(side?0.055:-0.055),y:0.84+row*0.055,vx:0.0058,vy:0,lap:0,progress:0,finished:false,finishTime:null,prevAngle:null};}
function kartAngle(x,y){const cx=.5,cy=.5,rx=.34,ry=.35;return Math.atan2((y-cy)/ry,(x-cx)/rx);}
function kartProgress(x,y){let a=kartAngle(x,y);let p=(a+Math.PI*0.5)%(Math.PI*2);if(p<0)p+=Math.PI*2;return p/(Math.PI*2);}
function kartTick(r){
 const now=Date.now(),dt=Math.min(.08,(now-r.lastTick)/1000);r.lastTick=now;
 if(r.phase!=='race')return;
 for(const pl of r.players.values()){
   const steer=pl.inputX||0, throttle=pl.inputY||0;
   const accel=0.00024, max=.0105, drag=.92;
   const speed=Math.hypot(pl.vx,pl.vy);
   const angle=Math.atan2(pl.vy,pl.vx);
   const desired=angle + steer*.065*(0.7+Math.min(1,speed/.006));
   pl.vx += Math.cos(desired)*accel*throttle;
   pl.vy += Math.sin(desired)*accel*throttle;
   pl.vx*=drag;pl.vy*=drag;
   const sp=Math.hypot(pl.vx,pl.vy);
   if(sp>max){pl.vx=pl.vx/sp*max;pl.vy=pl.vy/sp*max;}
   let nx=pl.x+pl.vx*(dt/.05),ny=pl.y+pl.vy*(dt/.05);
   const dx=(nx-.5)/.34,dy=(ny-.5)/.35,rad=Math.hypot(dx,dy);
   // Keep cars on the oval track. A soft push toward the road center acts like a wall.
   if(rad>1.035){nx=.5+(nx-.5)/rad*1.035*.34;ny=.5+(ny-.5)/rad*1.035*.35;pl.vx*=.45;pl.vy*=.45;}
   if(rad<.72){nx=.5+(nx-.5)/Math.max(.72,rad)*.72*.34;ny=.5+(ny-.5)/Math.max(.72,rad)*.72*.35;}
   pl.x=Math.max(.06,Math.min(.94,nx));pl.y=Math.max(.06,Math.min(.94,ny));
   const prog=kartProgress(pl.x,pl.y);
   if(pl.prevProgress!==undefined && pl.prevProgress>.85 && prog<.15 && speed>.001){pl.lap++;}
   pl.prevProgress=prog;pl.progress=prog;
   if(pl.lap>=KART_LAPS&&!pl.finished){pl.finished=true;pl.finishTime=now-r.startAt;pl.vx*=.2;pl.vy*=.2;}
 }
 const finished=[...r.players.values()].filter(p=>p.finished).sort((a,b)=>a.finishTime-b.finishTime);
 if(finished.length===r.players.size){r.phase='finished';clearInterval(r.timer);}
 kartBroadcast(r.code);
}
kartNs.on('connection',socket=>{
 socket.on('tv',({room}={})=>{const r=kartRooms.get(String(room||'').toUpperCase());if(!r)return socket.emit('errorMsg','Room not found.');socket.join(r.code);socket.data.room=r.code;socket.data.tv=true;socket.emit('joined',{room:r.code,tv:true});kartBroadcast(r.code);});
 socket.on('create',({name='Player'}={})=>{
   if(socket.data.room)return;const code=kartCode(),r=kartRoom();r.code=code; r.host=socket.id;
   const p={id:socket.id,name:String(name).slice(0,18)||'Player',color:KART_COLORS[0],...kartSpawn(0),inputX:0,inputY:0};r.players.set(socket.id,p);kartRooms.set(code,r);socket.join(code);socket.data.room=code;
   socket.emit('joined',{room:code,host:true});kartBroadcast(code);
 });
 socket.on('join',({room,name='Player'}={})=>{
   const code=String(room||'').toUpperCase(),r=kartRooms.get(code);if(!r)return socket.emit('errorMsg','Room not found.');
   if(r.players.size>=KART_MAX)return socket.emit('errorMsg','Room is full.');
   if(r.phase!=='lobby')return socket.emit('errorMsg','Race already started.');
   const i=r.players.size,p={id:socket.id,name:String(name).slice(0,18)||'Player',color:KART_COLORS[i],...kartSpawn(i),inputX:0,inputY:0};r.players.set(socket.id,p);socket.join(code);socket.data.room=code;
   socket.emit('joined',{room:code,host:false});kartBroadcast(code);
 });
 socket.on('start',()=>{const r=kartRooms.get(socket.data.room);if(!r||r.host!==socket.id||r.players.size<2||r.phase!=='lobby')return;r.phase='countdown';r.countdownUntil=Date.now()+4000;r.lastTick=Date.now();kartBroadcast(r.code);setTimeout(()=>{const x=kartRooms.get(r.code);if(!x||x.phase!=='countdown')return;x.phase='race';x.startAt=Date.now();x.lastTick=Date.now();x.timer=setInterval(()=>kartTick(x),KART_TICK);kartBroadcast(x.code);},4000);});
 socket.on('input',({x=0,y=0}={})=>{const r=kartRooms.get(socket.data.room),p=r?.players.get(socket.id);if(!p||r.phase!=='race')return;p.inputX=Math.max(-1,Math.min(1,Number(x)||0));p.inputY=Math.max(-1,Math.min(1,Number(y)||0));});
 socket.on('restart',()=>{const r=kartRooms.get(socket.data.room);if(!r||r.host!==socket.id)return;clearInterval(r.timer);let i=0;for(const p of r.players.values()){Object.assign(p,kartSpawn(i++),{inputX:0,inputY:0});}r.phase='lobby';r.countdownUntil=0;r.startAt=0;kartBroadcast(r.code);});
 socket.on('disconnect',()=>{const code=socket.data.room,r=kartRooms.get(code);if(!r)return;r.players.delete(socket.id);if(r.host===socket.id){const next=r.players.values().next().value;r.host=next?.id||null;}if(!r.players.size){clearInterval(r.timer);kartRooms.delete(code);}else{if(r.phase!=='lobby'&&r.players.size<2){clearInterval(r.timer);r.phase='lobby';}kartBroadcast(code);}});
});

initDb().then(()=>server.listen(PORT,"0.0.0.0",()=>console.log(`Perficient Office Quiz Arena v4 listening on 0.0.0.0:${PORT}`))).catch(e=>{console.error("Startup error:",e);process.exit(1)});
