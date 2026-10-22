import test from 'node:test';
import assert from 'node:assert/strict';
import { jpegOrientation } from '../src/native/jpeg-orientation.js';

// Independent TIFF fixtures: orientation SHORT=6, one IFD0 entry, both byte orders.
const little=Buffer.from('ffd8ffe1002245786966000049492a0008000000010012010300010000000600000000000000ffd9','hex');
const big=Buffer.from('ffd8ffe100224578696600004d4d002a00000008000101120003000000010006000000000000ffd9','hex');
for(const [name,bytes] of [['little-endian',little],['big-endian',big]]){
  test(`scanner reads ${name} EXIF even inside a sliced native buffer`,()=>{
    const framed=Buffer.concat([Buffer.from('prefix'),bytes,Buffer.from('suffix')]);
    assert.equal(jpegOrientation(framed.subarray(6,6+bytes.length)),6);
  });
}

test('scanner skips non-EXIF metadata before the orientation segment',()=>{
  const bytes=Buffer.concat([little.subarray(0,2),Buffer.from('ffe1000661626364','hex'),little.subarray(2)]);
  assert.equal(jpegOrientation(bytes),6);
});

for(const [name,change] of [
  ['segment outside buffer',bytes=>bytes.writeUInt16BE(65535,4)],
  ['invalid segment length',bytes=>bytes.writeUInt16BE(1,4)],
  ['invalid TIFF byte order',bytes=>bytes.writeUInt16BE(0,12)],
  ['invalid TIFF magic',bytes=>bytes.writeUInt16LE(0,14)],
  ['directory outside metadata',bytes=>bytes.writeUInt32LE(0xffffffff,16)],
  ['directory overlaps TIFF header',bytes=>bytes.writeUInt32LE(0,16)],
  ['wrong tag type',bytes=>bytes.writeUInt16LE(4,24)],
  ['wrong value count',bytes=>bytes.writeUInt32LE(2,26)],
  ['zero orientation',bytes=>bytes.writeUInt16LE(0,30)],
  ['unknown orientation',bytes=>bytes.writeUInt16LE(9,30)],
])test(`scanner safely defaults upright for ${name}`,()=>{
  const bytes=Buffer.from(little);change(bytes);
  assert.equal(jpegOrientation(bytes),1);
});

test('scanner defaults upright for every truncated EXIF prefix without reading past the buffer',()=>{
  for(let length=0;length<little.length-2;length++)assert.equal(jpegOrientation(little.subarray(0,length)),1,`length=${length}`);
  assert.equal(jpegOrientation(Buffer.from('not-a-jpeg')),1);
});
