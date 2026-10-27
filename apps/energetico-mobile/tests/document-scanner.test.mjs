import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const geometry = await import('../src/web/document-scanner.js').catch(() => ({}));
const ui = await import('../src/ui/document-scanner.js').catch(() => ({}));
const full = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];

test('crop rejects crossed, collapsed and out-of-bounds corners', () => {
  assert.equal(typeof geometry.validDocumentCorners, 'function');
  assert.equal(geometry.validDocumentCorners(full), true);
  for (const corners of [[full[0],full[2],full[1],full[3]], full.map(()=>({x:0.5,y:0.5})),
    [{x:-0.1,y:0},...full.slice(1)], [{x:NaN,y:0},...full.slice(1)]]) {
    assert.equal(geometry.validDocumentCorners(corners), false);
  }
});

test('perspective correction preserves identity pixels and removes an outer frame', () => {
  assert.equal(typeof geometry.rectifyDocument, 'function');
  const data = new Uint8ClampedArray(8*8*4);
  for(let y=0;y<8;y++) for(let x=0;x<8;x++) data.set([x*30,y*30,80,255],(y*8+x)*4);
  const source={width:8,height:8,data};
  const identity=geometry.rectifyDocument(source,full);
  assert.equal(identity.width,8); assert.equal(identity.height,8);
  assert.deepEqual(identity.data,data);
  const crop=geometry.rectifyDocument(source,[{x:2/7,y:1/7},{x:5/7,y:1/7},{x:5/7,y:6/7},{x:2/7,y:6/7}]);
  assert.equal(crop.width,4); assert.equal(crop.height,6);
  assert.deepEqual([...crop.data.slice(0,4)],[60,30,80,255]);
  assert.deepEqual([...crop.data.slice(-4)],[150,180,80,255]);
  assert.throws(()=>geometry.rectifyDocument(source,[full[0],full[2],full[1],full[3]]), /bordas/i);
});

test('perspective maps all four corners of a trapezoid and caps output allocation', () => {
  assert.equal(typeof geometry.rectifyDocument,'function');
  const data=new Uint8ClampedArray(10*10*4);
  for(let y=0;y<10;y++) for(let x=0;x<10;x++) data.set([x*20,y*20,0,255],(y*10+x)*4);
  const result=geometry.rectifyDocument({width:10,height:10,data},[{x:2/9,y:0},{x:7/9,y:0},{x:1,y:1},{x:0,y:1}],{maxEdge:6});
  assert.ok(result.width<=6&&result.height<=6);
  assert.deepEqual([...result.data.slice(0,4)],[40,0,0,255]);
  assert.deepEqual([...result.data.slice((result.width-1)*4,result.width*4)],[140,0,0,255]);
  assert.deepEqual([...result.data.slice(-4)],[180,180,0,255]);
});

test('light-page suggestion finds a synthetic page and never claims a uniform image was detected', () => {
  assert.equal(typeof geometry.suggestDocumentCorners,'function');
  const data=new Uint8ClampedArray(100*100*4);
  for(let y=0;y<100;y++) for(let x=0;x<100;x++) data.set([...(x>=20&&x<=80&&y>=15&&y<=85?[240,240,240]:[35,35,35]),255],(y*100+x)*4);
  const result=geometry.suggestDocumentCorners({width:100,height:100,data});
  assert.equal(result.detected,true);
  assert.ok(Math.abs(result.corners[0].x-20/99)<0.02);
  assert.ok(Math.abs(result.corners[2].y-85/99)<0.02);
  data.fill(255);
  assert.equal(geometry.suggestDocumentCorners({width:100,height:100,data}).detected,false);
});

function domSetup(t){
  const dom=new JSDOM('<button id="camera">Câmera</button>');
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
  t.after(()=>dom.window.close());return dom;
}

test('camera chooser offers gallery first, then photo/scan, cancellation resolves empty and returns focus', async t => {
  assert.equal(typeof ui.createCameraChooser,'function');
  const dom=domSetup(t),doc=dom.window.document;
  const chooser=ui.createCameraChooser(doc);t.after(()=>chooser.destroy());
  doc.querySelector('#camera').focus();
  let pending=chooser.choose();
  const choices=[...doc.querySelectorAll('[data-camera-mode]')];
  assert.deepEqual(choices.map(button=>button.dataset.cameraMode),['gallery','photo','scan','cancel']);
  assert.equal(choices[0].textContent,'🖼️ ESCOLHER FOTO GALERIA');
  assert.equal(doc.activeElement,choices[0]);
  choices[0].click();assert.equal(await pending,'gallery');assert.equal(doc.activeElement.id,'camera');
  pending=chooser.choose();
  assert.match(doc.querySelector('dialog').textContent,/Escanear/);
  doc.querySelector('[data-camera-mode="scan"]').click();
  assert.equal(await pending,'scan');assert.equal(doc.activeElement.id,'camera');
  pending=chooser.choose();doc.querySelector('[data-camera-mode="photo"]').click();
  assert.equal(await pending,'photo');
  pending=chooser.choose();doc.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel',{cancelable:true}));
  assert.equal(await pending,null);
  pending=chooser.choose();chooser.destroy();assert.equal(await pending,null);
  assert.equal(doc.querySelector('dialog'),null);
});
