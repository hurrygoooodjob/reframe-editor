import test from 'node:test';
import assert from 'node:assert/strict';
import { createEffect } from '../src/effects/catalog';
import {
  beginLayerBrush, createEffectLayer, createLayerMask, decodeEffectLayers, encodeEffectLayers,
  MAX_EFFECT_LAYERS, migrateSingleEffect, stampLayerBrush, type EffectLayer,
} from '../src/effects/layers';
import { renderEffectLayers } from '../src/effects/composite';

const geometry = {width:900, height:450};
function layer(name: string): EffectLayer {
  return createEffectLayer(createEffect(name)!);
}

// The actual pixel-only effect kernels need ImageData but never call Canvas2D.
if (!globalThis.ImageData) {
  class NodeImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(pixels: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
      this.width = typeof pixels === 'number' ? pixels : widthOrHeight;
      this.height = typeof pixels === 'number' ? widthOrHeight : height!;
      this.data = typeof pixels === 'number' ? new Uint8ClampedArray(4 * this.width * this.height) : pixels;
    }
  }
  Object.defineProperty(globalThis, 'ImageData', {value:NodeImageData});
}

function source(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data.set([(i * 17) % 255, (i + 128) % 255, 200, i % 3 ? 255 : 72], i);
  }
  data[3] = 0;
  return {width, height, data};
}

test('every effect consumes the actual output of the preceding layer, including its strength', () => {
  const input = source(21, 9), original = input.data.slice();
  const a = layer('thermal'), b = layer('dither');
  a.effect = {...a.effect, strength:45};
  const first = renderEffectLayers(input, [a], geometry);
  const chained = renderEffectLayers(first, [b], geometry);
  const ordered = renderEffectLayers(input, [a, b], geometry);
  assert.deepEqual(ordered.data, chained.data);
  assert.notDeepEqual(ordered.data, renderEffectLayers(input, [b, a], geometry).data);
  assert.deepEqual(renderEffectLayers(input, [a, {...b, effect:{...b.effect, strength:0}}], geometry).data, first.data);
  assert.deepEqual(input.data, original);
  for (let i = 3; i < input.data.length; i += 4) assert.equal(ordered.data[i], input.data[i]);
});

test('partial erasure reveals precisely this layer input, feathering at target pixel centers', () => {
  const bottom = layer('thermal'), top = layer('dither');
  top.mask = {width:2, height:1, data:Uint8Array.of(0,255)};
  for (const [width,height] of [[4,2], [431,29], [9,101], [1,5]]) {
    const input = source(width,height);
    const under = renderEffectLayers(input,[bottom],geometry);
    const full = renderEffectLayers(input,[bottom,{...top,mask:undefined}],geometry);
    const masked = renderEffectLayers(input,[bottom,top],geometry);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const amount = Math.max(0,Math.min(1,(x+.5)*2/width-.5));
      const i=(y*width+x)*4;
      for(let c=0;c<3;c++){
        const expected=under.data[i+c]+amount*(full.data[i+c]-under.data[i+c]);
        assert.ok(Math.abs(masked.data[i+c]-expected)<=.50000001);
      }
      assert.equal(masked.data[i+3],input.data[i+3]);
    }
  }
});

test('brushes follow logical proportions, can restore, and never change an undo snapshot', () => {
  const original = createLayerMask({width:32768,height:8192});
  assert.deepEqual([original.width,original.height],[1024,256]);
  const stroke = beginLayerBrush(original,geometry);
  const center = {x:.5, y:.5},radius={x:.06,y:.24};
  stampLayerBrush(stroke,center,radius,.3,'erase');
  const actual = stroke.mask.data.slice();
  assert.equal(actual[128 * 1024 + 512],0);
  assert.ok(actual.some(v=>v>0&&v<255));
  assert.equal(actual[15],255);
  stampLayerBrush(stroke,center,radius,.3,'erase');
  assert.deepEqual(stroke.mask.data,actual);
  assert.ok(original.data.every(v=>v===255));
  const restore=beginLayerBrush(stroke.mask,geometry);
  stampLayerBrush(restore,center,{x:.02,y:.08},.8,'restore');
  assert.equal(restore.mask.data[128*1024+512],255);
  assert.deepEqual(stroke.mask.data,actual);
});

test('project round-trip preserves order, repeated effect types, IDs and exact mask byte weights', () => {
  const a=layer('thermal'),b=layer('thermal'),c=layer('dither');
  assert.notEqual(a.id,b.id);
  a.mask=createLayerMask({width:1024,height:256});
  a.mask.data.fill(11,1200,2000); // long runs, including one past the 16-bit span limit
  b.mask={width:20,height:10,data:Uint8Array.from({length:200},(_,i)=>i)};
  const json=encodeEffectLayers([b,a,c]);
  assert.equal(json[0].mask?.encoding,'raw');
  assert.equal(json[1].mask?.encoding,'rle16');
  assert.deepEqual(decodeEffectLayers(JSON.parse(JSON.stringify(json))),[b,a,c]);
  assert.deepEqual(migrateSingleEffect(null),[]);
  const legacy=layer('ascii').effect;
  assert.deepEqual(migrateSingleEffect(legacy)[0].effect,legacy);
});

test('invalid projects cannot silently apply an invalid erasure mask or reuse a layer ID', () => {
  const a=layer('dither');
  assert.throws(()=>decodeEffectLayers([a,a]));
  assert.throws(()=>decodeEffectLayers([{...a,effect:{id:'missing'}}]));
  assert.throws(()=>decodeEffectLayers(Array.from({length:MAX_EFFECT_LAYERS+1},()=>layer('dither'))));
  const bad = (mask:unknown) => assert.throws(()=>decodeEffectLayers([{...a,mask}]));
  bad({width:32768,height:32768,encoding:'raw',data:'Ag=='});
  bad({width:1,height:3,encoding:'rle16',data:'AAAA'}); // zero length run
  bad({width:1,height:4,encoding:'rle16',data:'AAUO'}); // overflow
  bad({width:1,height:4,encoding:'rle16',data:'AAIO'}); // underflow
  bad({width:2,height:4,encoding:'raw',data:'AAAA'});
});
