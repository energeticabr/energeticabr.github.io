import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativePorts, NativePermissionError } from '../src/native/native-ports.js';
import { createBrowserPorts } from '../src/web/browser-ports.js';
const jpeg=String.fromCharCode(255,216,255,217),data=btoa(jpeg);

test('native scanner reads confirmed pages in order and releases only its own session',async()=>{
  const released=[],read=[];
  const ports=createNativePorts({documentScanner:{scan:async()=>({id:'session',items:[
    {id:'p1',uri:'file:///scan/1.jpg',name:'pagina-1.jpg',size:4,type:'image/jpeg'},
    {id:'p2',uri:'file:///scan/2.jpg',name:'pagina-2.jpg',size:4,type:'image/jpeg'},
  ]}),release:async x=>released.push(x)},filesystem:{readFile:async({path})=>{read.push(path);return {data};}}});
  assert.equal(typeof ports.scanDocument,'function');
  const files=await ports.scanDocument();
  assert.deepEqual(files.map(f=>[f.name,f.size,f.type]),[['pagina-1.jpg',4,'image/jpeg'],['pagina-2.jpg',4,'image/jpeg']]);
  assert.deepEqual(read,['file:///scan/1.jpg','file:///scan/2.jpg']);assert.deepEqual(released,[{id:'session'}]);
  assert.deepEqual([...new Uint8Array(await files[0].arrayBuffer())],[255,216,255,217]);
});

for(const failure of ['read','metadata','too-many','total'])test(`native scanner ${failure} fails atomically and releases session`,async()=>{
  let released=0;
  const item={id:'1',uri:'file:///scan/a.jpg',name:'a.jpg',size:4,type:'image/jpeg'};
  const items=failure==='too-many'?Array(21).fill(item):failure==='total'?[{...item,size:40_000_000},{...item,size:40_000_000}]:[{...item,type:failure==='metadata'?'application/x-executable':'image/jpeg'}];
  const ports=createNativePorts({documentScanner:{scan:async()=>({id:'owned',items}),release:async()=>released++},filesystem:{readFile:async()=>{if(failure==='read')throw new Error('leitura falhou');return {data};}}});
  assert.equal(typeof ports.scanDocument,'function');await assert.rejects(ports.scanDocument());assert.equal(released,1);
});

test('native scan cancellation never opens photo fallback; unavailable scanner uses local editor',async()=>{
  let photos=0,edits=0;
  const options={camera:{takePhoto:async()=>{photos++;return {uri:'file:///photo',format:'jpeg'};}},fetchImpl:async()=>new Response(new Blob([jpeg],{type:'image/jpeg'})),editScan:async file=>{edits++;return file;}};
  const cancelled=createNativePorts({...options,documentScanner:{scan:async()=>({items:[]})}});
  assert.equal(typeof cancelled.scanDocument,'function');assert.deepEqual(await cancelled.scanDocument(),[]);assert.equal(photos,0);
  for(const code of ['SCAN_UNSUPPORTED','UNIMPLEMENTED']){
    const ports=createNativePorts({...options,documentScanner:{scan:async()=>{throw Object.assign(new Error('unavailable'),{code});}}});
    assert.equal((await ports.scanDocument()).length,1);
  }
  assert.equal(photos,2);assert.equal(edits,2);
});

test('scanner permission failures remain visible and are not silently converted into photos',async()=>{
  let photos=0;const ports=createNativePorts({documentScanner:{scan:async()=>{throw Object.assign(new Error('camera denied'),{code:'CAMERA_PERMISSION_DENIED'});}},camera:{takePhoto:async()=>photos++}});
  assert.equal(typeof ports.scanDocument,'function');await assert.rejects(ports.scanDocument(),NativePermissionError);assert.equal(photos,0);
});

test('web scan captures one image, returns only confirmed crop and preserves normal photo path',async()=>{
  const original=new File(['original'],'foto.jpg',{type:'image/jpeg'}),cropped=new File(['recorte'],'scan.jpg',{type:'image/jpeg'});
  const calls=[];let confirm=true;
  const ports=createBrowserPorts({selectFiles:async options=>{calls.push(options);return [original];},editScan:async file=>{assert.equal(file,original);return confirm?cropped:null;}});
  assert.equal(typeof ports.scanDocument,'function');assert.deepEqual(await ports.scanDocument(),[cropped]);
  confirm=false;assert.deepEqual(await ports.scanDocument(),[]);assert.deepEqual(await ports.capturePhoto(),[original]);
  assert.ok(calls.every(c=>c.capture==='environment'&&c.multiple===false));
});

test('web camera cancellation never opens the corner editor',async()=>{
  let edits=0;const ports=createBrowserPorts({selectFiles:async()=>[],editScan:async()=>edits++});
  assert.equal(typeof ports.scanDocument,'function');assert.deepEqual(await ports.scanDocument(),[]);assert.equal(edits,0);
});
