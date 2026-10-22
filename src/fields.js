// 业务载荷到展示字段的适配层；界面只渲染描述，不推测新的二进制布局。
const WatermarkFields = (() => {
  const transport = new Set(['detected','protocol','elapsedMs','width','height','engine','diagnostics',
    'crcStatus','minObservations','correctedBits','reason','fields','payloadHex','toolBuild']);
  const definitions = {
    userId: ['userId', 'identity'], loggedIn: ['登录状态', 'boolean'],
    gameId: ['游戏 ID', 'number'], timeStartUtc: ['时间区间开始', 'datetime'],
    timeEndUtc: ['时间区间结束', 'datetime'], protocolRevisionTimeUtc: ['协议修订时间', 'datetime']
  };
  function fromResult(decoded) {
    if (!decoded || decoded.detected !== true) return [];
    if (Array.isArray(decoded.fields)) {
      return decoded.fields.filter(field => field && typeof field.key === 'string').map(field => ({
        key: field.key, label: typeof field.label === 'string' ? field.label : field.key,
        type: typeof field.type === 'string' ? field.type : 'auto', value: field.value
      }));
    }
    return Object.entries(decoded).filter(([key]) => !transport.has(key)).map(([key, value]) => {
      const [fallback, type] = Object.hasOwn(definitions, key) ? definitions[key] : [key, 'auto'];
      const label = key === 'gameId' ? (decoded.protocol === 'GHCV7' ? '子游戏 ID' : '游戏 ID（旧版主游戏）') : fallback;
      return {key, label, type, value};
    });
  }
  function format(field) {
    if (field.value === null || field.value === undefined) return field.type === 'identity' ? '未登录' : '—';
    if (field.type === 'datetime' && typeof field.value === 'number' && Number.isFinite(field.value)) {
      const date = new Date(field.value * 1000);
      if (!Number.isNaN(date.getTime())) return `${date.toLocaleString('zh-CN', {hour12:false})}（本地时间）`;
    }
    if (typeof field.value === 'boolean') return field.value ? '是' : '否';
    if (typeof field.value === 'object') return JSON.stringify(field.value, null, 2);
    return String(field.value);
  }
  return {fromResult, format};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = WatermarkFields;
