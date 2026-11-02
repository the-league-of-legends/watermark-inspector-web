// 外层Worker可在初始化、识别任一阶段立即终止，连同内部Tesseract Worker释放。
let engine;
self.onmessage=async({data:m})=>{try{
 if(m.action==='init'){
  importScripts(m.base+'tesseract.min.js');
  engine=await Tesseract.createWorker('eng',1,{workerPath:m.base+'worker.min.js',corePath:m.base+'core/',langPath:m.base+'lang/',workerBlobURL:false,cacheMethod:'none',gzip:true,errorHandler:()=>{}});
  await engine.setParameters({tessedit_char_whitelist:'0123456789UIDuid:',tessedit_pageseg_mode:'11',user_defined_dpi:'300',preserve_interword_spaces:'1'});
  self.postMessage({id:m.id,ready:true});
 }else if(m.action==='recognize'){
  const {data}=await engine.recognize(new Uint8Array(m.buffer),{}, {text:true,blocks:true});
  self.postMessage({id:m.id,data});
 }
}catch(e){self.postMessage({id:m.id,error:String(e.message||e)})}};
