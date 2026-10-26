import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCompressionCapacity } from '../src/engine/compressionCapacity';
import { createRandomPlan } from '../src/autoPlan';
import { DEFAULT_SETTINGS } from '../src/types';
test('low confidence never recommends shrinking and blocked corridors have zero capacity',()=>{
 const m=new Float32Array(64*64).fill(-1);
 assert.deepEqual(estimateCompressionCapacity(m,64,64,'low'),{width:0,height:0});
 m.fill(1,32*64,33*64);
 const c=estimateCompressionCapacity(m,64,64,'high');assert.equal(c.width,0);assert.ok(c.height>0);
});
test('automatic plan respects directional capacity and keeps existing settings when none exists',()=>{
 const size={width:1000,height:800},settings={...DEFAULT_SETTINGS,...size};
 assert.deepEqual(createRandomPlan(size,settings,1,{width:0,height:0}),settings);
 for(let seed=0;seed<40;seed++){
  const p=createRandomPlan(size,settings,seed,{width:.1,height:0});
  assert.ok(p.width>=900&&p.width<1000);assert.equal(p.height,800);assert.equal(p.shape,settings.shape);assert.equal(p.transitionSoftness,settings.transitionSoftness);
 }
});
