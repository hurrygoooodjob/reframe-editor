// Adapted from the Tonepress v06 still-image renderer.
import { newSurface } from "./surface.js";
const definitions={
  "trace-motion":{name:"运动描迹",english:"Trace Motion",scaleLabel:"轨迹长度",size:8,strength:94,temporal:true,
    description:"视频用连续帧分块匹配估算位移，累积并衰减运动笔迹。静态图沿局部边缘绘制短线。",
    controls:[{key:"ink",label:"描迹墨色",kind:"select",value:"mint",options:[{value:"mint",label:"薄荷绿"},{value:"amber",label:"琥珀黄"}]}]},
  "brand-generator":{name:"品牌构图",english:"Brand Generator",scaleLabel:"版式尺度",size:8,strength:95,
    description:"在画面细节区定位图形锚点，提取代表色，生成可改标题的品牌标记与色卡。",
    controls:[{key:"brand",label:"品牌名称",kind:"text",value:"FORMA",maxLength:24}]},
  "cctv-surveillance":{name:"监控画面",english:"CCTV Surveillance",scaleLabel:"扫描间距",size:7,strength:92,timed:true,temporal:true,
    description:"生成监控时间码和扫描纹理。视频通过帧差标出变化区域，静态素材显示待机状态。",
    controls:[{key:"channel",label:"频道名称",kind:"text",value:"CAM 01",maxLength:18}]},
  "hud-tracker":{name:"目标标记",english:"HUD Tracker",scaleLabel:"目标框尺度",size:7,strength:94,temporal:true,
    description:"在前后帧中关联移动区域并保持标记 ID；单帧用局部对比度定位。跟踪依据是像素变化，不识别人物身份。"}
};
let tiny;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
function sample(input) {
  tiny ??= newSurface();
  const tinyCtx=tiny.getContext("2d",{willReadFrequently:true});
  const scale=112/Math.max(input.width,input.height);
  const w=Math.max(4,Math.round(input.width*scale)),h=Math.max(4,Math.round(input.height*scale));
  if(tiny.width!==w) tiny.width=w;
  if(tiny.height!==h) tiny.height=h;
  tinyCtx.clearRect(0,0,w,h);
  tinyCtx.drawImage(input,0,0,w,h);
  const rgb=tinyCtx.getImageData(0,0,w,h).data;
  const lum=new Uint8Array(w*h);
  for(let i=0;i<lum.length;i++) lum[i]=(.2126*rgb[i*4]+.7152*rgb[i*4+1]+.0722*rgb[i*4+2])*rgb[i*4+3]/255;
  return {w,h,lum,rgb};
}
function features(frame) {
  const {w,h,lum}=frame, pts=[];
  for(let y=2;y<h-2;y+=3) for(let x=2;x<w-2;x+=3) {
    const i=y*w+x,dx=lum[i+1]-lum[i-1],dy=lum[i+w]-lum[i-w];
    const score=Math.hypot(dx,dy);
    if(score>10) pts.push({x:x/w,y:y/h,score,angle:Math.atan2(dy,dx)+Math.PI/2});
  }
  pts.sort((a,b)=>b.score-a.score);
  return pts;
}
function spread(points,distance,limit) {
  const out=[];
  for(const p of points) {
    if(out.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>distance)) out.push(p);
    if(out.length===limit) break;
  }
  return out;
}
// Compare 5×5 patches across a local search window. Flat or ambiguous matches are rejected.
function flow(frame,previous) {
  const {w,h,lum}=frame,out=[];
  const margin=8;
  for(let y=margin;y<h-margin;y+=6) for(let x=margin;x<w-margin;x+=6) {
    const i=y*w+x;
    if(Math.abs(previous[i+2]-previous[i-2])+Math.abs(previous[i+w]-previous[i-w])<12) continue;
    let best=Infinity, atOrigin=0, vx=0,vy=0;
    for(let dy=-5;dy<=5;dy++) for(let dx=-5;dx<=5;dx++) {
      let err=0;
      for(let b=-2;b<=2;b++) for(let a=-2;a<=2;a++) err+=Math.abs(previous[i+b*w+a]-lum[i+(b+dy)*w+a+dx]);
      if(dx===0 && dy===0) atOrigin=err;
      err+=1.8*(dx*dx+dy*dy);
      if(err<best) {best=err;vx=dx;vy=dy;}
    }
    if((vx||vy) && best<atOrigin*.90 && best<850) out.push({x:x/w,y:y/h,dx:vx/w,dy:vy/h});
  }
  return out;
}
// Connected components on a tiled difference mask keep separated moving regions distinct.
function regions(frame,previous) {
  const {w,h,lum}=frame, cols=Math.ceil(w/6), rows=Math.ceil(h/6);
  const mask=new Uint8Array(cols*rows), totals=new Uint8Array(cols*rows);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const cell=Math.floor(y/6)*cols+Math.floor(x/6);
    totals[cell]++;
    if(Math.abs(lum[y*w+x]-previous[y*w+x])>19) mask[cell]++;
  }
  for(let i=0;i<mask.length;i++) mask[i]=mask[i]>=Math.max(2,totals[i]*.24)?1:0;
  const boxes=[];
  for(let n=0;n<mask.length;n++) {
    if(mask[n]!==1) continue;
    let loX=cols,loY=rows,hiX=0,hiY=0;
    const queue=[n];mask[n]=0;
    for(let k=0;k<queue.length;k++) {
      const i=queue[k],x=i%cols,y=Math.floor(i/cols);
      loX=Math.min(loX,x);hiX=Math.max(hiX,x);loY=Math.min(loY,y);hiY=Math.max(hiY,y);
      for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
        const j=ny*cols+nx;
        if(nx>=0 && nx<cols && ny>=0 && ny<rows && mask[j]===1) {mask[j]=0;queue.push(j);}
      }
    }
    if(queue.length>=2) boxes.push({x:(loX+hiX+1)/(2*cols),y:(loY+hiY+1)/(2*rows),
      w:(hiX-loX+1)/cols,h:(hiY-loY+1)/rows,weight:queue.length});
  }
  return boxes.sort((a,b)=>b.weight-a.weight).slice(0,5);
}
function associate(boxes,prior,history) {
  const used=new Set();
  for(const b of boxes) {
    let best=null, distance=.26;
    for(const p of prior) {
      const d=Math.hypot(b.x-p.x,b.y-p.y);
      if(!used.has(p.id)&&d<distance) {best=p;distance=d;}
    }
    b.id=best?.id ?? ++history.serial;
    used.add(b.id);
  }
  return boxes;
}
function observations(frame,s) {
  const hist=s.history || {}, time=s.time;
  if(hist.lastTime===time && hist.result && hist.w===frame.w && hist.h===frame.h) return hist.result;
  const continuous=s.videoSource && hist.prev && hist.w===frame.w && hist.h===frame.h && time>hist.lastTime && time-hist.lastTime<=.65;
  const anchors=features(frame);
  const motion=continuous ? regions(frame,hist.prev) : [];
  if(!continuous) hist.serial=0;
  if(s.type==="hud-tracker") {
    const proposals=motion.length?motion:spread(anchors,.21,3).map(p=>({...p,w:.11+s.size*.006,h:.12+s.size*.005}));
    associate(proposals,continuous ? hist.result.targets:[],hist);
    hist.targets=proposals;
  }
  let trails=[];
  if(s.type==="trace-motion" && continuous) {
    trails=(hist.result.trails||[]).filter(line=>time-line.time<.2+s.size*.085);
    for(const v of flow(frame,hist.prev)) trails.push({...v,time});
    if(trails.length>1200) trails=trails.slice(-1200);
  }
  hist.result={anchors:spread(anchors,.06,70),motion,trails,targets:hist.targets||[]};
  hist.prev=frame.lum;hist.w=frame.w;hist.h=frame.h;hist.lastTime=time;
  return hist.result;
}
function bracket(ctx,box,w,h,color) {
  const bw=Math.max(10,box.w*w),bh=Math.max(10,box.h*h);
  const x=clamp(box.x*w-bw/2,1,Math.max(1,w-bw-1)),y=clamp(box.y*h-bh/2,1,Math.max(1,h-bh-1));
  const arm=Math.min(bw,bh)*.24;
  ctx.strokeStyle=color;ctx.beginPath();
  for(const [cx,cy,sx,sy] of [[x,y,1,1],[x+bw,y,-1,1],[x,y+bh,1,-1],[x+bw,y+bh,-1,-1]]) {
    ctx.moveTo(cx+arm*sx,cy);ctx.lineTo(cx,cy);ctx.lineTo(cx,cy+arm*sy);
  }
  ctx.stroke();
  return {x,y};
}
function stamp(ctx,text,x,y,ink="#c4ff80") {
  const m=ctx.measureText(text),h=parseFloat(ctx.font)||12;
  ctx.fillStyle="rgba(8,19,17,.78)";ctx.fillRect(x-2,y-1,m.width+5,h+4);
  ctx.fillStyle=ink;ctx.fillText(text,x,y);
}
function trace(ctx,input,obs,s,w,h,k) {
  ctx.drawImage(input,0,0);
  ctx.fillStyle="rgba(13,22,28,.39)";ctx.fillRect(0,0,w,h);
  ctx.strokeStyle=s.ink==="amber"?"#ffb34d":"#a5ffce";
  ctx.lineWidth=Math.max(.8,(1+s.size*.12)*k);ctx.lineCap="round";
  if(!s.videoSource) {
    ctx.globalAlpha=.76;ctx.beginPath();
    for(const p of obs.anchors) {
      const d=(3+s.size*.75)*k,x=p.x*w,y=p.y*h;
      ctx.moveTo(x-d*Math.cos(p.angle),y-d*Math.sin(p.angle));ctx.lineTo(x+d*Math.cos(p.angle),y+d*Math.sin(p.angle));
    }
    ctx.stroke();return;
  }
  for(const segment of obs.trails) {
    const fade=1-(s.time-segment.time)/(.2+s.size*.085);
    ctx.globalAlpha=clamp(fade,0,1);ctx.beginPath();
    ctx.moveTo(segment.x*w,segment.y*h);
    ctx.lineTo((segment.x+segment.dx*(1+s.size*.08))*w,(segment.y+segment.dy*(1+s.size*.08))*h);
    ctx.stroke();
  }
}
function brand(ctx,input,frame,obs,s,w,h,k) {
  ctx.drawImage(input,0,0);
  const anchor=obs.anchors[0]||{x:.5,y:.5}, m=Math.min(w,h)*.055;
  const index=4*(Math.min(frame.w-1,Math.floor(anchor.x*frame.w))+frame.w*Math.min(frame.h-1,Math.floor(anchor.y*frame.h)));
  const color="rgb("+[0,1,2].map(c=>frame.rgb[index+c]).join(",")+")";
  const font=Math.max(10,Math.min(w*.105,h*(.07+s.size*.005)));
  ctx.font="bold "+font+"px sans-serif";ctx.textBaseline="top";
  const name=(s.brand||"FORMA").toUpperCase();
  const labelWidth=Math.min(w-m*2,ctx.measureText(name).width+m*.65);
  const x=anchor.x>.5?m:Math.max(m,w-labelWidth-m), y=anchor.y>.5?m:h-font*1.25-m;
  ctx.fillStyle="#ebe9df";ctx.fillRect(x,y,labelWidth,font*1.25);
  ctx.fillStyle="#19211f";ctx.fillText(name,x+m*.27,y+font*.13,labelWidth-m*.45);
  ctx.strokeStyle="#edece4";ctx.lineWidth=Math.max(1,k*1.4);
  ctx.beginPath();ctx.moveTo(x+labelWidth/2,y+font*1.25);ctx.lineTo(anchor.x*w,anchor.y*h);ctx.stroke();
  const r=Math.max(3,k*s.size);
  ctx.strokeRect(anchor.x*w-r,anchor.y*h-r,2*r,2*r);
  ctx.fillStyle=color;ctx.fillRect(x,y+font*1.25,labelWidth,font*.12);
}
function cctv(ctx,input,obs,s,w,h,k) {
  ctx.drawImage(input,0,0);
  ctx.globalCompositeOperation="saturation";ctx.fillStyle="#555";ctx.fillRect(0,0,w,h);
  ctx.globalCompositeOperation="source-over";ctx.fillStyle="rgba(18,68,38,.28)";ctx.fillRect(0,0,w,h);
  const spacing=Math.max(2,k*(2+s.size*.36));
  ctx.fillStyle="rgba(2,23,11,.25)";
  for(let y=0;y<h;y+=spacing)ctx.fillRect(0,y,w,Math.max(.6,spacing*.23));
  const fs=Math.max(7,Math.min(h*.06,18*k));ctx.font=fs+"px monospace";ctx.textBaseline="top";
  const t=Math.max(0,s.time), hh=Math.floor(t/3600),mm=Math.floor(t/60)%60,ss=Math.floor(t)%60;
  const clock=[hh,mm,ss].map(n=>String(n).padStart(2,"0")).join(":");
  stamp(ctx,(s.channel||"CAM 01")+"  "+clock,w*.035,h*.05,"#daffd8");
  stamp(ctx,obs.motion.length?"MOTION "+obs.motion.length:"STANDBY",w*.035,h*.87,"#daffd8");
  ctx.lineWidth=Math.max(1,k);
  for(const box of obs.motion) bracket(ctx,box,w,h,"#b1ff86");
}
function hud(ctx,input,obs,s,w,h,k) {
  ctx.drawImage(input,0,0);
  ctx.fillStyle="rgba(0,24,23,.17)";ctx.fillRect(0,0,w,h);ctx.textBaseline="top";
  ctx.font=Math.max(8,Math.min(20*k,h*.052))+"px monospace";ctx.lineWidth=Math.max(1,k*(1+s.size*.075));
  for(const target of obs.targets) {
    const p=bracket(ctx,target,w,h,"#8effed");
    stamp(ctx,"T-"+String(target.id).padStart(2,"0"),p.x,Math.max(0,p.y-parseFloat(ctx.font)-4),"#9effe7");
    const x=target.x*w,y=target.y*h,r=Math.max(3,k*4);
    ctx.beginPath();ctx.moveTo(x-r,y);ctx.lineTo(x+r,y);ctx.moveTo(x,y-r);ctx.lineTo(x,y+r);ctx.stroke();
  }
}
function draw(input,output,s) {
  const ctx=output.getContext("2d"),w=output.width,h=output.height,k=Math.max(.3,Math.min(w,h)/550);
  const frame=sample(input), obs=observations(frame,s);
  if(s.type==="trace-motion") trace(ctx,input,obs,s,w,h,k);
  else if(s.type==="brand-generator") brand(ctx,input,frame,obs,s,w,h,k);
  else if(s.type==="cctv-surveillance") cctv(ctx,input,obs,s,w,h,k);
  else hud(ctx,input,obs,s,w,h,k);
}
export { definitions, draw };
