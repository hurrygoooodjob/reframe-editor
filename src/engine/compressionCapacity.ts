export interface CompressionCapacity { width:number; height:number; }
/** Count low-cost connected corridors, not background area. Recompute after each seam. */
export function estimateCompressionCapacity(mask:Float32Array,width:number,height:number,confidence:string):CompressionCapacity {
  if(width<1||height<1||mask.length!==width*height||confidence==='low')return {width:0,height:0};
  const scale=Math.min(1,64/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  const grid=Array.from({length:h},(_,y)=>Array.from({length:w},(_,x)=>{
    let value=0;
    for(let sy=Math.floor(y*height/h);sy<Math.ceil((y+1)*height/h);sy++)for(let sx=Math.floor(x*width/w);sx<Math.ceil((x+1)*width/w);sx++){
      const v=mask[Math.min(height-1,sy)*width+Math.min(width-1,sx)];
      if(v>0)value=Math.max(value,v);else if(value<=0)value=Math.min(value,v);
    }return value;
  }));
  function capacity(rows:number[][]){
    const original=rows[0].length,limit=Math.floor(original*(confidence==='high'?.22:.12));let removed=0;
    for(;removed<limit;removed++){
      const n=rows[0].length,m=rows.length,cost=Array.from({length:m},()=>new Float64Array(n)),path=Array.from({length:m},()=>new Int16Array(n));
      for(let y=0;y<m;y++)for(let x=0;x<n;x++){
        const v=rows[y][x],own=v>.15?Infinity:v<-.03?0:.5;
        let best=y?Infinity:0,px=x;
        if(y)for(let j=Math.max(0,x-1);j<=Math.min(n-1,x+1);j++)if(cost[y-1][j]<best){best=cost[y-1][j];px=j;}
        cost[y][x]=own+best;path[y][x]=px;
      }
      let x=0;for(let j=1;j<n;j++)if(cost[m-1][j]<cost[m-1][x])x=j;
      if(!Number.isFinite(cost[m-1][x])||cost[m-1][x]/m>.18)break;
      for(let y=m-1;y>=0;y--){const prev=path[y][x];rows[y].splice(x,1);x=prev;}
    }return Math.max(0,(removed-1)/original)*.7;
  }
  return {width:capacity(grid.map(r=>r.slice())),height:capacity(Array.from({length:w},(_,x)=>grid.map(r=>r[x])))};
}
