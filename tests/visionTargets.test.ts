import test from 'node:test';
import assert from 'node:assert/strict';
import { faceTargets, bodyTargets, combineProtection } from '../src/vision/targets';
import type { LandmarkPoint } from '../src/vision/types';

test('missing/invalid landmarks do not fabricate selectable anatomy',()=>{
  assert.deepEqual(faceTargets([[]],800,600),[]);
  assert.deepEqual(bodyTargets([[]],800,600),[]);
  assert.deepEqual(faceTargets([[{x:NaN,y:.5}]],800,600),[]);
});

test('arm width axis is perpendicular in pixel space, including non-square images',()=>{
  const points:LandmarkPoint[]=Array.from({length:33},()=>({x:.5,y:.5,visibility:0}));
  points[11]={x:.2,y:.2,visibility:.95};points[13]={x:.4,y:.6,visibility:.9};
  const targets=bodyTargets([points],1000,500);
  assert.equal(targets.length,1);
  const t=targets[0];assert.equal(t.axis,'width');assert.equal(t.label,'左上臂');
  assert.ok(Math.abs(t.angle+Math.PI/4)<1e-8);
  assert.ok(Math.abs(t.cx-.3)<1e-8);assert.ok(Math.abs(t.cy-.4)<1e-8);
  assert.ok(t.rx>0&&t.ry>0);
});

test('low confidence and off-image limb endpoints are excluded',()=>{
  const p:LandmarkPoint[]=Array.from({length:33},()=>({x:.5,y:.5,visibility:0}));
  p[11]={x:.2,y:.2,visibility:.95};p[13]={x:.4,y:.6,visibility:.2};
  assert.equal(bodyTargets([p],1000,500).length,0);
  p[13]={x:1.2,y:.6,visibility:.95};
  assert.equal(bodyTargets([p],1000,500).length,0);
});

test('multiple people keep independent ids and mask values are finite probabilities',()=>{
  const p:LandmarkPoint[]=Array.from({length:33},()=>({x:.5,y:.5,visibility:0}));
  p[11]={x:.2,y:.2,visibility:.95};p[13]={x:.4,y:.6,visibility:.95};
  const t=bodyTargets([p,p],800,600);
  assert.equal(new Set(t.map(v=>v.id)).size,2);
  assert.ok(t[1].label.includes('人物 2'));
  const protection=combineProtection([{mask:new Float32Array([.2,NaN,1.3,0]),width:2,height:2},{mask:new Float32Array([.9,.4,.2,-1]),width:2,height:2}])!;
  assert.ok(Math.abs(protection.mask[0]-.9)<1e-6);
  assert.ok(Math.abs(protection.mask[1]-.4)<1e-6);
  assert.equal(protection.mask[2],1);assert.equal(protection.mask[3],0);
});

test('face regions follow an actual eye direction and keep screen-side labels',()=>{
  const p:LandmarkPoint[]=Array.from({length:478},()=>({x:NaN,y:NaN}));
  const fill=(ids:number[],cx:number,cy:number)=>ids.forEach((id,i)=>{p[id]={x:cx+(i%3-1)*.02,y:cy+(i<3?-.01:.01)};});
  fill([33,160,158,133,153,144],.35,.4);fill([362,385,387,263,373,380],.65,.4);
  p[33]={x:.31,y:.4};p[263]={x:.69,y:.4};
  fill([168,6,4,1,2,98,327],.5,.55);
  const t=faceTargets([p],1000,600);
  assert.equal(t.length,3);assert.equal(t[0].label,'左侧眼睛');assert.equal(t[1].label,'右侧眼睛');
  assert.ok(t[0].cx<t[1].cx);assert.equal(t[2].label,'鼻子');
  for(const v of t)assert.ok(Object.values(v).filter(x=>typeof x==='number').every(Number.isFinite));
});
