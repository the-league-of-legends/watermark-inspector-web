"""侧边明文取证辅助。只裁剪本地图片并核对读图记录，不执行OCR或查询日志。"""
from __future__ import annotations
import hashlib,io,json,math,re,time
from pathlib import Path

VERSION='visible-edge-text-v1'
MAX_PIXELS=12_000_000
MAX_BYTES=25*1024*1024

def digest(path):
 p=Path(path)
 if p.stat().st_size>MAX_BYTES:raise ValueError('取证文件超过25MB')
 value=hashlib.sha256()
 with p.open('rb') as f:
  for part in iter(lambda:f.read(1024*1024),b''):value.update(part)
 return value.hexdigest()
def token(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def _unique(pairs):
 d={}
 for k,v in pairs:
  if k in d:raise ValueError('分析配置包含重复键: '+k)
  d[k]=v
 return d

def load_profile(project=None,analysis=None):
 """只读取显式项目/分析文件；数字不能反向识别项目。"""
 roots=project if isinstance(project,(list,tuple)) else [project] if project else []
 files=[Path(analysis).expanduser()] if analysis else [Path(p).expanduser()/'watermark.analysis.json' for p in roots]
 profiles={}
 for file in files:
  if not file.is_file():continue
  if file.stat().st_size>128000:raise ValueError('明文分析配置超过128KB')
  data=json.loads(file.read_text(encoding='utf-8'),object_pairs_hook=_unique)
  raw=data.get('visibleIdentity')
  if not isinstance(raw,dict) or raw.get('enabled') is not True:continue
  if raw.get('profile')!=VERSION:raise ValueError('不支持的明文布局版本')
  key=data.get('projectKey');field=data.get('identityField')
  if not isinstance(key,str) or not key.strip() or not isinstance(field,str) or not field.strip():raise ValueError('明文布局缺少明确项目/身份字段')
  max_value=raw.get('maxValue','9223372036854775807');ratio=raw.get('sideWidthRatio',.08)
  if not isinstance(max_value,str) or not re.fullmatch(r'[1-9][0-9]{0,19}',max_value) or int(max_value)>0xffffffffffffffff:raise ValueError('明文账号范围无效')
  if type(ratio) not in (int,float) or not math.isfinite(ratio) or not .02<=ratio<=.15:raise ValueError('明文裁剪宽度无效')
  profile={'profile':VERSION,'projectKey':key,'identityField':field,'maxValue':max_value,
           'sideWidthRatio':ratio,'rotation':90,'unloggedValue':'0'}
  profiles[token(profile)]=profile
 if not profiles:raise ValueError('项目未声明侧边明文身份布局；不能把任意数字当作账号')
 if len(profiles)!=1:raise ValueError('多个明文项目/映射存在歧义，必须指定一个项目')
 return next(iter(profiles.values()))

def normalize_box(box):
 if box is None:return [0.,0.,1.,1.]
 if not isinstance(box,(list,tuple)) or len(box)!=4 or any(type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=1 for v in box) or box[2]<=box[0] or box[3]<=box[1]:raise ValueError('裁剪区域无效')
 return list(box)

def prepare(file,output,profile,box=None,seconds=5):
 """保留原图；每侧生成原像素/转正/放大/对比度副本与可追溯几何。"""
 from PIL import Image,ImageOps
 started=time.monotonic();path=Path(file).expanduser().resolve();out=Path(output).expanduser().resolve()
 if not path.is_file() or path.stat().st_size>MAX_BYTES:raise ValueError('图片不存在或超过25MB')
 raw=path.read_bytes()
 if len(raw)>MAX_BYTES:raise ValueError('图片超过25MB')
 sha=hashlib.sha256(raw).hexdigest();region=normalize_box(box)
 with Image.open(io.BytesIO(raw)) as source:
  if source.width*source.height>MAX_PIXELS:raise ValueError('图片超过1200万像素')
  image=ImageOps.exif_transpose(source).convert('RGB')
 width,height=image.size
 l,t,r,b=math.floor(width*region[0]),math.floor(height*region[1]),math.ceil(width*region[2]),math.ceil(height*region[3])
 if r-l<2 or b-t<2:raise ValueError('明文区域太小')
 crop_width=min((r-l)//2,max(1,math.ceil((r-l)*profile['sideWidthRatio'])))
 out.mkdir(parents=True,exist_ok=True,mode=0o700)
 crops=[]
 for side,rect in [('left',(l,t,l+crop_width,b)),('right',(r-crop_width,t,r,b))]:
  if time.monotonic()-started>seconds:raise TimeoutError('侧边裁剪超过工具剩余预算')
  cid='side-'+token([VERSION,sha,region,token(profile),side])[:24]
  original=image.crop(rect);upright=original.transpose(Image.Transpose.ROTATE_90)
  factor=min(3.,math.sqrt(4_000_000/(upright.width*upright.height)))
  enlarged=upright.resize((max(1,math.floor(upright.width*factor)),max(1,math.floor(upright.height*factor))),Image.Resampling.LANCZOS)
  variants={}
  for name,pixels in [('raw',original),('upright',upright),('enlarged',enlarged),('contrast',ImageOps.autocontrast(enlarged.convert('L'),cutoff=1))]:
   target=out/(cid+'-'+name+'.png')
   if target.is_symlink():raise ValueError('拒绝通过符号链接写入裁剪图')
   if time.monotonic()-started>seconds:raise TimeoutError("侧边裁剪超过工具剩余预算")
   pixels.save(target,compress_level=1);target.chmod(0o600)
   variants[name]={'path':str(target),'sha256':digest(target),'width':pixels.width,'height':pixels.height}
   if time.monotonic()-started>seconds:raise TimeoutError('侧边裁剪超过工具剩余预算')
  crops.append({'crop_id':cid,'side':side,'pixelBox':list(rect),'sourceBox':[rect[0]/width,rect[1]/height,rect[2]/width,rect[3]/height],
                'rotation':90,'scale':factor,'variants':variants})
 return {'status':'prepared','version':VERSION,'extractionMethod':'visible_edge_text','reader':'ai_visual','profile':profile,'profileHash':token(profile),
         'source':{'type':'image','file':str(path),'sha256':sha,'region':region,'width':width,'height':height},'crops':crops,
         'elapsedMs':round((time.monotonic()-started)*1000),'warning':'仅准备侧边图，尚未识别。请当前AI会话分别读两侧，检查完整清晰及明显截断；不是BCH/CRC校验。'}

def assess(prepared,readings,verify=True):
 """核对来源/声明/一致性，不声称校验AI读到的像素内容。"""
 if not isinstance(prepared,dict) or prepared.get('status')!='prepared' or prepared.get('version')!=VERSION:raise ValueError('明文准备记录无效')
 profile=prepared['profile'];source=prepared['source'];known={c['crop_id']:c for c in prepared['crops']}
 if prepared.get('profileHash')!=token(profile):raise ValueError('明文配置指纹不匹配')
 if not isinstance(readings,list) or len(readings)>2:raise ValueError('每个区域最多提供左右两条独立读数')
 if verify:
  if digest(source['file'])!=source['sha256']:raise ValueError('明文原图已变化')
  for c in prepared['crops']:
   expected='side-'+token([VERSION,source['sha256'],source['region'],token(profile),c['side']])[:24]
   if c['crop_id']!=expected:raise ValueError('侧边引用与原图不匹配')
   for variant in c['variants'].values():
    if digest(variant['path'])!=variant['sha256']:raise ValueError('侧边裁剪图已变化')
 seen=set();accepted=[];observations=[]
 for item in readings:
  if not isinstance(item,dict) or item.get('crop_id') not in known or item['crop_id'] in seen:raise ValueError('明文裁剪引用无效或重复')
  seen.add(item['crop_id']);reason=item.get('reason','');text=item.get('text','')
  if not isinstance(text,str) or len(text)>80 or not isinstance(reason,str) or not reason.strip() or len(reason)>1000:raise ValueError('明文读数/判断依据无效')
  match=re.fullmatch(r'(?:UID\s*[:：]\s*)?(0|[1-9][0-9]*)',text.strip(),re.I)
  good=item.get('complete') is True and item.get('clear') is True and bool(match)
  uid=match.group(1) if match else None
  if uid and (len(uid)>len(profile['maxValue']) or int(uid)>int(profile['maxValue'])):good=False
  observation={'crop_id':item['crop_id'],'side':known[item['crop_id']]['side'],'text':text,
               'complete':item.get('complete') is True,'clear':item.get('clear') is True,'reason':reason,'accepted':bool(good)}
  observations.append(observation)
  if good:accepted.append(uid)
 status='uncertain';uid=None;confidence=None
 if len(set(accepted))>1:status='conflict'
 elif accepted:
  uid=accepted[0]
  if int(uid)==0:status='unlogged';uid=None
  else:status='candidate';confidence='dual_agree' if len(accepted)==2 else 'single_clear'
 return {'status':status,'userId':uid,'confidence':confidence,'extractionMethod':'visible_edge_text','reader':'ai_visual',
         'projectKey':profile['projectKey'],'identityField':profile['identityField'],'source':source,'observations':observations,
         'validation':{'bch':'not_applicable','crc':'not_applicable','authenticated':False},
         'warning':'AI读图的视觉置信，不是工具对文字内容的独立校验。'}
