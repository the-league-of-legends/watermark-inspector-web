// 仅区分解码元信息与业务载荷，不按项目字段名翻译、转时间或解释值。
const WatermarkFields = (() => {
  const transport = new Set(['detected','protocol','elapsedMs','width','height','engine','diagnostics',
    'crcStatus','minObservations','correctedBits','reason','fields','payloadHex','toolBuild','regionLayout']);
  function fromResult(decoded) {
    if (!decoded || decoded.detected !== true) return [];
    if(decoded.protocol==='GHCV8')return decoded.status==='decoded' ? Object.entries(decoded.payload).map(([key,value])=>({key,label:key,type:typeof value,value})) : [];
    const entries = Array.isArray(decoded.fields)
      ? decoded.fields.filter(field => field && typeof field.key === 'string').map(field => [field.key,field.value])
      : Object.entries(decoded).filter(([key]) => !transport.has(key));
    return entries.map(([key,value]) => ({key,label:key,type:value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,value}));
  }
  function toPayload(fields) {
    // fromEntries 安全保留 __proto__ 等原始字段名，不通过原型赋值。
    return Object.fromEntries(fields.map(field => [field.key,field.value]));
  }
  function format(field) {
    const value=JSON.stringify(field.value,null,2);
    return value === undefined ? 'undefined' : value;
  }
  return {fromResult,toPayload,format};
})();
if(typeof module !== 'undefined' && module.exports) module.exports=WatermarkFields;
