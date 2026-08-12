const path=require("path"),fs=require("fs"),http=require("http"),express=require("express"),crypto=require("crypto");
const {Server}=require("socket.io"),QRCode=require("qrcode"),mysql=require("mysql2/promise");
const independenceBank=require("./questions.json");
const app=express(),server=http.createServer(app),io=new Server(server,{cors:{origin:true}});
const PORT=Number(process.env.PORT)||10000;
let db=null;
app.use(express.json({limit:"1mb"}));
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

/* ===== Host Console authentication =====
   Host credentials are stored in MySQL (host_users). The bundled scrypt
   values are only used to bootstrap the first host account when the table
   is empty. The browser never receives the password or password hash.
*/
const HOST_USERNAME=process.env.HOST_USERNAME||"venkat";
const HOST_PASSWORD_HASH=process.env.HOST_PASSWORD_HASH||"2c18d6138ed31b81065e58fe1856fea35d3d61802193be58408644ec4e81c0c66e1c056f77b4e4734aac078b36eebfb9b3e782a112d086a5581e20254f0570e2";
const HOST_PASSWORD_SALT=process.env.HOST_PASSWORD_SALT||"3d0424e1a76ec11a32e0e1c447a12dc6";
const hostSessions=new Map();

function safeEqualText(a,b){
 const aa=Buffer.from(String(a||""));
 const bb=Buffer.from(String(b||""));
 return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
function verifyScryptPassword(password,hash,salt){
 try{
   const derived=crypto.scryptSync(String(password||""),Buffer.from(String(salt||""),"hex"),64).toString("hex");
   return safeEqualText(derived,hash);
 }catch{return false}
}
async function validHostPassword(username,password){
 try{
   if(db){
     const [rows]=await db.query(
       `SELECT username,password_hash,password_salt FROM host_users WHERE username=? LIMIT 1`,
       [String(username||"").trim()]
     );
     if(rows[0]){
       return verifyScryptPassword(password,rows[0].password_hash,rows[0].password_salt);
     }
   }
 }catch(err){
   console.error("host credential lookup failed:",err.message);
 }
 return String(username||"")===HOST_USERNAME &&
   verifyScryptPassword(password,HOST_PASSWORD_HASH,HOST_PASSWORD_SALT);
}
function makeHostSession(){
 const token=crypto.randomBytes(32).toString("hex");
 hostSessions.set(token,{createdAt:Date.now(),username:HOST_USERNAME});
 return token;
}
function isHostSession(req){
 const token=getCookie(req,"gamesarena_host_session");
 return !!token && hostSessions.has(token);
}
function requireHost(req,res,next){
 if(!isHostSession(req))return res.status(401).json({error:"Host login required."});
 next();
}
function socketHasHostSession(s){
 const raw=s.handshake?.headers?.cookie||"";
 const m=raw.match(/(?:^|;\s*)gamesarena_host_session=([^;]+)/);
 return !!m && hostSessions.has(decodeURIComponent(m[1]));
}

app.post("/api/host/login",async(req,res)=>{
 const {username,password}=req.body||{};
 if(!await validHostPassword(username,password))
   return res.status(401).json({ok:false,error:"Invalid host username or password."});
 const token=makeHostSession();
 res.setHeader("Set-Cookie",`gamesarena_host_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`);
 res.json({ok:true,username:String(username).trim()});
});
app.post("/api/host/logout",(req,res)=>{
 const token=getCookie(req,"gamesarena_host_session");
 if(token)hostSessions.delete(token);
 res.setHeader("Set-Cookie","gamesarena_host_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
 res.json({ok:true});
});
app.get("/api/host/me",(req,res)=>res.json({ok:isHostSession(req),username:HOST_USERNAME}));

app.get("/api/host/db-status",requireHost,async(req,res)=>{
 if(!db)return res.status(503).json({ok:false,connected:false,error:"DB_HOST is not configured"});
 try{
   const [[meta]] = await db.query("SELECT DATABASE() AS databaseName, NOW() AS serverTime");
   const tables=["players","game_results","payments","host_users","payment_users","questions"];
   const counts={};
   for(const table of tables){
     const [[r]]=await db.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
     counts[table]=Number(r.c||0);
   }
   res.json({ok:true,connected:true,database:meta.databaseName,serverTime:meta.serverTime,counts});
 }catch(err){
   console.error("DB status failed:",err.message);
   res.status(500).json({ok:false,connected:false,error:err.message});
 }
});

/* ===== Payment Inventory authentication =====
   Separate credentials/session from the live Host Console. Password is stored
   as a scrypt hash in MySQL (payment_users), never in the browser.
*/
const PAYMENT_USERNAME=process.env.PAYMENT_USERNAME||"venkat";
const PAYMENT_PASSWORD_HASH=process.env.PAYMENT_PASSWORD_HASH||"88a3714143b921be53017a72f26bd92020597b4e35ebae15a63519c241770bcde03125f53d3adc0b8526516a122a2b10eb1562fb0babcc28816e552c99fdd898";
const PAYMENT_PASSWORD_SALT=process.env.PAYMENT_PASSWORD_SALT||"20acaae0dc77f6ea8f652490aa01515e";
const paymentSessions=new Map();
function makePaymentSession(){
 const token=crypto.randomBytes(32).toString("hex");
 paymentSessions.set(token,{createdAt:Date.now(),username:PAYMENT_USERNAME});
 return token;
}
function isPaymentSession(req){
 const token=getCookie(req,"gamesarena_payment_session");
 return !!token && paymentSessions.has(token);
}
function requirePaymentAdmin(req,res,next){
 if(!isPaymentSession(req))return res.status(401).json({error:"Payment inventory login required."});
 next();
}
async function validPaymentAdminPassword(username,password){
 try{
   if(db){
     const [rows]=await db.query(`SELECT username,password_hash,password_salt FROM payment_users WHERE username=? LIMIT 1`,[String(username||"").trim()]);
     if(rows[0])return verifyScryptPassword(password,rows[0].password_hash,rows[0].password_salt);
   }
 }catch(err){console.error("payment credential lookup failed:",err.message)}
 return String(username||"")===PAYMENT_USERNAME && verifyScryptPassword(password,PAYMENT_PASSWORD_HASH,PAYMENT_PASSWORD_SALT);
}
app.post("/api/payment-admin/login",async(req,res)=>{
 const {username,password}=req.body||{};
 if(!await validPaymentAdminPassword(username,password))return res.status(401).json({ok:false,error:"Invalid payment inventory username or password."});
 const token=makePaymentSession();
 res.setHeader("Set-Cookie",`gamesarena_payment_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`);
 res.json({ok:true,username:String(username).trim()});
});
app.post("/api/payment-admin/logout",(req,res)=>{
 const token=getCookie(req,"gamesarena_payment_session");
 if(token)paymentSessions.delete(token);
 res.setHeader("Set-Cookie","gamesarena_payment_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
 res.json({ok:true});
});
app.get("/api/payment-admin/me",(req,res)=>res.json({ok:isPaymentSession(req),username:PAYMENT_USERNAME}));

function requestBaseUrl(req){
 const configured=String(PUBLIC_URL||"").trim();
 if(configured && !/localhost|127\\.0\\.0\\.1/i.test(configured))return configured;
 const proto=String(req.headers["x-forwarded-proto"]||req.protocol||"http").split(",")[0].trim();
 const host=String(req.headers["x-forwarded-host"]||req.get("host")||"").split(",")[0].trim();
 return host ? `${proto}://${host}` : `http://localhost:${PORT}`;
}
app.get("/api/payment-qr",async(req,res)=>{
 try{
   const url=`${requestBaseUrl(req)}/payment.html?source=qr`;
   const qr=await QRCode.toDataURL(url,{margin:2,width:520,errorCorrectionLevel:"H"});
   res.json({ok:true,url,qr});
 }catch(err){console.error("payment QR failed:",err);res.status(500).json({ok:false,error:"Unable to create payment QR."});}
});

async function findOrCreatePlayer({name,registerNumber,phone}={}){
 if(!db)throw new Error("Database not configured");
 const playerName=String(name||"").trim().slice(0,150);
 const register=String(registerNumber||"").trim().slice(0,100);
 const mobile=String(phone||"").trim().slice(0,40);
 if(!playerName || !register)throw new Error("Player name and register number are required.");
 let [rows]=await db.query(
   `SELECT id,player_name AS playerName,register_number AS registerNumber,phone_number AS phoneNumber
    FROM players
    WHERE register_number=? ${mobile?"OR phone_number=?":""}
    ORDER BY id ASC LIMIT 1`,
   mobile?[register,mobile]:[register]
 );
 if(rows[0]){
   if(mobile){
     await db.query(
       `UPDATE players SET player_name=?,register_number=?,phone_number=? WHERE id=?`,
       [playerName,register,mobile,rows[0].id]
     );
   }else{
     await db.query(
       `UPDATE players SET player_name=?,register_number=? WHERE id=?`,
       [playerName,register,rows[0].id]
     );
   }
   return {id:rows[0].id,playerName,registerNumber:register,phoneNumber:mobile||rows[0].phoneNumber||""};
 }
 const [r]=await db.query(
   `INSERT INTO players(player_name,register_number,phone_number) VALUES(?,?,?)`,
   [playerName,register,mobile||null]
 );
 return {id:r.insertId,playerName,registerNumber:register,phoneNumber:mobile};
}

async function upsertGameLog({roomCode,player,amountWon=0,resultStatus="PLAYED",safeQuit=false,entryFee=0,playedAt=new Date()}){
 if(!player)return;
 if(!db){ console.warn("Game log skipped: MySQL is not connected."); return; }
 try{
   const p=await findOrCreatePlayer({
     name:player.name,
     registerNumber:player.employeeCode,
     phone:player.phone||""
   });
   await db.query(
    `INSERT INTO game_results(player_id,room_code,game_type,played_at,amount_won,entry_fee,result_status,safe_quit)
     VALUES(?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       played_at=VALUES(played_at),
       amount_won=VALUES(amount_won),
       entry_fee=VALUES(entry_fee),
       result_status=VALUES(result_status),
       safe_quit=VALUES(safe_quit)`,
    [p.id,String(roomCode||""),"GamesArena Quiz",playedAt,Number(amountWon||0),Number(entryFee||0),String(resultStatus||"PLAYED"),safeQuit?1:0]
   );
 }catch(err){console.error("player game log failed:",err.message)}
}

async function recordPlayerRegistration(roomCode,player,entryFee=0){
 if(!player)return;
 await upsertGameLog({
   roomCode,
   player,
   amountWon:0,
   resultStatus:"REGISTERED",
   safeQuit:false,
   entryFee,
   playedAt:new Date()
 });
}

function cleanPayment(body){
 const b=body||{};
 const method=String(b.paymentMethod||b.method||"").trim();
 const allowed=["Cash","UPI","Card","Other"];
 return {
   playerName:String(b.playerName||"").trim().slice(0,150),
   registerNumber:String(b.registerNumber||"").trim().slice(0,100),
   phone:String(b.phone||"").trim().slice(0,40),
   paymentDate:String(b.paymentDate||"").trim(),
   entryFee:Number(b.entryFee||0),
   paymentMethod:allowed.includes(method)?method:"",
   transactionReference:String(b.transactionReference||"").trim().slice(0,160),
   amountPaid:Number(b.amountPaid||0),
   notes:String(b.notes||"").trim().slice(0,2000)
 };
}
function validPayment(p){
 return p.playerName && p.registerNumber && p.phone && /^\d{4}-\d{2}-\d{2}$/.test(p.paymentDate)
   && Number.isFinite(p.entryFee)&&p.entryFee>=0
   && p.paymentMethod && Number.isFinite(p.amountPaid)&&p.amountPaid>=0;
}

/* Public payment form: creates/updates the player and stores the payment
   itself as PENDING in the payments table. The host later approves it. */
app.post("/api/payment-submissions",async(req,res)=>{
 if(!db)return res.status(503).json({ok:false,error:"Payment database is not configured. Please contact the host."});
 const p=cleanPayment(req.body);
 if(!validPayment(p))return res.status(400).json({ok:false,error:"Please complete all required payment fields."});
 try{
   const player=await findOrCreatePlayer({name:p.playerName,registerNumber:p.registerNumber,phone:p.phone});
   const [r]=await db.query(
    `INSERT INTO payments(player_id,payment_date,entry_fee,payment_method,transaction_reference,amount_paid,notes,status,submitted_at)
     VALUES(?,?,?,?,?,?,?,?,NOW())`,
    [player.id,p.paymentDate,p.entryFee,p.paymentMethod,p.transactionReference||null,p.amountPaid,p.notes||null,"PENDING"]
   );
   res.json({ok:true,id:r.insertId,message:"Payment submitted. The host will review and save it."});
 }catch(err){console.error("payment submission failed:",err);res.status(500).json({ok:false,error:"Unable to save the payment submission."});}
});

app.get("/api/payment-admin/players",requirePaymentAdmin,async(req,res)=>{
 if(!db)return res.status(503).json({error:"Database not configured"});
 try{
   const [rows]=await db.query(
     `SELECT id,player_name AS playerName,register_number AS registerNumber,phone_number AS phoneNumber
      FROM players ORDER BY player_name ASC LIMIT 1000`
   );
   res.json({ok:true,rows});
 }catch(err){res.status(500).json({error:"Unable to load players."});}
});

app.get("/api/payment-admin/payment-submissions",requirePaymentAdmin,async(req,res)=>{
 if(!db)return res.status(503).json({error:"Database not configured"});
 try{
   const [rows]=await db.query(
    `SELECT p.id,p.player_id AS playerId,
            pl.player_name AS playerName,pl.register_number AS registerNumber,pl.phone_number AS phone,
            p.payment_date AS paymentDate,p.entry_fee AS entryFee,p.payment_method AS paymentMethod,
            p.transaction_reference AS transactionReference,p.amount_paid AS amountPaid,p.notes,
            p.status,p.submitted_at AS submittedAt
     FROM payments p
     JOIN players pl ON pl.id=p.player_id
     WHERE p.status='PENDING'
     ORDER BY p.submitted_at DESC LIMIT 200`
   );
   res.json({ok:true,rows});
 }catch(err){console.error("pending payments failed:",err.message);res.status(500).json({error:"Unable to load payment submissions."});}
});

app.get("/api/payment-admin/payments",requirePaymentAdmin,async(req,res)=>{
 if(!db)return res.status(503).json({error:"Database not configured"});
 const q=String(req.query.q||"").trim();
 try{
   const [rows]=await db.query(
    `SELECT p.id,p.player_id AS playerId,
            pl.player_name AS playerName,pl.register_number AS registerNumber,pl.phone_number AS phone,
            p.payment_date AS paymentDate,p.entry_fee AS entryFee,p.payment_method AS paymentMethod,
            p.transaction_reference AS transactionReference,p.amount_paid AS amountPaid,p.notes,
            p.status,p.submitted_at AS submittedAt,p.reviewed_at AS reviewedAt,p.created_by AS createdBy
     FROM payments p
     JOIN players pl ON pl.id=p.player_id
     ${q?"WHERE pl.player_name LIKE ? OR pl.phone_number LIKE ? OR pl.register_number LIKE ?":""}
     ORDER BY p.payment_date DESC,p.id DESC LIMIT 500`,
    q?[`%${q}%`,`%${q}%`,`%${q}%`]:[]
   );
   res.json({ok:true,rows});
 }catch(err){console.error("payment lookup failed:",err);res.status(500).json({error:"Unable to load payment records."});}
});

app.post("/api/payment-admin/payments",requirePaymentAdmin,async(req,res)=>{
 if(!db)return res.status(503).json({ok:false,error:"Database not configured"});
 const p=cleanPayment(req.body);
 if(!validPayment(p))return res.status(400).json({ok:false,error:"Please complete all required payment fields."});
 const paymentId=req.body?.submissionId?Number(req.body.submissionId):0;
 try{
   const player=await findOrCreatePlayer({name:p.playerName,registerNumber:p.registerNumber,phone:p.phone});
   if(paymentId){
     const [r]=await db.query(
       `UPDATE payments
        SET player_id=?,payment_date=?,entry_fee=?,payment_method=?,transaction_reference=?,
            amount_paid=?,notes=?,status='APPROVED',reviewed_at=NOW(),created_by=?
        WHERE id=?`,
       [player.id,p.paymentDate,p.entryFee,p.paymentMethod,p.transactionReference||null,p.amountPaid,p.notes||null,PAYMENT_USERNAME,paymentId]
     );
     if(!r.affectedRows)return res.status(404).json({ok:false,error:"Payment submission not found."});
     return res.json({ok:true,id:paymentId});
   }
   const [r]=await db.query(
     `INSERT INTO payments(player_id,payment_date,entry_fee,payment_method,transaction_reference,amount_paid,notes,status,reviewed_at,created_by)
      VALUES(?,?,?,?,?,?,?,'APPROVED',NOW(),?)`,
     [player.id,p.paymentDate,p.entryFee,p.paymentMethod,p.transactionReference||null,p.amountPaid,p.notes||null,PAYMENT_USERNAME]
   );
   res.json({ok:true,id:r.insertId});
 }catch(err){console.error("payment record save failed:",err);res.status(500).json({ok:false,error:"Unable to save the payment record."});}
});

app.post("/api/payment-admin/payment-submissions/:id/reject",requirePaymentAdmin,async(req,res)=>{
 if(!db)return res.status(503).json({ok:false,error:"Database not configured"});
 try{
   const [r]=await db.query(`UPDATE payments SET status='REJECTED',reviewed_at=NOW(),created_by=? WHERE id=?`,[PAYMENT_USERNAME,Number(req.params.id)]);
   res.json({ok:r.affectedRows>0});
 }catch(err){res.status(500).json({ok:false,error:"Unable to reject the submission."});}
});

app.get("/api/payment-admin/player-logs",requirePaymentAdmin,async(req,res)=>{
 if(!db)return res.status(503).json({error:"Database not configured"});
 const q=String(req.query.q||"").trim();
 try{
   const [rows]=await db.query(
    `SELECT g.id,g.room_code AS roomCode,g.game_type AS gameType,
            pl.player_name AS playerName,pl.register_number AS registerNumber,pl.phone_number AS phone,
            g.played_at AS playedAt,g.entry_fee AS entryFee,g.amount_won AS amountWon,
            g.result_status AS resultStatus,g.safe_quit AS safeQuit
     FROM game_results g
     JOIN players pl ON pl.id=g.player_id
     ${q?"WHERE pl.player_name LIKE ? OR pl.phone_number LIKE ? OR pl.register_number LIKE ?":""}
     ORDER BY g.played_at DESC LIMIT 500`,
    q?[`%${q}%`,`%${q}%`,`%${q}%`]:[]
   );
   res.json({ok:true,rows});
 }catch(err){console.error("player history failed:",err);res.status(500).json({error:"Unable to load player history."});}
});

;
app.use(express.static(path.join(__dirname,"public")));
app.get("/healthz",(req,res)=>res.status(200).json({ok:true,service:"gamesarena"}));

const fallback=[];
async function ensureColumn(table,column,definition){
 const [rows]=await db.query(
   `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
   [table,column]
 );
 if(!Number(rows[0]?.c)){
   await db.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
 }
}
async function ensureIndex(table,indexName,definition){
 const [rows]=await db.query(
   `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?`,
   [table,indexName]
 );
 if(!Number(rows[0]?.c)){
   try{ await db.query(`ALTER TABLE \`${table}\` ADD ${definition}`); }
   catch(err){ console.warn(`Could not add index ${indexName}:`,err.message); }
 }
}

async function initDb(){
 if(!process.env.DB_HOST){
   console.warn("DB_HOST is not configured; MySQL features will remain unavailable.");
   return;
 }
 db=await mysql.createPool({
   host:process.env.DB_HOST,
   user:process.env.DB_USER,
   password:process.env.DB_PASSWORD,
   database:process.env.DB_NAME,
   port:Number(process.env.DB_PORT||3306),
   connectionLimit:5,
   waitForConnections:true,
   queueLimit:0
 });

 await db.query("SELECT 1");
 console.log(`GamesArena MySQL connected: ${process.env.DB_HOST}/${process.env.DB_NAME}`);

 await db.query(`CREATE TABLE IF NOT EXISTS questions(
   id INT AUTO_INCREMENT PRIMARY KEY,
   text_q TEXT NOT NULL,
   option_a VARCHAR(500) NOT NULL,
   option_b VARCHAR(500) NOT NULL,
   option_c VARCHAR(500) NOT NULL,
   option_d VARCHAR(500) NOT NULL,
   answer_idx TINYINT NOT NULL,
   points INT NOT NULL DEFAULT 100
 )`);

 /* These are the four application tables created for GamesArena. */
 await db.query(`CREATE TABLE IF NOT EXISTS host_users(
   id INT AUTO_INCREMENT PRIMARY KEY,
   username VARCHAR(100) NOT NULL UNIQUE,
   password_hash VARCHAR(255) NOT NULL,
   password_salt VARCHAR(255) NULL,
   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
 )`);

 await db.query(`CREATE TABLE IF NOT EXISTS payment_users(
   id INT AUTO_INCREMENT PRIMARY KEY,
   username VARCHAR(100) NOT NULL UNIQUE,
   password_hash VARCHAR(255) NOT NULL,
   password_salt VARCHAR(255) NULL,
   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
 )`);

 await db.query(`CREATE TABLE IF NOT EXISTS players(
   id INT AUTO_INCREMENT PRIMARY KEY,
   player_name VARCHAR(150) NOT NULL,
   register_number VARCHAR(100),
   phone_number VARCHAR(30),
   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
 )`);

 await db.query(`CREATE TABLE IF NOT EXISTS game_results(
   id INT AUTO_INCREMENT PRIMARY KEY,
   player_id INT NOT NULL,
   played_at DATETIME NOT NULL,
   amount_won DECIMAL(10,2) DEFAULT 0,
   FOREIGN KEY (player_id) REFERENCES players(id)
 )`);

 await db.query(`CREATE TABLE IF NOT EXISTS payments(
   id INT AUTO_INCREMENT PRIMARY KEY,
   player_id INT NOT NULL,
   entry_fee DECIMAL(10,2) DEFAULT 0,
   payment_method VARCHAR(30) NOT NULL,
   transaction_reference VARCHAR(160),
   amount_paid DECIMAL(10,2) NOT NULL,
   payment_date DATE NOT NULL,
   notes TEXT,
   FOREIGN KEY (player_id) REFERENCES players(id)
 )`);

 /* Upgrade the simple tables above with the fields needed by the live app.
    Existing user data is preserved. */
 await ensureColumn("players","register_number","register_number VARCHAR(100)");
 await ensureColumn("players","phone_number","phone_number VARCHAR(30)");
 await ensureColumn("game_results","room_code","room_code VARCHAR(20) NOT NULL DEFAULT ''");
 await ensureColumn("game_results","game_type","game_type VARCHAR(60) NOT NULL DEFAULT 'GamesArena Quiz'");
 await ensureColumn("game_results","entry_fee","entry_fee DECIMAL(10,2) NOT NULL DEFAULT 0");
 await ensureColumn("game_results","result_status","result_status VARCHAR(40) NOT NULL DEFAULT 'PLAYED'");
 await ensureColumn("game_results","safe_quit","safe_quit TINYINT(1) NOT NULL DEFAULT 0");
 await ensureColumn("payments","status","status VARCHAR(20) NOT NULL DEFAULT 'PENDING'");
 await ensureColumn("payments","submitted_at","submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
 await ensureColumn("payments","reviewed_at","reviewed_at DATETIME NULL");
 await ensureColumn("payments","created_by","created_by VARCHAR(100) NULL");

 /* Keep the complete GamesArena question bank in MySQL as well as questions.json.
    This makes the database useful for backups/reporting and ensures the bank is
    populated immediately after deployment. */
 await ensureColumn("questions","category","VARCHAR(100) NULL");
 await ensureColumn("questions","difficulty","TINYINT NULL");
 await ensureColumn("questions","explanation","TEXT NULL");
 await ensureColumn("questions","reference_image","TEXT NULL");
 await ensureColumn("questions","source","VARCHAR(500) NULL");
 try{
   const bank=JSON.parse(fs.readFileSync(path.join(__dirname,"questions.json"),"utf8"));
   for(const q of (Array.isArray(bank)?bank:[])){
     const opts=Array.isArray(q.options)?q.options:[];
     if(!q.id||opts.length<4)continue;
     await db.query(
       `INSERT INTO questions(id,text_q,option_a,option_b,option_c,option_d,answer_idx,points,category,difficulty,explanation,reference_image,source)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE
          text_q=VALUES(text_q),option_a=VALUES(option_a),option_b=VALUES(option_b),
          option_c=VALUES(option_c),option_d=VALUES(option_d),answer_idx=VALUES(answer_idx),
          points=VALUES(points),category=VALUES(category),difficulty=VALUES(difficulty),
          explanation=VALUES(explanation),reference_image=VALUES(reference_image),source=VALUES(source)`,
       [String(q.id),String(q.text||q.question||""),String(opts[0]),String(opts[1]),String(opts[2]),String(opts[3]),
        Number(q.answer ?? q.correctAnswer ?? 0),Number(q.points||0),String(q.category||""),
        Number(q.difficulty||0),String(q.explanation||""),String(q.image||q.referenceImage||""),String(q.source||q.imageCredit||"")]
     );
   }
   console.log(`GamesArena question bank synced to MySQL: ${bank.length} questions.`);
 }catch(err){
   console.error("question bank MySQL sync failed:",err.message);
 }

 await ensureIndex("players","idx_players_register","INDEX idx_players_register (register_number)");
 await ensureIndex("players","idx_players_phone","INDEX idx_players_phone (phone_number)");
 await ensureIndex("game_results","uq_game_room_player","UNIQUE KEY uq_game_room_player (room_code,player_id)");
 await ensureIndex("game_results","idx_game_played_at","INDEX idx_game_played_at (played_at)");
 await ensureIndex("payments","idx_payments_status","INDEX idx_payments_status (status)");
 await ensureIndex("payments","idx_payments_date","INDEX idx_payments_date (payment_date)");

 /* Bootstrap the requested host account if it doesn't exist yet.
    Password is never stored in plaintext; these are the scrypt values
    already used by the application. */
 await db.query(
   `INSERT INTO host_users(username,password_hash,password_salt)
    VALUES(?,?,?)
    ON DUPLICATE KEY UPDATE username=username`,
   [HOST_USERNAME,HOST_PASSWORD_HASH,HOST_PASSWORD_SALT]
 );

 await db.query(
   `INSERT INTO payment_users(username,password_hash,password_salt)
    VALUES(?,?,?)
    ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),password_salt=VALUES(password_salt)`,
   [PAYMENT_USERNAME,PAYMENT_PASSWORD_HASH,PAYMENT_PASSWORD_SALT]
 );

 console.log("GamesArena MySQL schema ready.");
}

async function questions(){
 const bank=JSON.parse(fs.readFileSync(path.join(__dirname,"questions.json"),"utf8"));
 return structuredClone(bank);
}

// Build a fresh 5-question game from the question bank.
// Questions progress from easy to hard and never repeat the same source fact
// within a game. Options are shuffled so the correct answer is not always
// in the same position.
const GAME_POINTS=[10,20,30,40,50,60,70,80,90,100];
const GAME_DIFFICULTY=[1,1,3,4,5,4,4,4,5,5];
const TOTAL_QUESTIONS=10;
const QUESTION_TIME_MS=30000;
const AUDIENCE_POLL_TIME_MS=60000;
const QUESTION_BANK_VERSION="GAMESARENA-KBC-10Q-TOUGH-PERFICIENT-v5";

function shuffleCopy(arr){
 const a=Array.isArray(arr)?arr.slice():[];
 for(let i=a.length-1;i>0;i--){
   const j=Math.floor(Math.random()*(i+1));
   [a[i],a[j]]=[a[j],a[i]];
 }
 return a;
}
function buildGameQuestions(bank,usedIds=new Set()){
  // KBC-style 10-question progression:
  // Q1-Q2 = easy warm-up, Q3-Q4 = tough, Q5 = Perficient,
  // Q6-Q8 = hard, Q9-Q10 = very hard/final.
  const used=new Set(usedIds||[]);
  const source=Array.isArray(bank)?bank:[];

  function pick(pool, mode="random"){
    const available=pool.filter(q=>q && q.id && !used.has(q.id));
    if(!available.length)return null;
    const candidates=mode==="hardest"
      ? available.slice().sort((a,b)=>Number(b.difficulty||1)-Number(a.difficulty||1))
      : shuffleCopy(available);
    const q=structuredClone(candidates[0]);
    used.add(q.id);
    return q;
  }

  const selected=[];
  const add=(q,displayDifficulty)=>{if(q){q._displayDifficulty=displayDifficulty;selected.push(q);}};

  // Q1: easy.
  add(
    pick(source.filter(q=>Number(q.difficulty)===1),"random")
    || pick(source.filter(q=>Number(q.difficulty)<=2),"random"),1
  );

  // Q2: easy.
  add(
    pick(source.filter(q=>Number(q.difficulty)===1),"random")
    || pick(source.filter(q=>Number(q.difficulty)<=2),"random"),1
  );

  // Q3-Q4: tough/harder.
  add(pick(source.filter(q=>Number(q.difficulty)>=3),"random"),3);
  add(
    pick(source.filter(q=>Number(q.difficulty)>=4),"random")
    || pick(source.filter(q=>Number(q.difficulty)>=3),"random"),4
  );

  // Q5 is always Perficient, as requested. Prefer the hardest Perficient item.
  add(
    pick(source.filter(q=>String(q.category||"").toLowerCase()==="perficient"),"hardest"),
    5
  );

  // Q6-Q8: hard questions.
  for(const level of [4,4,4]){
    add(
      pick(source.filter(q=>Number(q.difficulty)>=level),"random")
      || pick(source.filter(q=>Number(q.difficulty)>=3),"random"),
      4
    );
  }

  // Q9-Q10: very hard/final.
  add(
    pick(source.filter(q=>Number(q.difficulty)>=5),"hardest")
    || pick(source.filter(q=>Number(q.difficulty)>=4),"random"),
    5
  );
  add(
    pick(source.filter(q=>Number(q.difficulty)>=5),"hardest")
    || pick(source.filter(q=>Number(q.difficulty)>=4),"hardest"),
    5
  );

  // Safety fallback: fill missing slots while preserving the intended ordering.
  if(selected.length<TOTAL_QUESTIONS){
    const remaining=shuffleCopy(source.filter(q=>q && q.id && !used.has(q.id)));
    for(const candidate of remaining){
      if(selected.length>=TOTAL_QUESTIONS)break;
      const copy=structuredClone(candidate);
      const index=selected.length;
      copy._displayDifficulty=index<2?1:(index===4?5:(index>=8?5:4));
      used.add(copy.id);
      selected.push(copy);
    }
  }

  const game=selected.slice(0,TOTAL_QUESTIONS);
  game.forEach((q,index)=>{
    const original=Array.isArray(q.options)?q.options.slice():[];
    const correct=original[q.answer];
    q.options=shuffleCopy(original);
    q.answer=q.options.indexOf(correct);
    q.correctAnswer=q.answer;
    q.points=GAME_POINTS[index];
    q.prize=GAME_POINTS[index];
    q.difficulty=Number(q._displayDifficulty||1);
    q.difficultyLabel=
      q.difficulty===1?"Easy":
      q.difficulty===3?"Tough":
      q.difficulty===4?"Hard":
      "Very Hard — Final";
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

function makeRoom(){return{host:null,users:new Map(),questions:[],current:-1,phase:"lobby",pool:[],winner:null,completed:new Set(),played:new Set(),failed:new Set(),answers:new Map(),pendingAnswer:null,pendingPollRequest:null,poll:new Map(),lifelines:new Set(),fiftyFiftyRemoved:new Map(),timer:null,fastestSize:7,fastestStartAt:0,fastestDurationMs:15000,fastestSequence:[],fastestTimes:new Map(),fastestProgress:new Map(),fastestToken:"",fastestJoinUrl:"",fastestJoinQr:"",screenToken:"",screenUrl:"",screenQr:"",audiencePollUrl:"",audiencePollQr:"",pollActive:false,pollVotingOpen:false,winnerCelebrationUntil:0,contestantId:null,eliminatedContestant:null,ladder:[10,20,30,40,50],safeHavens:[40,80],contestantQuit:null,pendingQuit:null,usedQuestionIds:new Set(),questionTimerTimeout:null,questionTimerStartAt:0,questionTimerRemainingMs:QUESTION_TIME_MS,questionTimerPaused:false,pollTimerTimeout:null,pollTimerStartAt:0,pollTimerRemainingMs:AUDIENCE_POLL_TIME_MS,pollTimerRunning:false}}
function active(r){return [...r.users.values()].filter(u=>u.status==="active")}
function clearQuestionTimer(r){clearTimeout(r.questionTimerTimeout);r.questionTimerTimeout=null;}
function questionRemaining(r){if(r.phase!=="question")return 0;if(r.questionTimerPaused)return Math.max(0,Number(r.questionTimerRemainingMs||0));if(r.questionTimerStartAt)return Math.max(0,Number(r.questionTimerRemainingMs||QUESTION_TIME_MS)-(Date.now()-r.questionTimerStartAt));return Math.max(0,Number(r.questionTimerRemainingMs||QUESTION_TIME_MS));}
function pauseQuestionTimer(r){if(r.phase!=="question"||r.questionTimerPaused)return false;r.questionTimerRemainingMs=questionRemaining(r);r.questionTimerStartAt=0;r.questionTimerPaused=true;clearQuestionTimer(r);return true;}
function startQuestionTimer(r,remaining=QUESTION_TIME_MS){clearQuestionTimer(r);r.questionTimerRemainingMs=Math.max(0,Number(remaining||0));r.questionTimerPaused=false;r.questionTimerStartAt=Date.now();if(r.questionTimerRemainingMs<=0){questionTimeExpired(r);return;}r.questionTimerTimeout=setTimeout(()=>questionTimeExpired(r),r.questionTimerRemainingMs);}
function questionTimeExpired(r){if(r.phase!=="question"||r.current<0)return;r.questionTimerRemainingMs=0;r.questionTimerStartAt=0;r.questionTimerPaused=false;r.questionTimerTimeout=null;if(r.pendingAnswer){const code=[...rooms.entries()].find(([,room])=>room===r)?.[0];if(code)emitState(code);return;}const u=r.winner&&r.users.get(r.winner.id);if(!u)return;u.prizeWon=0;u.status="eliminated";upsertGameLog({roomCode:[...rooms.entries()].find(([,room])=>room===r)?.[0]||"",player:u,amountWon:0,resultStatus:"TIME_UP",safeQuit:false});r.eliminatedContestant={id:u.id,name:u.name,employeeCode:u.employeeCode,score:u.score,pointsEarned:0,prizeWon:0,eliminatedAt:Date.now(),reason:"TIME_UP",until:Date.now()+30000};const code=[...rooms.entries()].find(([,room])=>room===r)?.[0];if(code){io.to(code).emit("answerResult",{correct:false,eliminated:true,timeout:true,approved:true,contestant:{name:u.name,employeeCode:u.employeeCode},pointsEarned:0,prizeWon:0});io.to(u.id).emit("eliminationNotice",{name:u.name,employeeCode:u.employeeCode,score:u.score,pointsEarned:0,prizeWon:0,until:Date.now()+30000,reason:"TIME_UP"});nextContestant(code);}}
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
  question:q?{id:q.id,category:q.category,difficulty:q.difficulty,difficultyLabel:q.difficultyLabel||"",text:q.text,question:q.question||q.text,options:q.options,points:q.points,prize:q.prize??q.points,explanation:q.explanation||"",image:q.image||"",referenceImage:q.referenceImage||q.image||"",imageCredit:q.imageCredit||"",source:q.source||q.imageCredit||""}:null,
  users:[...r.users.values()].map(u=>({id:u.id,name:u.name,employeeCode:u.employeeCode,score:u.score,status:u.status,assuredMoney:Number(u.assuredMoney||0),prizeWon:Number(u.prizeWon||0)})),
  registered:r.users.size,active:active(r).length,contestantId:r.contestantId||null,
  pool:r.pool.map(u=>({id:u.id,name:u.name,employeeCode:u.employeeCode})),
  winner:r.winner?{name:r.winner.name,employeeCode:r.winner.employeeCode,time:r.winner.time}:null,contestant:r.winner?{id:r.winner.id,name:r.winner.name,employeeCode:r.winner.employeeCode}:null,contestantAssuredMoney:r.winner?Number(r.users.get(r.winner.id)?.assuredMoney||0):0,eliminatedContestant:r.eliminatedContestant||null,contestantQuit:r.contestantQuit||null,pendingQuit:r.pendingQuit||null,safeHavens:r.safeHavens||[40,80],currentAnswer:r.answers.size?[...r.answers.values()][0]:null,pendingAnswer:r.pendingAnswer||null,pendingPollRequest:r.pendingPollRequest||null,
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
     hostSocket.emit("hostQuestion", q?{text:q.text,question:q.question||q.text,options:q.options,answer:q.answer,correctAnswer:q.correctAnswer??q.answer,points:q.points,prize:q.prize??q.points,difficulty:q.difficulty,difficultyLabel:q.difficultyLabel||"",sourceFact:q.sourceFact,explanation:q.explanation||"",image:q.image||"",referenceImage:q.referenceImage||q.image||"",imageCredit:q.imageCredit||"",source:q.source||q.imageCredit||""}:null);
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
 if(!socketHasHostSession(s))return s.emit("hostAuthRequired");
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
  if(!socketHasHostSession(s)){if(typeof ack==="function")ack({ok:false,error:"Host login required."});return s.emit("hostAuthRequired");}
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
      audiencePollUrl:r.audiencePollUrl,audiencePollQr:r.audiencePollQr,
      paymentUrl:r.paymentUrl,paymentQr:r.paymentQr
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
    recordPlayerRegistration(code,u,0).catch(err=>console.error("player registration log failed:",err.message));
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
 if(r.pollTimerRunning){stopAudiencePoll(r,false);return;}
 if(!r.pollActive){
   r.poll.clear();
   pauseQuestionTimer(r);
   r.pollActive=true;
   r.pollVotingOpen=false;
   clearAudiencePollTimer(r);
 }
 emitState(s.data.room);
});
 s.on("host:startAudiencePollTimer",()=>{
   const r=rooms.get(s.data.room);
   if(!r||r.host!==s.id||r.phase!=="question"||!r.winner||!r.pollActive||r.pollTimerRunning)return;
   const connected=audienceConnectedCount(s.data.room);
   if(connected<1){
     emitState(s.data.room);
     return s.emit("errorMsg","Wait for at least one audience member to scan the QR before starting the 60-second poll.");
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
 // Create a history row for every registered participant in this room.
 // The eventual contestant row is then updated as the game progresses.
 const registeredNow=new Date();
 for(const participant of r.users.values()){
   await upsertGameLog({
     roomCode:s.data.room,
     player:participant,
     amountWon:Number(participant.prizeWon||0),
     resultStatus:"REGISTERED",
     safeQuit:false,
     playedAt:registeredNow
   });
 }
 // Mark the player as having participated as soon as the host starts the
 // quiz. This prevents the same player from appearing in any later
 // Fastest Finger selection, even if they are eliminated before the quiz is completed.
 r.played.add(r.winner.employeeCode);
 const contestantForLog=r.users.get(r.winner.id)||r.winner;
 await upsertGameLog({roomCode:s.data.room,player:contestantForLog,resultStatus:"IN_PROGRESS",playedAt:new Date()});
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

 s.on("host:approveAnswer",async()=>{
  const r=rooms.get(s.data.room);if(!r||r.host!==s.id||r.phase!=="question"||!r.pendingAnswer)return;
  const pending=r.pendingAnswer,u=r.users.get(pending.playerId),q=r.questions[r.current];
  if(!u)return;
  clearQuestionTimer(r);clearAudiencePollTimer(r);
  const ok=pending.choice===q.answer;
  r.answers.set(pending.playerId,{choice:pending.choice,ok,approved:true});
  r.pendingAnswer=null;
  io.to(s.data.room).emit("answerRevealed",{
    contestant:{name:u.name,employeeCode:u.employeeCode},
    choice:pending.choice,option:q.options[pending.choice],correct:ok,correctChoice:q.answer,correctAnswer:q.correctAnswer??q.answer,points:q.points,prize:q.prize??q.points,explanation:q.explanation||"",image:q.image||"",referenceImage:q.referenceImage||q.image||"",imageCredit:q.imageCredit||"",source:q.source||q.imageCredit||""
  });
  if(ok){
    u.score=q.points;
    u.status="active";
    if(r.current===3)u.assuredMoney=40;
    if(r.current===7)u.assuredMoney=80;
    u.prizeWon=Number(u.assuredMoney||0);
    await upsertGameLog({roomCode:s.data.room,player:u,amountWon:u.prizeWon,resultStatus:r.current===4?"WON":"CONTINUING",safeQuit:false});
    io.to(s.data.room).emit("answerResult",{correct:true,points:q.points,approved:true,assuredMoney:u.assuredMoney||0});
    emitState(s.data.room);
    // Manual progression: the Host must click NEXT QUESTION.
    // The revealed answer and explanation remain on the TV/participant screens
    // until the Host explicitly advances.
    clearTimeout(r.timer);
    r.timer=null;
    r.questionTimerRemainingMs=0;
    r.questionTimerStartAt=0;
    r.questionTimerPaused=true;
    emitState(s.data.room);
  }else{
    u.prizeWon=0;
    u.status="eliminated";
    await upsertGameLog({roomCode:s.data.room,player:u,amountWon:0,resultStatus:"WRONG_ANSWER",safeQuit:false});
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
  if(amount!==40&&amount!==80){
    s.emit("errorMsg","Safe Quit is available only after securing ₹40 or ₹80.");
    return;
  }
  r.pendingQuit={playerId:u.id,id:u.id,name:u.name,employeeCode:u.employeeCode,amount,requestedAt:Date.now()};
  io.to(s.data.room).emit("quitRequested",{contestant:{id:u.id,name:u.name,employeeCode:u.employeeCode},amount});
  io.to(u.id).emit("quitPending",{amount});
  emitState(s.data.room);
 });

 s.on("host:approveQuit",async()=>{
  const r=rooms.get(s.data.room);if(!r||r.host!==s.id||r.phase!=="question"||!r.pendingQuit)return;
  const pending=r.pendingQuit,u=r.users.get(pending.playerId);
  if(!u){r.pendingQuit=null;emitState(s.data.room);return;}
  const amount=Number(u.assuredMoney||0);
  if(amount!==40&&amount!==80){
    r.pendingQuit=null;
    io.to(u.id).emit("quitRejected",{reason:"The Safe Quit amount is no longer available."});
    emitState(s.data.room);return;
  }
  u.prizeWon=amount;u.status="quit";
  await upsertGameLog({roomCode:s.data.room,player:u,amountWon:amount,resultStatus:"SAFE_QUIT",safeQuit:true});
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
// Original GamesArena platformer. Phones are controllers; TV renders the shared world.
// Runner now uses the same QR/token-based room joining flow as Card Match.
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
function runnerRoom(){return{code:'',channel:'',host:null,hostToken:null,players:new Map(),phase:'lobby',startAt:0,timer:null,elapsed:0,coins:new Set(),winner:null,joinUrl:'',tvUrl:'',joinQr:'',tvQr:'',hostDisconnectTimer:null,cleanupTimer:null};}
function runnerSpawn(i){
 return {x:90,y:560-i*42,vx:0,vy:0,onGround:false,coins:0,finished:false,finishTime:null,inputX:0,jump:false};
}
function runnerState(r){
 return {
  code:r.code,phase:r.phase,elapsed:r.phase==='race'?Date.now()-r.startAt:r.elapsed,
  platforms:RUNNER_PLATFORMS,coins:RUNNER_COINS.map((c,i)=>({...c,taken:r.coins.has(i)})),finish:RUNNER_FINISH,
  winner:r.winner,joinUrl:r.joinUrl,tvUrl:r.tvUrl,joinQr:r.joinQr,tvQr:r.tvQr,
  hostOnline:!!r.host,
  players:[...r.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,x:p.x,y:p.y,vx:p.vx,vy:p.vy,coins:p.coins,finished:p.finished,finishTime:p.finishTime}))
 };
}
function runnerBroadcast(code){const r=runnerRooms.get(code);if(r)runnerNs.to(r.channel).emit('state',runnerState(r));}
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
 socket.on('tv',({room,token}={})=>{
   const code=String(room||'').trim().toUpperCase(),r=runnerRooms.get(code);
   socket.data.requestedRoom=code; socket.data.tv=true;
   if(!r){
     socket.emit('waitingForRoom',{room:code,message:'Waiting for the Host to create the game…'});
     return;
   }
   // Token is preferred (same pattern as Card Match). Manual room-code entry
   // remains supported so event staff can type the code on a TV.
   if(token && r.tvToken && token!==r.tvToken){
     socket.emit('errorMsg','This Runner TV link is no longer valid. Open the TV link from the Host screen.');
     return;
   }
   socket.join(r.channel);socket.data.room=code;socket.data.runnerRole='tv';
   socket.emit('joined',{room:code,tv:true});runnerBroadcast(code);
 });
 socket.on('create',async({name='Host'}={})=>{
   if(socket.data.room)return;
   const code=runnerCode(),r=runnerRoom();r.code=code;r.channel=`runner-${code}`;
   r.host=socket.id;r.hostToken=crypto.randomBytes(24).toString('hex');
   r.tvToken=crypto.randomBytes(24).toString('hex');
   const base=getPublicUrlForSocket(socket);
   r.joinUrl=`${base}/runner.html?join=${code}`;
   r.tvUrl=`${base}/runner-tv.html?room=${code}&token=${r.tvToken}`;
   r.joinQr=await QRCode.toDataURL(r.joinUrl,{margin:1,width:320});
   r.tvQr=await QRCode.toDataURL(r.tvUrl,{margin:1,width:320});
   const p={id:socket.id,token:crypto.randomBytes(24).toString('hex'),name:String(name).slice(0,18)||'Player',color:RUNNER_COLORS[0],...runnerSpawn(0)};
   r.hostPlayerToken=p.token;
   r.players.set(socket.id,p);runnerRooms.set(code,r);socket.join(r.channel);
   socket.data.room=code;socket.data.runnerRole='host';socket.data.runnerHostToken=r.hostToken;socket.data.runnerPlayerToken=p.token;
   socket.emit('joined',{room:code,host:true,playerId:p.id,playerToken:p.token,hostToken:r.hostToken,joinUrl:r.joinUrl,tvUrl:r.tvUrl,joinQr:r.joinQr,tvQr:r.tvQr});
   runnerBroadcast(code);
 });
 socket.on('join',({room,name='Player'}={})=>{
   const code=String(room||'').trim().toUpperCase(),r=runnerRooms.get(code);
   if(!r)return socket.emit('errorMsg','Room not found. Ask the Host to create a new Runner game.');
   if(r.players.size>=RUNNER_MAX)return socket.emit('errorMsg','Room is full — maximum 4 players.');
   if(r.phase!=='lobby')return socket.emit('errorMsg','Race already started. Ask the Host to create a new room.');
   const i=r.players.size,p={id:socket.id,token:crypto.randomBytes(24).toString('hex'),name:String(name).slice(0,18)||'Player',color:RUNNER_COLORS[i],...runnerSpawn(i)};
   r.players.set(socket.id,p);socket.join(r.channel);socket.data.room=code;socket.data.runnerRole='player';socket.data.runnerPlayerToken=p.token;
   socket.emit('joined',{room:code,host:false,playerId:p.id,playerToken:p.token,joinUrl:r.joinUrl,tvUrl:r.tvUrl});
   runnerBroadcast(code);
 });
 socket.on('resumePlayer',({room,playerToken,name}={})=>{
   const code=String(room||'').trim().toUpperCase(),r=runnerRooms.get(code);
   if(!r)return socket.emit('errorMsg','Room not found. Create a new Runner game and scan its QR again.');
   const p=[...r.players.values()].find(x=>x.token===String(playerToken||''));
   if(!p)return socket.emit('errorMsg','Player session expired. Please scan the Runner QR and join again.');
   const oldId=p.id;p.id=socket.id;if(r.players.has(oldId))r.players.delete(oldId);r.players.set(socket.id,p);
   if(name&&String(name).trim())p.name=String(name).trim().slice(0,18);
   socket.join(r.channel);socket.data.room=code;socket.data.runnerRole='player';socket.data.runnerPlayerToken=p.token;
   socket.emit('joined',{room:code,host:false,playerId:p.id,playerToken:p.token,resumed:true,joinUrl:r.joinUrl,tvUrl:r.tvUrl});
   socket.emit('state',runnerState(r));runnerBroadcast(code);
 });
 socket.on('resumeHost',({room,hostToken,name,playerToken}={})=>{
   const code=String(room||'').trim().toUpperCase(),r=runnerRooms.get(code);
   if(!r)return socket.emit('errorMsg','Room not found. Create a new Runner game.');
   if(String(hostToken||'')!==String(r.hostToken||''))return socket.emit('errorMsg','Host session expired. Create a new Runner game.');
   if(r.host && r.host!==socket.id)return socket.emit('errorMsg','This Runner room already has an active Host.');
   r.host=socket.id;
   if(r.hostDisconnectTimer)clearTimeout(r.hostDisconnectTimer);r.hostDisconnectTimer=null;
   const p=[...r.players.values()].find(x=>x.token===String(playerToken||r.hostPlayerToken||''));
   if(p){
     const oldId=p.id;p.id=socket.id;if(r.players.has(oldId))r.players.delete(oldId);r.players.set(socket.id,p);
     if(name&&String(name).trim())p.name=String(name).trim().slice(0,18);
   }else{
     const hp={id:socket.id,token:r.hostPlayerToken||crypto.randomBytes(24).toString('hex'),name:String(name||'Host').slice(0,18)||'Host',color:RUNNER_COLORS[0],...runnerSpawn(0)};
     r.hostPlayerToken=hp.token;r.players.set(socket.id,hp);
   }
   socket.join(r.channel);socket.data.room=code;socket.data.runnerRole='host';socket.data.runnerHostToken=r.hostToken;socket.data.runnerPlayerToken=r.hostPlayerToken;
   socket.emit('joined',{room:code,host:true,resumed:true,playerId:socket.id,playerToken:r.hostPlayerToken,hostToken:r.hostToken,joinUrl:r.joinUrl,tvUrl:r.tvUrl,joinQr:r.joinQr,tvQr:r.tvQr});
   socket.emit('state',runnerState(r));runnerBroadcast(code);
 });
 socket.on('start',()=>{
   const r=runnerRooms.get(socket.data.room);
   if(!r||r.host!==socket.id||r.players.size<2||r.phase!=='lobby')return;
   r.phase='race';r.startAt=Date.now();r._last=Date.now();r.coins=new Set();r.winner=null;
   for(const p of r.players.values()){p.finished=false;p.finishTime=null;p.coins=0;p.inputX=0;p.jump=false;}
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
   if(socket.data.runnerRole==='tv')return;
   if(r.host===socket.id){
     r.host=null;
     if(r.hostDisconnectTimer)clearTimeout(r.hostDisconnectTimer);
     r.hostDisconnectTimer=setTimeout(()=>{
       const x=runnerRooms.get(code);
       if(x && !x.host){
         runnerKeepAlive(x);
       }
     },90000);
   }
   runnerBroadcast(code);
 });
});


// Keep HTTP startup independent from optional MySQL initialization.
// Hostinger/nginx needs the process to bind to the assigned PORT immediately.
server.listen(PORT, "0.0.0.0", () => {
  console.log(`GamesArena listening on port ${PORT}`);
});

initDb()
  .then(() => console.log("GamesArena database initialization complete."))
  .catch(err => console.error("GamesArena database initialization failed; continuing without DB:", err.message));
