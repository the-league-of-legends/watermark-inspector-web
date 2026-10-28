// 展示层几何估算：区域没有逐块独立校验，不改变公共解码接口。
const WatermarkRegions = (() => {
  function estimate(result, width, height, bounds) {
    const unavailable = {status: 'unavailable', basis: 'estimated_repeat_geometry', independentlyVerified: false, regions: []};
    const d = result?.diagnostics;
    if(result?.detected && d?.transportProfile==='edge-v1-preview' && Array.isArray(d.edgeRegions)) {
      const regions=d.edgeRegions.filter(r=>[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0).map(r=>{
        const x=Math.max(0,r.x),y=Math.max(0,r.y),right=Math.min(width,r.x+r.width),bottom=Math.min(height,r.y+r.height);
        return {kind:r.x>=-1&&r.y>=-1&&r.x+r.width<=width+1&&r.y+r.height<=height+1?'complete':'partial',scale:1,
          tileRect:{x:r.x,y:r.y,width:r.width,height:r.height},visibleRect:{x,y,width:right-x,height:bottom-y}};
      }).filter(r=>r.visibleRect.width>0&&r.visibleRect.height>0).sort((a,b)=>a.tileRect.y-b.tileRect.y||a.tileRect.x-b.tileRect.x).map((r,i)=>({...r,id:i+1}));
      return {status:'estimated',basis:'estimated_edge_packet_geometry',independentlyVerified:false,referenceBounds:{x:0,y:0,width,height},completeCount:regions.filter(r=>r.kind==='complete').length,partialCount:regions.filter(r=>r.kind==='partial').length,regions};
    }
    if (!result?.detected || !d || ![width,height,d.scale,d.cellPhaseX,d.cellPhaseY,d.tileShiftCellsX,d.tileShiftCellsY].every(Number.isFinite)
      || width <= 0 || height <= 0 || width*height > 12000000 || d.cellPhaseX < 0 || d.cellPhaseY < 0 || d.cellPhaseX > width || d.cellPhaseY > height || d.scale < 1/3 - 1e-9 || d.scale > 1.5 + 1e-9
      || !Number.isInteger(d.tileShiftCellsX) || d.tileShiftCellsX < 0 || d.tileShiftCellsX >= 17
      || !Number.isInteger(d.tileShiftCellsY) || d.tileShiftCellsY < 0 || d.tileShiftCellsY >= 64
      || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return unavailable;
    const [left,top,right,bottom] = [Math.max(0,bounds[0]),Math.max(0,bounds[1]),Math.min(width,bounds[2]),Math.min(height,bounds[3])];
    if (right <= left || bottom <= top) return unavailable;
    const tw=544*d.scale, th=512*d.scale, eps=1e-6;
    const ox=d.cellPhaseX-d.tileShiftCellsX*32*d.scale, oy=d.cellPhaseY-d.tileShiftCellsY*8*d.scale;
    const regions=[];
    for (let row=Math.floor((top-oy)/th); oy+row*th < bottom-eps; row++) {
      for(let col=Math.floor((left-ox)/tw); ox+col*tw < right-eps; col++) {
        const x=ox+col*tw,y=oy+row*th, vx=Math.max(left,x),vy=Math.max(top,y), vr=Math.min(right,x+tw),vb=Math.min(bottom,y+th);
        if (vr-vx <= eps || vb-vy <= eps) continue;
        const complete=x>=left-eps && y>=top-eps && x+tw<=right+eps && y+th<=bottom+eps;
        regions.push({id:regions.length+1, kind:complete?'complete':'partial', scale:d.scale,
          tileRect:{x,y,width:tw,height:th},visibleRect:{x:vx,y:vy,width:vr-vx,height:vb-vy}});
      }
    }
    return {status:'estimated',basis:'estimated_repeat_geometry',independentlyVerified:false,
      referenceBounds:{x:left,y:top,width:right-left,height:bottom-top},
      completeCount:regions.filter(r=>r.kind==='complete').length,partialCount:regions.filter(r=>r.kind==='partial').length,regions};
  }
  return {estimate};
})();
if(typeof module!=='undefined' && module.exports) module.exports=WatermarkRegions;
