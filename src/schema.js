// GHCV8 规则仅描述数据；不执行规则中的脚本，不访问网络。
const WatermarkSchema = (() => {
  const CAPACITY=119, HEADER=68;
  function keys(value,allowed) {
    if(!value || typeof value!=='object' || Array.isArray(value)) throw Error('Expected an object');
    for(const key of Object.keys(value))if(!allowed.includes(key))throw Error('Unknown schema property: '+key);
  }
  function integer(n,min,max,name) {if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid '+name);return n;}
  function canonical(v) {
    if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
    if(v && typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
    return JSON.stringify(v);
  }
  // 同步、零依赖 SHA-256；只用于规则匹配，不能作为身份验签。
  function sha256(text) {
    const input=new TextEncoder().encode(text),size=Math.ceil((input.length+9)/64)*64,data=new Uint8Array(size);data.set(input);data[input.length]=128;
    const view=new DataView(data.buffer);view.setUint32(size-4,input.length*8,false);
    const primes=[],initial=[],constants=[];
    for(let n=2;primes.length<64;n++){if(primes.every(p=>n%p)){primes.push(n);if(initial.length<8)initial.push((Math.sqrt(n)%1*2**32)>>>0);constants.push((Math.cbrt(n)%1*2**32)>>>0);}}
    const h=initial.slice(),w=new Uint32Array(64),ror=(v,n)=>(v>>>n)|(v<<(32-n));
    for(let offset=0;offset<size;offset+=64){
      for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4,false);
      for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(ror(a,7)^ror(a,18)^(a>>>3))+w[i-7]+(ror(b,17)^ror(b,19)^(b>>>10)))>>>0;}
      let [a,b,c,d,e,f,g,z]=h;
      for(let i=0;i<64;i++){const t1=(z+(ror(e,6)^ror(e,11)^ror(e,25))+((e&f)^(~e&g))+constants[i]+w[i])>>>0,t2=((ror(a,2)^ror(a,13)^ror(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
      for(const [i,v] of [a,b,c,d,e,f,g,z].entries())h[i]=(h[i]+v)>>>0;
    }
    return h.map(v=>v.toString(16).padStart(8,'0')).join('');
  }
  function asBig(v) {
    if(typeof v==='number' && !Number.isSafeInteger(v))throw Error('Integer precision lost; use decimal string');
    if(!['number','string','bigint'].includes(typeof v)||! /^-?(0|[1-9]\d*)$/.test(String(v)))throw Error('Invalid integer');
    return BigInt(v);
  }
  function compile(rule) {
    keys(rule,['projectKey','schemaVersion','fields']);
    if(typeof rule.projectKey!=='string'||! /^[a-z0-9][a-z0-9._-]{0,63}$/.test(rule.projectKey))throw Error('Invalid projectKey');
    integer(rule.schemaVersion,1,65535,'schemaVersion');
    if(!Array.isArray(rule.fields)||!rule.fields.length||rule.fields.length>119)throw Error('Invalid fields');
    let used=0;const seen=new Set(),fields=rule.fields.map(field=>{
      keys(field,['key','type','bits','min','max','values','epoch','stepSeconds','maxBytes','encoding']);
      if(typeof field.key!=='string'||!field.key.length||field.key.length>128||/[\u0000-\u001f\ud800-\udfff]/.test(field.key)||seen.has(field.key))throw Error('Invalid or duplicate key');
      seen.add(field.key);const f={key:field.key,type:field.type};
      if(['uint','int','time','enum'].includes(f.type))f.bits=integer(field.bits,1,64,'bits');
      else if(f.type==='bool'){if(field.bits!==undefined&&field.bits!==1)throw Error('Boolean uses one bit');f.bits=1;}
      else if(['string','bytes'].includes(f.type)){
        f.maxBytes=integer(field.maxBytes,1,14,'maxBytes');f.encoding=f.type==='string'?'utf-8':'hex';
        if(field.encoding!==undefined&&field.encoding!==f.encoding)throw Error('Unsupported encoding');
        f.lengthBits=Math.ceil(Math.log2(f.maxBytes+1));f.bits=f.lengthBits+f.maxBytes*8;
        if(field.bits!==undefined&&field.bits!==f.bits)throw Error('String bits do not match maxBytes');
      } else throw Error('Unsupported field type');
      if(['uint','int'].includes(f.type)){
        const min=f.type==='int'?-(1n<<BigInt(f.bits-1)):0n,max=f.type==='int'?(1n<<BigInt(f.bits-1))-1n:(1n<<BigInt(f.bits))-1n;
        f.min=String(field.min===undefined?min:asBig(field.min));f.max=String(field.max===undefined?max:asBig(field.max));
        if(asBig(f.min)<min||asBig(f.max)>max||asBig(f.min)>asBig(f.max))throw Error('Invalid integer range');
      }
      if(f.type==='time'){f.epoch=integer(field.epoch,0,Number.MAX_SAFE_INTEGER,'epoch');f.stepSeconds=integer(field.stepSeconds,1,86400,'stepSeconds');if(f.bits>32||!Number.isSafeInteger(f.epoch+(2**f.bits-1)*f.stepSeconds))throw Error('Time range too large');}
      if(f.type==='enum'){if(!Array.isArray(field.values)||!field.values.length||field.values.length>2**Math.min(f.bits,20)||field.values.some(v=>typeof v!=='string'||v.length>128)||new Set(field.values).size!==field.values.length)throw Error('Invalid enum');f.values=field.values.slice();}
      const allowed={uint:['key','type','bits','min','max'],int:['key','type','bits','min','max'],bool:['key','type','bits'],time:['key','type','bits','epoch','stepSeconds'],enum:['key','type','bits','values'],string:['key','type','bits','maxBytes','encoding'],bytes:['key','type','bits','maxBytes','encoding']}[f.type];keys(field,allowed);
      used+=f.bits;return f;
    });
    if(used>CAPACITY)throw Error('Schema exceeds 119 business bits: '+used);
    const normalized={projectKey:rule.projectKey,schemaVersion:rule.schemaVersion,fields:fields.map(({lengthBits,...f})=>f)};
    const text=canonical(normalized),hash=sha256(text);
    return {rule:normalized,fields,canonical:text,sha256:hash,fingerprint:hash.slice(0,16),usedBits:used};
  }
  function registry(rules) {
    if(!Array.isArray(rules)||rules.length>64)throw Error('At most 64 rules');
    const found=new Map(),versions=new Map();
    for(const rule of rules){const c=compile(rule),old=found.get(c.fingerprint);if(old&&old.canonical!==c.canonical)throw Error('Schema fingerprint collision');const versionKey=c.rule.projectKey+':'+c.rule.schemaVersion;if(versions.has(versionKey)&&versions.get(versionKey)!==c.fingerprint)throw Error('Same project/version has conflicting definitions');versions.set(versionKey,c.fingerprint);found.set(c.fingerprint,c);}
    return [...found.values()];
  }
  function crc(bits) {let c=0xb704ce;for(const bit of bits){const top=(c>>>23)^bit;c=(c<<1)&0xffffff;if(top)c^=0x864cfb;}return c;}
  function unpack(bytes,n) {return Uint8Array.from({length:n},(_,i)=>(bytes[i>>3]>>(i&7))&1);}
  function pack(bits) {const b=new Uint8Array(Math.ceil(bits.length/8));bits.forEach((v,i)=>{if(v)b[i>>3]|=1<<(i&7)});return b;}
  const hex=bytes=>Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
  function encode(rule,values) {
    const c=compile(rule),bits=new Uint8Array(211);keys(values,c.rule.fields.map(f=>f.key));let pos=0;
    const put=(value,n)=>{for(let i=0;i<n;i++)bits[pos++]=Number((value>>BigInt(i))&1n)};
    put(8n,4);put(BigInt('0x'+c.fingerprint),64);
    for(const f of c.fields){if(!Object.hasOwn(values,f.key))throw Error('Missing field: '+f.key);const v=values[f.key];let n;
      if(f.type==='uint'||f.type==='int'){n=asBig(v);if(n<asBig(f.min)||n>asBig(f.max))throw Error('Field out of range: '+f.key);if(n<0)n+=1n<<BigInt(f.bits);}
      else if(f.type==='bool'){if(typeof v!=='boolean')throw Error('Expected boolean');n=v?1n:0n;}
      else if(f.type==='enum'){const index=f.values.indexOf(v);if(index<0)throw Error('Unknown enum value');n=BigInt(index);}
      else if(f.type==='time'){integer(v,f.epoch,Number.MAX_SAFE_INTEGER,'time');if((v-f.epoch)%f.stepSeconds)throw Error('Time is not aligned');n=BigInt((v-f.epoch)/f.stepSeconds);if(n>=1n<<BigInt(f.bits))throw Error('Time out of range');}
      else {if(typeof v!=='string')throw Error('Expected string');if(f.type==='string'&&new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(new TextEncoder().encode(v))!==v)throw Error('Invalid Unicode');if(f.type==='bytes'&&! /^(?:[a-fA-F0-9]{2})*$/.test(v))throw Error('Expected hex bytes');
        const bytes=f.type==='string'?new TextEncoder().encode(v):Uint8Array.from(v.match(/../g)||[],h=>parseInt(h,16));if(bytes.length>f.maxBytes)throw Error('String exceeds maxBytes');put(BigInt(bytes.length),f.lengthBits);for(let i=0;i<f.maxBytes;i++)put(BigInt(bytes[i]||0),8);continue;}
      put(n,f.bits);
    }
    pos=187;put(BigInt(crc(bits.slice(0,187))),24);return pack(bits);
  }
  function readEnvelope(bytes) {
    if(bytes.length!==27 || bytes[26]&0xf8)return null;const bits=unpack(bytes,211);let pos=0;
    const read=n=>{let v=0n;for(let i=0;i<n;i++)v|=BigInt(bits[pos++])<<BigInt(i);return v};
    if(read(4)!==8n)return null;const fingerprint=read(64).toString(16).padStart(16,'0');pos=187;if(Number(read(24))!==crc(bits.slice(0,187)))return null;
    return {protocol:'GHCV8',schemaFingerprint:fingerprint,rawDataHex:hex(pack(bits.slice(HEADER,187))),payloadHex:hex(bytes)};
  }
  function resolve(result,compiled=[]) {
    if(!result?.detected || result.protocol!=='GHCV8')return result;
    const matches=compiled.filter(c=>c.fingerprint===result.schemaFingerprint);
    if(matches.length!==1)return {...result,status:'unknown_schema',payload:null};
    const c=matches[0],bits=unpack(Uint8Array.from(result.rawDataHex.match(/../g)||[],v=>parseInt(v,16)),119);let pos=0;
    const read=n=>{let v=0n;for(let i=0;i<n;i++)v|=BigInt(bits[pos++])<<BigInt(i);return v};const entries=[];
    try {for(const f of c.fields){let v;
      if(f.type==='string'||f.type==='bytes'){const count=Number(read(f.lengthBits)),bytes=Uint8Array.from({length:f.maxBytes},()=>Number(read(8)));if(count>f.maxBytes||bytes.slice(count).some(v=>v))throw Error('Invalid string length/padding');v=f.type==='string'?new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.slice(0,count)):hex(bytes.slice(0,count));}
      else {let n=read(f.bits);if(f.type==='int'&&n&(1n<<BigInt(f.bits-1)))n-=1n<<BigInt(f.bits);
        if(f.type==='time')v=f.epoch+Number(n)*f.stepSeconds;
        else if(f.type==='bool')v=!!n;
        else if(f.type==='enum'){v=f.values[Number(n)];if(v===undefined)throw Error('Invalid enum');}
        else {if(n<asBig(f.min)||n>asBig(f.max))throw Error('Integer out of range');v=f.bits>53?String(n):Number(n);}}
      entries.push([f.key,v]);}
      if(bits.slice(pos).some(v=>v))throw Error('Non-zero padding');
      return {...result,status:'decoded',schema:{projectKey:c.rule.projectKey,version:c.rule.schemaVersion,fingerprint:c.fingerprint},payload:Object.fromEntries(entries)};
    } catch {return {...result,status:'invalid_payload',payload:null};}
  }
  return {compile,registry,encode,readEnvelope,resolve,canonical,sha256,CAPACITY};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=WatermarkSchema;
