import type { LandmarkPoint, PartTarget } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const valid = (p: LandmarkPoint | undefined): p is LandmarkPoint => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const visible = (p: LandmarkPoint | undefined): p is LandmarkPoint => valid(p) && (p.visibility ?? 1) >= .6 && (p.presence ?? 1) >= .6;

function region(points: LandmarkPoint[], indices: number[], angle: number, width: number, height: number, id: string, label: string, paddingX: number, paddingY: number): PartTarget | null {
  const selected = indices.map(i => points[i]);
  if (!selected.every(valid)) return null;
  const ox = selected.reduce((sum,p)=>sum+p.x*width,0)/selected.length;
  const oy = selected.reduce((sum,p)=>sum+p.y*height,0)/selected.length;
  const c = Math.cos(angle), s = Math.sin(angle);
  const local = selected.map(p => ({x:(p.x*width-ox)*c+(p.y*height-oy)*s,y:-(p.x*width-ox)*s+(p.y*height-oy)*c}));
  const minX=Math.min(...local.map(p=>p.x)),maxX=Math.max(...local.map(p=>p.x));
  const minY=Math.min(...local.map(p=>p.y)),maxY=Math.max(...local.map(p=>p.y));
  if(maxX-minX<3 || maxY-minY<1) return null;
  const mx=(minX+maxX)/2,my=(minY+maxY)/2;
  return {id,label,cx:clamp((ox+mx*c-my*s)/width,0,1),cy:clamp((oy+mx*s+my*c)/height,0,1),
    rx:clamp((maxX-minX)*paddingX/2/width,.008,.45),ry:clamp(Math.max(maxY-minY,(maxX-minX)*.45)*paddingY/2/height,.008,.45),angle,axis:'both'};
}

/** Face mesh indices are anatomical; labels below use image-side ordering for clarity. */
export function faceTargets(faces: LandmarkPoint[][], width: number, height: number): PartTarget[] {
  if(!(width>0&&height>0)) return [];
  const output: PartTarget[]=[];
  faces.forEach((points,index)=>{
    if(!valid(points[33]) || !valid(points[263]))return;
    let angle=Math.atan2((points[263].y-points[33].y)*height,(points[263].x-points[33].x)*width);
    // A direction axis, not a directed anatomical vector, avoids an accidental 180° flip.
    if(angle>Math.PI/2)angle-=Math.PI;if(angle< -Math.PI/2)angle+=Math.PI;
    const prefix=faces.length>1?`人物 ${index+1} · `:'';
    const eyes=[
      region(points,[33,160,158,133,153,144],angle,width,height,`face-${index}-eye-a`,'',1.9,2.0),
      region(points,[362,385,387,263,373,380],angle,width,height,`face-${index}-eye-b`,'',1.9,2.0),
    ].filter((p):p is PartTarget=>!!p).sort((a,b)=>a.cx-b.cx);
    eyes.forEach((eye,i)=>output.push({...eye,label:`${prefix}${i===0?'左侧眼睛':'右侧眼睛'}`}));
    const nose=region(points,[168,6,4,1,2,98,327],angle,width,height,`face-${index}-nose`,`${prefix}鼻子`,1.8,1.5);
    if(nose)output.push(nose);
  });
  return output;
}

type ProbabilityMask={mask:Float32Array;width:number;height:number};
function sampleMask(mask:ProbabilityMask,x:number,y:number){
  if(x<0||x>1||y<0||y>1)return 0;
  return mask.mask[Math.min(mask.height-1,Math.floor(y*mask.height))*mask.width+Math.min(mask.width-1,Math.floor(x*mask.width))]||0;
}

/** Width uses the local silhouette only if both sides have a plausible boundary. */
function armHalfWidth(a:LandmarkPoint,b:LandmarkPoint,width:number,height:number,mask?:ProbabilityMask){
  const dx=(b.x-a.x)*width,dy=(b.y-a.y)*height,len=Math.hypot(dx,dy);
  const fallback=Math.max(8,len*.18);
  if(!mask||len<1)return fallback;
  const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,nx=-dy/len,ny=dx/len;
  if(sampleMask(mask,cx,cy)<.55)return fallback;
  const distances:number[]=[];
  for(const sign of [-1,1]){
    let boundary=0;
    for(let d=2;d<=len*.5;d+=2){if(sampleMask(mask,cx+nx*d*sign/width,cy+ny*d*sign/height)<.45){boundary=d;break;}}
    if(!boundary)return fallback;
    distances.push(boundary);
  }
  // A large asymmetry is usually an arm merged with torso/another limb.
  if(Math.max(...distances)>Math.min(...distances)*3)return fallback;
  return clamp((distances[0]+distances[1])/2,Math.max(5,len*.06),len*.35);
}

export function bodyTargets(poses:LandmarkPoint[][],width:number,height:number,masks:ProbabilityMask[]=[]):PartTarget[]{
  if(!(width>0&&height>0))return [];
  const targets:PartTarget[]=[];
  poses.forEach((p,index)=>{
    const prefix=poses.length>1?`人物 ${index+1} · `:'';
    for(const [name,aIndex,bIndex] of [['左上臂',11,13],['左前臂',13,15],['右上臂',12,14],['右前臂',14,16]] as const){
      const a=p[aIndex],b=p[bIndex];if(!visible(a)||!visible(b))continue;
      const dx=(b.x-a.x)*width,dy=(b.y-a.y)*height,len=Math.hypot(dx,dy);
      if(len<16)continue;
      const half=armHalfWidth(a,b,width,height,masks[index]);
      targets.push({id:`body-${index}-${aIndex}-${bIndex}`,label:prefix+name,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,
        rx:clamp(half*2.2/width,.015,.4),ry:clamp(len*.65/height,.02,.45),angle:Math.atan2(dy,dx)-Math.PI/2,axis:'width',
        confidence:Math.min(a.visibility??1,b.visibility??1,a.presence??1,b.presence??1)});
    }
    const le=p[7],re=p[8];
    // Pose supplies ear positions, not a full ear contour: these remain explicitly labelled hints.
    if(visible(le)&&visible(re)){
      const separation=Math.hypot((le.x-re.x)*width,(le.y-re.y)*height);
      if(separation>=16)for(const [label,point,i] of [['左耳',le,7],['右耳',re,8]] as const){
        targets.push({id:`body-${index}-ear-${i}`,label:`${prefix}${label}（辅助）`,cx:point.x,cy:point.y,
          rx:clamp(separation*.18/width,.012,.12),ry:clamp(separation*.3/height,.018,.18),
          angle:Math.atan2((re.y-le.y)*height,(re.x-le.x)*width),axis:'both',confidence:Math.min(point.visibility??1,.6)});
      }
    }
  });return targets;
}

export function combineProtection(masks:ProbabilityMask[]):ProbabilityMask|undefined{
  const first=masks[0];if(!first)return undefined;
  const merged=new Float32Array(first.mask.length);
  for(const mask of masks){
    if(mask.width!==first.width||mask.height!==first.height)continue;
    for(let i=0;i<merged.length;i++)merged[i]=Math.max(merged[i],clamp(Number.isFinite(mask.mask[i])?mask.mask[i]:0,0,1));
  }
  return {mask:merged,width:first.width,height:first.height};
}
