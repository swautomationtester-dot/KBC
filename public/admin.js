const $=id=>document.getElementById(id);

async function api(url,opts={}){
 const r=await fetch(url,{credentials:"same-origin",...opts});
 let x={};try{x=await r.json()}catch{}
 if(!r.ok)throw new Error(x.error||"Request failed");
 return x;
}
async function checkSession(){
 try{
  const x=await api("/api/admin/me");
  if(x.ok)showAdmin();
 }catch{}
}
function showAdmin(){
 $("login").classList.add("hidden");
 $("admin").classList.remove("hidden");
 load();
}
async function login(){
 $("loginError").textContent="";
 try{
  await api("/api/admin/login",{
   method:"POST",
   headers:{"Content-Type":"application/json"},
   body:JSON.stringify({username:$("username").value.trim(),password:$("pass").value})
  });
  showAdmin();
 }catch(e){$("loginError").textContent=e.message}
}
async function logout(){
 await api("/api/admin/logout",{method:"POST"});
 $("admin").classList.add("hidden");
 $("login").classList.remove("hidden");
 $("pass").value="";
}
async function load(){
 try{
  const q=await api("/api/questions");
  $("list").innerHTML=q.map((x,i)=>`<div class=row><span>${i+1}. ${x.text}</span><b>${x.points}</b></div>`).join("");
 }catch(e){alert(e.message);$("admin").classList.add("hidden");$("login").classList.remove("hidden")}
}
async function add(){
 const body={text:$("qt").value.trim(),options:[$("a").value.trim(),$("b").value.trim(),$("c").value.trim(),$("d").value.trim()],answer:+$("ans").value,points:+$("pts").value};
 try{
  await api("/api/questions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  ["qt","a","b","c","d"].forEach(id=>$(id).value="");
  $("pts").value=100;
  load();
 }catch(e){alert(e.message)}
}
$("loginBtn").addEventListener("click",login);
$("logout").addEventListener("click",logout);
$("addBtn").addEventListener("click",add);
$("pass").addEventListener("keydown",e=>{if(e.key==="Enter")login()});
checkSession();