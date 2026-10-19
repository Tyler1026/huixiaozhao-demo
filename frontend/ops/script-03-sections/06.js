/* ===== 渲染骨架：用雷总真实DOM结构 ===== */
var $=function(s){return document.querySelector(s)};
function toast(t){var e=$('#toast');$('#toastMsg').textContent=t;if(typeof opsDecorateBrand==='function')opsDecorateBrand(e);e.classList.add('show');setTimeout(function(){e.classList.remove('show')},2200)}
