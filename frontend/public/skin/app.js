/* 慧小招 首页参考稿 · 页面交互（经典脚本，defer；在 hero-video.js 之后执行）
   负责：内容显现、减少动态效果、首屏视频的自动循环与可见性。
   hero-video.js 沿用 AIZCCity 同步接口；加载或播放失败时保留原图。 */
(function () {
  'use strict';

  window.__aizcApp = true;
  var root = document.documentElement;
  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  var state = {
    reduced: !!(mqReduce && mqReduce.matches),
    inView: true,
    scene: null
  };

  /* ---------- 内容显现（只播一次） ---------- */
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  Array.prototype.forEach.call(document.querySelectorAll('.hero-copy .reveal'), function (el, i) {
    el.style.transitionDelay = (i * 90) + 'ms';
  });

  function revealAll() {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  }

  if (state.reduced || !('IntersectionObserver' in window)) {
    revealAll();
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    reveals.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ---------- 减少动态效果 ---------- */
  function applyReduced() {
    root.classList.toggle('reduce-motion', state.reduced);
    if (state.reduced) revealAll();
    if (state.scene) state.scene.setReducedMotion(state.reduced);
  }
  applyReduced();
  if (mqReduce) {
    var onReduceChange = function (e) { state.reduced = e.matches; applyReduced(); };
    if (mqReduce.addEventListener) mqReduce.addEventListener('change', onReduceChange);
    else if (mqReduce.addListener) mqReduce.addListener(onReduceChange);
  }

  /* ---------- 首屏视频挂载（hero-video.js 提供 window.AIZCCity） ---------- */
  var sceneEl = document.getElementById('heroScene');

  function syncVisible() {
    if (state.scene) state.scene.setVisible(state.inView && !document.hidden);
  }

  function mountScene() {
    if (!sceneEl) return;
    var api = window.AIZCCity;
    if (!api || typeof api.mount !== 'function' || (api.supported && !api.supported())) {
      sceneEl.setAttribute('data-state', 'fallback');
      return;
    }
    try {
      state.scene = api.mount(sceneEl, {
        reducedMotion: state.reduced,
        visible: state.inView && !document.hidden
      });
    } catch (err) {
      state.scene = null;
    }
    if (!state.scene) {
      sceneEl.setAttribute('data-state', 'fallback');
      return;
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        state.inView = entries[0].isIntersecting && entries[0].intersectionRatio > 0.01;
        syncVisible();
      }, { threshold: 0.01 }).observe(sceneEl);
    }
    document.addEventListener('visibilitychange', syncVisible);
    syncVisible();
    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (state.scene) state.scene.resize(); }, 150);
    });
  }
  mountScene();

})();
