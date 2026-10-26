import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PixelImage } from '../types';
import type { DetectionKind, PartDetection } from './types';
import { faceTargets, bodyTargets, combineProtection } from './targets';

const scope=self as unknown as DedicatedWorkerGlobalScope;
let face:FaceLandmarker|null=null,pose:PoseLandmarker|null=null;
let files:Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>|null=null;
type Request={id:number;kind:DetectionKind;image:PixelImage;base:string};
let networkRestricted=false;
function restrictNetwork(base:string){
  if(networkRestricted)return;networkRestricted=true;
  const root=new URL(base),allowed=(value:string|URL)=>{const url=new URL(value,root);return url.origin===root.origin&&(url.pathname.startsWith(new URL('models/',root).pathname)||url.pathname.startsWith(new URL('vision/',root).pathname));};
  // The SDK contains optional usage logging. Only local model/runtime GETs are allowed.
  const fetchOriginal=scope.fetch.bind(scope);
  scope.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{
    const url=input instanceof Request?input.url:input;
    const method=init?.method||(input instanceof Request?input.method:'GET');
    if(!allowed(String(url))||!['GET','HEAD'].includes(method.toUpperCase()))return Promise.reject(new DOMException('External model telemetry is disabled.','SecurityError'));
    return fetchOriginal(input,init);
  }) as typeof fetch;
  const open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method:string,url:string|URL,async:boolean=true,username?:string|null,password?:string|null){
    if(!allowed(url)||!['GET','HEAD'].includes(method.toUpperCase()))throw new DOMException('External model telemetry is disabled.','SecurityError');
    open.call(this,method,url,async,username,password);
  };
}
scope.onmessage=async({data}:MessageEvent<Request>)=>{
  const {id,kind,image,base}=data;
  const progress=(label:string)=>scope.postMessage({id,type:'progress',label});
  try{
    restrictNetwork(base);
    if(!files){progress('准备本地识别组件…');files=await FilesetResolver.forVisionTasks(new URL('vision',base).href,false);}
    // Keep only one model resident on phones. It is reused until switching kind.
    if(kind==='face'&&!face){
      pose?.close();pose=null;progress('加载五官定位模型…');
      face=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('models/face_landmarker.task',base).href,delegate:'CPU'},runningMode:'IMAGE',numFaces:3,minFaceDetectionConfidence:.5,minFacePresenceConfidence:.5,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false});
    }
    if(kind==='body'&&!pose){
      face?.close();face=null;progress('加载肢体定位模型…');
      pose=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('models/pose_landmarker_lite.task',base).href,delegate:'CPU'},runningMode:'IMAGE',numPoses:3,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,outputSegmentationMasks:true});
    }
    progress(kind==='face'?'正在定位眼睛和鼻子…':'正在定位手臂与人物轮廓…');
    // MediaPipe float-mask copies require a 16-byte row stride. Right-edge
    // replication avoids the upstream ChannelSize abort on e.g. 711px inputs.
    const inputWidth=kind==='body'?Math.ceil(image.width/4)*4:image.width;
    const aligned=new Uint8ClampedArray(inputWidth*image.height*4);
    for(let y=0;y<image.height;y++){
      aligned.set(image.data.subarray(y*image.width*4,(y+1)*image.width*4),y*inputWidth*4);
      for(let x=image.width;x<inputWidth;x++)aligned.set(image.data.subarray(((y+1)*image.width-1)*4,((y+1)*image.width)*4),(y*inputWidth+x)*4);
    }
    const input=new ImageData(aligned,inputWidth,image.height);
    let result:PartDetection={targets:[],warnings:[]};
    if(kind==='face'){
      const data=face!.detect(input);
      const targets=faceTargets(data.faceLandmarks,image.width,image.height);
      result={targets,warnings:targets.length?[]:['没有找到可靠五官，可直接点选图片进行局部塑形。']};
      if(data.faceLandmarks.length>=3)result.warnings.push('当前最多定位三张脸，其他人物可手动点选。');
    }else{
      // Read/copy masks within the synchronous callback, then release SDK-owned data.
      pose!.detect(input,data=>{
        const masks=(data.segmentationMasks||[]).map(mask=>{
          const full=mask.getAsFloat32Array(),width=Math.round(mask.width*image.width/inputWidth),cropped=new Float32Array(width*mask.height);
          for(let y=0;y<mask.height;y++)cropped.set(full.subarray(y*mask.width,y*mask.width+width),y*width);
          return{mask:cropped,width,height:mask.height};
        });
        const landmarks=data.landmarks.map(person=>person.map(p=>({...p,x:p.x*inputWidth/image.width})));
        const targets=bodyTargets(landmarks,image.width,image.height,masks);
        result={targets,protection:combineProtection(masks),warnings:[]};
        if(!targets.length)result.warnings.push('没有找到可靠的可见手臂，可点选目标并调整影响范围。');
        else result.warnings.push('手臂范围可微调；耳朵仅作位置辅助，遮挡与交叉部位请手动确认。');
        if(data.landmarks.length>=3)result.warnings.push('当前最多定位三个人物，其他人物可手动点选。');
      });
    }
    scope.postMessage({id,type:'result',result},result.protection?[result.protection.mask.buffer]:[]);
  }catch(error){
    try{face?.close();}catch{}face=null;try{pose?.close();}catch{}pose=null;files=null;
    scope.postMessage({id,type:'error',message:error instanceof Error?error.message:String(error)});
  }
};
