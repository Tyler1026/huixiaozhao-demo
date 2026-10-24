/* 慧小招 · 首屏本地视频。保留 AIZCCity 接口，供全页动效开关统一控制。 */
(function () {
  'use strict';

  function mount(container, options) {
    var video = container.querySelector('.scene-video');
    if (!video) return null;
    var o = options || {};
    var st = {
      paused: !!o.paused,
      reduced: !!o.reducedMotion,
      visible: o.visible !== false,
      frame: false,
      failed: false,
      blocked: false,
      pending: false,
      destroyed: false
    };
    var request = 0;

    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;

    function wantsPlayback() {
      return !st.destroyed && !st.paused && !st.reduced && st.visible && !st.failed && !st.blocked;
    }

    function updateState() {
      var next = 'loading';
      if (st.destroyed || st.failed || st.blocked) next = 'fallback';
      else if (st.reduced) next = 'still';
      else if (st.frame) {
        if (st.paused) next = 'paused';
        else if (!st.visible) next = 'hidden';
        else if (!video.paused) next = 'running';
      }
      container.setAttribute('data-state', next);
    }

    function sync() {
      if (!wantsPlayback()) {
        request += 1;
        st.pending = false;
        video.autoplay = false;
        video.pause();
        updateState();
        return;
      }
      video.autoplay = true;
      if (!video.getAttribute('src')) video.src = video.getAttribute('data-src');
      if (st.pending || !video.paused) { updateState(); return; }
      var current = ++request;
      st.pending = true;
      var playing;
      try { playing = video.play(); }
      catch (err) { onRejected(); return; }
      if (playing && typeof playing.then === 'function') {
        playing.then(function () {
          if (current !== request || st.destroyed) return;
          st.pending = false;
          updateState();
        }, onRejected);
      } else {
        st.pending = false;
      }

      function onRejected() {
        if (current !== request || st.destroyed) return;
        st.pending = false;
        st.blocked = true;
        video.autoplay = false;
        video.pause();
        updateState();
      }
    }

    function onPlaying() {
      if (!wantsPlayback()) { sync(); return; }
      st.frame = true;
      st.pending = false;
      updateState();
    }

    function onError() {
      st.failed = true;
      sync();
    }

    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    sync();

    return {
      play: function () { st.paused = false; st.blocked = false; sync(); },
      pause: function () { st.paused = true; sync(); },
      setVisible: function (visible) { st.visible = !!visible; sync(); },
      setReducedMotion: function (reduced) { st.reduced = !!reduced; sync(); },
      resize: function () {},
      getState: function () { return container.getAttribute('data-state'); },
      destroy: function () {
        st.destroyed = true;
        sync();
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('error', onError);
        video.removeAttribute('src');
        video.load();
      }
    };
  }

  window.AIZCCity = {
    version: 'video-1.0.0',
    supported: function () { return typeof document.createElement('video').play === 'function'; },
    mount: mount
  };
})();
