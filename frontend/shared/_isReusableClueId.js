function _isReusableClueId(clueId){
  return /^f_.+_\d+$/.test(String(clueId==null?'':clueId));
}