#!/usr/bin/env python3
"""独立水印解码：项目规则是本地数据，不执行规则、不查询日志。"""
from __future__ import annotations
import argparse, hashlib, io, json, shutil, struct, subprocess, sys, time
from pathlib import Path

HERE=Path(__file__).resolve().parent
MAX_PIXELS=12_000_000

def project_root(project=None):
    if project: return Path(project).expanduser().resolve()
    if not shutil.which('git'): return None
    p=subprocess.run(['git','rev-parse','--show-toplevel'],capture_output=True,text=True,timeout=3)
    return Path(p.stdout.strip()) if p.returncode==0 else None

def load_rules(rules=None,project=None):
    files=[Path(p).expanduser().resolve() for p in (rules or [])]
    root=None
    if not files:
        root=project_root(project)
        if root:
            current=root/'watermark.schema.json'
            if current.is_file():files.append(current)
            history=root/'watermark.schemas'
            if history.is_dir(): files.extend(sorted(p for p in history.glob('*.json') if not p.is_symlink()))
    if len(files)>64:raise ValueError('最多载入64份规则')
    if sum(p.stat().st_size for p in files)>800_000:raise ValueError('规则文件总大小超限')
    result=[]
    def unique(pairs):
        d={}
        for key,value in pairs:
            if key in d:raise ValueError('规则含重复键: '+key)
            d[key]=value
        return d
    for p in files:
        if not p.is_file() or p.stat().st_size>128_000:raise ValueError('规则文件无效或过大')
        result.append(json.loads(p.read_text(encoding='utf-8'),object_pairs_hook=unique))
    return result

def decode_pixels(rgba,width,height,rules,seconds=5,full_search=True):
    node=shutil.which('node')
    if not node:return {'detected':False,'reason':'node_unavailable'}
    if width<=0 or height<=0 or width*height>MAX_PIXELS or len(rgba)!=width*height*4:return {'detected':False,'reason':'invalid_image'}
    head=json.dumps({'rules':rules,'width':width,'height':height,'timeoutMs':max(1,int(seconds*1000)),'fullSearch':full_search},ensure_ascii=False).encode()
    if len(head)>1024*1024:return {'detected':False,'reason':'invalid_rules_or_input'}
    try:
        p=subprocess.run([node,str(HERE/'decode.cjs')],input=struct.pack('<I',len(head))+head+rgba,capture_output=True,timeout=max(.001,seconds))
        result=json.loads(p.stdout)
        if not isinstance(result,dict):raise ValueError('Invalid decoder output')
        return result
    except subprocess.TimeoutExpired:return {'detected':False,'reason':'decode_timeout'}
    except (OSError,ValueError):return {'detected':False,'reason':'decoder_error'}

def decode_file(file,rules=None,project=None,seconds=5,box=None):
    started=time.monotonic()
    try:
        raw_rules=load_rules(rules,project)
    except (ValueError,OSError,subprocess.SubprocessError) as exc:return {'status':'invalid_schema','warning':str(exc)[:300],'nonBlocking':True}
    try:
        from PIL import Image, ImageOps
    except ImportError:return {'status':'dependency_error','warning':'缺少Pillow；请运行安装脚本或在自己的Python环境安装Pillow','nonBlocking':True}
    source={'type':'image','file':str(Path(file).expanduser())}
    try:
        path=Path(file).expanduser()
        if path.stat().st_size>25*1024*1024:raise ValueError('Image exceeds 25 MB')
        file_bytes=path.read_bytes()
        if len(file_bytes)>25*1024*1024:raise ValueError('Image exceeds 25 MB')
        source['sha256']=hashlib.sha256(file_bytes).hexdigest()
        with Image.open(io.BytesIO(file_bytes)) as im:
            if im.width*im.height>MAX_PIXELS:raise ValueError('Image exceeds 12 million pixels')
            im=ImageOps.exif_transpose(im)
            if box:
                import math
                if len(box)!=4 or not all(isinstance(v,(int,float)) and math.isfinite(v) and 0<=v<=1 for v in box) or box[2]<=box[0] or box[3]<=box[1]:raise ValueError('Invalid crop')
                w,h=im.size;im=im.crop((math.floor(w*box[0]),math.floor(h*box[1]),math.ceil(w*box[2]),math.ceil(h*box[3])))
                source['region']=box
            rgba=im.convert('RGBA').tobytes();width,height=im.size
        left=seconds-(time.monotonic()-started)
        if left<=0:return {'status':'timeout','source':source,'nonBlocking':True}
        result=decode_pixels(rgba,width,height,raw_rules,left)
    except (OSError,ValueError,Image.DecompressionBombError) as exc:return {'status':'invalid_image','source':source,'warning':str(exc)[:300],'nonBlocking':True}
    if not result.get('detected'):
        reason=result.get('reason','decoder_error')
        status='timeout' if reason=='decode_timeout' else 'invalid_schema' if reason=='invalid_rules_or_input' else 'dependency_error' if reason=='node_unavailable' else 'not_detected'
        return {'status':status,'source':source,'reason':reason,'warning':result.get('detail'), 'nonBlocking':True}
    legacy=result.get('protocol') in {'GHCV6','GHCV7'}
    payload=({k:result[k] for k in ['userId','loggedIn','gameId','timeStartUtc','timeEndUtc','protocolRevisionTimeUtc']} if legacy else result.get('payload'))
    return {'status':'decoded' if legacy else result['status'],'protocol':result['protocol'],
        'schema':{'projectKey':None,'version':None,'fingerprint':None,'legacy':True} if legacy else result.get('schema',{'fingerprint':result['schemaFingerprint']}),
        'payload':payload,'validation':{'bch':'passed','crc':'passed','authenticated':False,'minObservations':result['minObservations']},
        'source':source,'elapsedMs':round((time.monotonic()-started)*1000),'nonBlocking':not legacy and result['status']!='decoded'}

def generate_rules(source=None,project=None,verify_sources=None,output=None):
    """恢复规则并核对来源；没有编码指纹时只返回候选，不落正式规则。"""
    try:
        node=shutil.which('node')
        if not node:return {'status':'dependency_error','warning':'缺少Node，无法校验规则','nonBlocking':True}
        root=project_root(project)
        if not source and not root:return {'status':'needs_source_analysis','warning':'请指定 --project 或 --source；不会搜索其他工程','nonBlocking':True}
        path=Path(source).expanduser().resolve() if source else root/'watermark.schema.json'
        if not path.is_file():return {'status':'needs_source_analysis','warning':'项目缺少现成规则；请由Skill读取实际编码源码，提取候选规则后重新校验','nonBlocking':True}
        def unique(pairs):
            result={}
            for key,value in pairs:
                if key in result:raise ValueError('JSON含重复键: '+key)
                result[key]=value
            return result
        def read_file(path):
            if not path.is_file() or path.stat().st_size>1024*1024:raise ValueError('来源文件无效或超过1MB: '+str(path))
            return path.read_text(encoding='utf-8')
        raw=read_file(path);artifact=json.loads(raw,object_pairs_hook=unique)
        sources=[];provenance=[{'file':str(path),'sha256':hashlib.sha256(raw.encode()).hexdigest()}]
        if len(verify_sources or [])>16:raise ValueError('最多核对16份源码')
        for name in verify_sources or []:
            code_path=Path(name).expanduser().resolve();text=read_file(code_path)
            sources.append({'file':str(code_path),'text':text});provenance.append({'file':str(code_path),'sha256':hashlib.sha256(text.encode()).hexdigest()})
        request=json.dumps({'artifact':artifact,'verifySources':sources},ensure_ascii=False)
        if len(request.encode())>4*1024*1024:raise ValueError('来源总大小超过4MB')
        proc=subprocess.run([node,str(HERE/'generate_rules.cjs')],input=request,capture_output=True,text=True,timeout=15)
        result=json.loads(proc.stdout);result['sources']=provenance
        if result['status']=='rules_ready' and output:
            target=Path(output).expanduser().absolute()
            # 同内容可重复运行；不同内容绝不覆盖，历史规则由调用方保留。
            if target.exists() or target.is_symlink():
                if target.is_symlink() or json.loads(target.read_text(encoding='utf-8'),object_pairs_hook=unique)!=result['schema']:
                    raise ValueError('目标已存在且内容不同，未覆盖: '+str(target))
            else:
                with target.open('x',encoding='utf-8') as stream:stream.write(json.dumps(result['schema'],ensure_ascii=False,indent=2)+'\n')
            result['output']=str(target)
        result['nonBlocking']=result['status']!='rules_ready'
        return result
    except subprocess.TimeoutExpired:return {'status':'timeout','warning':'规则校验超过15秒，未生成文件','nonBlocking':True}
    except (OSError,ValueError,TypeError,KeyError,subprocess.SubprocessError) as exc:
        return {'status':'invalid_schema','warning':str(exc)[:400],'nonBlocking':True}

def main():
    p=argparse.ArgumentParser();commands=p.add_subparsers(dest='command',required=True)
    d=commands.add_parser('decode-image');d.add_argument('image');d.add_argument('--rules',action='append');d.add_argument('--project');d.add_argument('--timeout',type=float,default=5);d.add_argument('--box',nargs=4,type=float)
    g=commands.add_parser('generate-rules');g.add_argument('--source');g.add_argument('--project');g.add_argument('--verify-source',action='append');g.add_argument('--output')
    commands.add_parser('doctor')
    args=p.parse_args()
    if args.command=='doctor':
        import importlib.util
        value={'node':bool(shutil.which('node')),'pillow':importlib.util.find_spec('PIL') is not None,'core':all((HERE/'core'/p).is_file() for p in ['codec.js','schema.js'])}
    elif args.command=='generate-rules':
        value=generate_rules(args.source,args.project,args.verify_source,args.output)
    else:
        if not .01<=args.timeout<=60:p.error('--timeout must be 0.01..60 seconds')
        value=decode_file(args.image,args.rules,args.project,args.timeout,args.box)
    print(json.dumps(value,ensure_ascii=False,indent=2));return 0 if value.get('status') in {'decoded','rules_ready'} or args.command=='doctor' and all(value.values()) else 2
if __name__=='__main__':sys.exit(main())
