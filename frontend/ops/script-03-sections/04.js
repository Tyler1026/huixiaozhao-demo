/* ===== 动态效果样式（注入一次） ===== */
(function(){
  var css='@keyframes rrPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(1.35)}}'+
  '@keyframes rrShimmer{0%{background-position:-200px 0}100%{background-position:200px 0}}'+
  '@keyframes rrStripe{0%{background-position:0 0}100%{background-position:28px 0}}'+
  '@keyframes rrSpin{to{transform:rotate(360deg)}}'+
  '@keyframes rrBlink{0%,100%{opacity:1}50%{opacity:.25}}'+
  '@keyframes rrChipIn{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}'+
  '.rr-dot-live{animation:rrPulse 1.6s ease-in-out infinite}'+
  '.rr-bar-live{background-image:linear-gradient(90deg,#0757ad,#007f82),linear-gradient(45deg,rgba(255,255,255,.22) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.22) 50%,rgba(255,255,255,.22) 75%,transparent 75%,transparent)!important;background-size:100% 100%,28px 28px;background-blend-mode:overlay;animation:rrStripe 1s linear infinite}'+
  '.rr-spin{display:inline-block;width:10px;height:10px;border:2px solid rgba(1,53,130,.25);border-top-color:#013582;border-radius:50%;margin-right:5px;vertical-align:-1px;animation:rrSpin .9s linear infinite}'+
  '.rr-wave-run b{position:relative}'+
  '.rr-wave-run .rr-runner{display:inline-block;width:7px;height:7px;border-radius:50%;background:#0757ad;margin-left:6px;animation:rrBlink 1.1s ease-in-out infinite}'+
  '.rr-chip-new{animation:rrChipIn .5s ease}'+
  '.rr-step-glow{animation:rrBlink 2.4s ease-in-out infinite}';
  var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
})();
