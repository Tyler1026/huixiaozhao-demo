
window.onerror = function(msg, src, line, col, err) {
  if(document.getElementById('root') && !document.getElementById('root').innerHTML.trim()){
    document.getElementById('root').innerHTML =
      '<div style="padding:32px;font-family:monospace;color:#dc2626;background:#fff1f2;border:2px solid #fecaca;margin:24px;border-radius:12px">' +
      '<div style="font-size:16px;font-weight:700;margin-bottom:8px">⚠ JS 运行错误（白屏保护）</div>' +
      '<div style="font-size:13px">' + msg + '</div>' +
      '<div style="font-size:11px;color:#9ca3af;margin-top:6px">位置：' + src + ' 行' + line + ' 列' + col + '</div>' +
      '<button onclick="location.reload()" style="margin-top:12px;padding:8px 16px;background:#dc2626;color:#fff;border:none;border-radius:8px;cursor:pointer">刷新重试</button>' +
      '</div>';
  }
};
window.addEventListener('unhandledrejection', function(e) {
  if(window.onerror) window.onerror('Unhandled Promise: ' + e.reason, '', 0, 0, e.reason);
});
