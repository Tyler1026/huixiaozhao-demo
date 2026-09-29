
function _clueTombKey(projKey, clue){
  var nm=(clue&&typeof clue==='object')?clue.name:clue;
  var nk=_clueNameKey(nm);
  if(nk) return String(projKey)+'::@'+nk;
  var id=(clue&&typeof clue==='object')?clue.id:clue;
  return String(projKey)+'::'+String(id);
}
