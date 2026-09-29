function _clueNameKey(name){
  if(name==null) return '';
  return String(name).replace(/[\uff08(][^\uff09)]*[\uff09)]\s*$/,'').replace(/\s+/g,'').trim();
}