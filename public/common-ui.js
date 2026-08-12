
(function(){
  const path=location.pathname;
  if(path==="/" || path==="/index.html") return;
  function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
  function pageLabel(){
    const map={
      "/host.html":"HOST CONSOLE","/join.html":"PARTICIPANT","/registered.html":"REGISTRATION",
      "/tv.html":"QUIZ TV","/audience.html":"AUDIENCE","/admin.html":"ADMIN PORTAL",
      "/payment.html":"ENTRY PAYMENT","/payment-inventory.html":"PAYMENT INVENTORY",
      "/card-match.html":"CARD MATCH","/runner.html":"RUNNER","/runner-tv.html":"RUNNER TV",
      "/kart.html":"MINI KART","/kart-tv.html":"KART TV","/color-war.html":"COLOR WAR",
      "/color-war-tv.html":"COLOR WAR TV"
    };
    return map[path]||"GAMESARENA";
  }
  function init(){
    document.body.classList.add("gaCommonPage");
    // Remove legacy common header; page-specific controls remain untouched.
    document.querySelectorAll("body>header.sitebar").forEach(h=>h.remove());
    if(!document.querySelector(".gaCommonHeader")){
      const header=document.createElement("header");
      header.className="gaCommonHeader";
      header.innerHTML=`<a class="gaCommonBrand" href="/" aria-label="GamesArena home">
        <img src="/assets/gamesarena-logo-premium.png" alt="GamesArena">
        <span class="gaCommonBrandText">GamesArena<small>PLAY • THINK • WIN</small></span>
      </a>
      <nav class="gaCommonNav" aria-label="Main navigation">
        <span class="gaCommonLive"><i></i> LIVE PLATFORM</span>
        <a href="/">Home</a><a href="/host.html">Host</a>
        <a href="/payment-inventory.html">Payments</a>
      </nav>`;
      document.body.insertBefore(header,document.body.firstChild);
    }
    if(!document.querySelector(".gaCommonFooter")){
      const footer=document.createElement("footer");
      footer.className="gaCommonFooter";
      footer.innerHTML=`<strong>GamesArena</strong><span>Play • Think • Win • Live</span>
        <div class="gaCommonFooterLinks"><a href="/">Home</a><a href="/host.html">Host Console</a><a href="/payment-inventory.html">Payment Inventory</a></div>
        <span>© ${new Date().getFullYear()} GamesArena</span>`;
      document.body.appendChild(footer);
    }
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
})();
