import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, type RenderRequest } from '../src/types';
import { normalizeLocalEdit } from '../src/localTypes';
import { recommendedExportSize, fitLongEdge, validateExportSize, type PixelSize } from '../src/exportSize';
import { workingImageSize } from '../src/io';
import { renderImage } from '../src/engine/retarget';

function gradientRequest(): RenderRequest {
  const width = 63, height = 47;
  const data = new Uint8ClampedArray(width * height * 4);
  const mask = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      data.set([x * 4, y * 5, (x * y) % 255, 255], i * 4);
      mask[i] = x > 18 && x < 39 ? 1 : 0;
    }
  }
  return {
    image: {width, height, data}, mask, maskWidth: width, maskHeight: height,
    settings: {...DEFAULT_SETTINGS, width: 113, height: 81, quality: 'draft'},
    localEdits: [normalizeLocalEdit({id: 'arm', cx: .51, cy: .52, rx: .4, ry: .3,
      angle: .71, scaleX: 1.6, scaleY: .77})],
  };
}

test('recommended size fits large canvases, retains small ones and preserves extremely thin outputs', () => {
  assert.deepEqual(recommendedExportSize({width:8192,height:8192}), {width:2048,height:2048});
  assert.deepEqual(recommendedExportSize({width:400,height:601}), {width:400,height:601});
  assert.deepEqual(fitLongEdge({width:1,height:8192}, 256), {width:1,height:256});
  assert.deepEqual(fitLongEdge({width:100,height:200}, 540), {width:270,height:540});
});

test('width, height and area limits refer to the encoded file', () => {
  for (const size of [{width:0,height:2},{width:3,height:-1},{width:1.4,height:22},
    {width:NaN,height:1},{width:1,height:Infinity},{width:8193,height:1},{width:8192,height:8192}]) {
    assert.ok(validateExportSize(size));
  }
  assert.equal(validateExportSize({width:6000,height:4000}), null);
  assert.equal(validateExportSize({width:8192,height:1}), null);
});

test('a 67 MP stretched canvas renders only the requested PNG pixel buffer', () => {
  const request = gradientRequest();
  request.settings = {...request.settings, width:8192, height:8192, contentAmount:0, shape:'ellipse'};
  const outputSize = {width:239,height:137};
  const {image} = renderImage({...request, outputSize});
  assert.equal(image.width, outputSize.width);
  assert.equal(image.height, outputSize.height);
  assert.equal(image.data.byteLength, 239 * 137 * 4);
  assert.equal(image.data[3], 0);
  assert.equal(image.data[((68 * 239) + 119) * 4 + 3], 255);
  assert.throws(() => renderImage(request), /2400 万/);
  assert.throws(() => renderImage({...request, outputSize:{width:3.5,height:5}}), /整数/);
});

test('independent export dimensions retain protected seams and the local angle even at a different aspect ratio', () => {
  const request = gradientRequest();
  const native = renderImage(request).image;
  const custom = renderImage({...request, outputSize:{width:57,height:21}}).image;
  const asNewGeometry = renderImage({...request, settings:{...request.settings,width:57,height:21}}).image;
  for (let y = 0; y < custom.height; y++) {
    for (let x = 0; x < custom.width; x++) {
      const from = (4*y*native.width + 2*x)*4;
      const to = (y*custom.width + x)*4;
      assert.deepEqual(custom.data.subarray(to,to+4),native.data.subarray(from,from+4));
    }
  }
  assert.notDeepEqual(custom.data,asNewGeometry.data);
});

test('oversized photo dimensions are bounded ahead of the RGBA working buffer', () => {
  const cases:PixelSize[] = [
    {width:9000,height:7000}, {width:400,height:32000}, {width:80000,height:1},
  ];
  for (const original of cases) {
    const work = workingImageSize(original);
    assert.ok(work.width * work.height <= 12_000_000);
    assert.ok(Math.max(work.width, work.height) <= 8192);
    assert.ok(Math.min(work.width, work.height) >= 1);
  }
  assert.deepEqual(workingImageSize({width:100,height:200}), {width:100,height:200});
});
