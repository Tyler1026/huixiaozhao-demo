function _kbItemFp(t){
  return String(t==null?'':t).replace(/[\s\u3000]/g,'').replace(/^[\u2705\u26a0\ufe0f]+/,'').slice(0,80);
}