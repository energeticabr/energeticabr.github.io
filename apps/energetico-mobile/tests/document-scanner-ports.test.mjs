import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativePorts, NativePermissionError } from '../src/native/native-ports.js';
import { createBrowserPorts } from '../src/web/browser-ports.js';
import { PDFDocument, PDFDict, PDFName, PDFRawStream } from 'pdf-lib';
import { scannedPages } from './helpers/scanned-pages.mjs';
import { getDocument, OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
const jpeg=String.fromCharCode(255,216,255,217),data=btoa(jpeg);

// Returning separate images, losing a page, recompressing or reordering them must fail.
test('one confirmed multi-page scan returns one PDF with each original JPEG on its own page in order',async()=>{
  const fixture=await scannedPages([[[80,120,'red'],[160,90,'blue']]]);
  const ports=createNativePorts(fixture);
  const files=await ports.scanDocument();
  assert.equal(files.length,1,'um check com duas páginas deve gerar somente um anexo');
  assert.equal(files[0].type,'application/pdf');assert.match(files[0].name,/\.pdf$/i);
  const pdf=await PDFDocument.load(await files[0].arrayBuffer());
  assert.equal(pdf.getPageCount(),2);
  for(const [index,dimensions] of [[80,120],[160,90]].entries()){
    const page=pdf.getPage(index);
    assert.ok(Math.abs(page.getWidth()/page.getHeight()-dimensions[0]/dimensions[1])<0.0001,'preservar proporção e orientação');
    const resources=page.node.Resources().lookup(PDFName.of('XObject'),PDFDict);
    const images=resources.entries().map(([,ref])=>pdf.context.lookup(ref)).filter(x=>x instanceof PDFRawStream&&x.dict.get(PDFName.of('Subtype'))?.toString()==='/Image');
    assert.equal(images.length,1,'uma imagem por página');
    assert.deepEqual(Buffer.from(images[0].contents),fixture.bytes.get(`file:///scan/1/${index+1}.jpg`),'preservar JPEG, qualidade e ordem');
  }
  assert.deepEqual(fixture.read,['file:///scan/1/1.jpg','file:///scan/1/2.jpg']);
  assert.deepEqual(fixture.released,[{id:'scan-session-1'}]);
});

test('successive scanner checks create separate PDFs with unique attachment IDs and names',async()=>{
  const fixture=await scannedPages([[[80,120,'red'],[160,90,'blue']],[[70,110,'green'],[90,130,'yellow'],[100,140,'purple']]]);
  let sequence=0;const ports=createNativePorts({...fixture,randomUUID:()=>`pdf-${++sequence}`});
  const [first]=await ports.scanDocument(),[second]=await ports.scanDocument();
  assert.equal(first.type,'application/pdf');assert.equal(second.type,'application/pdf');
  assert.notEqual(first.id,second.id);assert.notEqual(first.name,second.name);
  assert.equal((await PDFDocument.load(await first.arrayBuffer())).getPageCount(),2);
  const secondPdf=await PDFDocument.load(await second.arrayBuffer());
  assert.equal(secondPdf.getPageCount(),3);
  assert.ok(Math.abs(secondPdf.getPage(0).getWidth()/secondPdf.getPage(0).getHeight()-70/110)<0.0001,'não incluir a sessão anterior');
  assert.deepEqual(fixture.released,[{id:'scan-session-1'},{id:'scan-session-2'}]);
});

test('a single confirmed scan stays the same JPEG instead of becoming a PDF',async()=>{
  const fixture=await scannedPages([[[80,120,'red']]]),ports=createNativePorts(fixture);
  const [file]=await ports.scanDocument();
  assert.deepEqual([file.name,file.type,file.id],['documento-1.jpg','image/jpeg','scan-1-1']);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()),fixture.bytes.get('file:///scan/1/1.jpg'));
  assert.deepEqual(fixture.released,[{id:'scan-session-1'}]);
});

test('a corrupt second scan page rejects the whole PDF and releases the native session',async()=>{
  const fixture=await scannedPages([[[80,120,'red'],[160,90,'blue']]]);
  fixture.bytes.set('file:///scan/1/2.jpg',Buffer.from('not-a-jpeg'));
  fixture.results[0].items[1].size=10;
  await assert.rejects(createNativePorts(fixture).scanDocument());
  assert.deepEqual(fixture.released,[{id:'scan-session-1'}]);
});

// EXIF describes display orientation, not encoded dimensions. Ignoring a tag or
// using the wrong rotation/reflection must fail on the actual PDF paint matrix.
for(const [orientation,expected] of [
  [1,[1,0,0,1,0,0]],[2,[-1,0,0,1,1,0]],[3,[-1,0,0,-1,1,1]],[4,[1,0,0,-1,0,1]],
  [5,[0,-1,-1,0,1,1]],[6,[0,-1,1,0,0,1]],[7,[0,1,1,0,0,0]],[8,[0,1,-1,0,1,0]],
])test(`scanner PDF preserves EXIF orientation ${orientation} losslessly from native base64`,async()=>{
  const fixture=await scannedPages([[[80,120,'red',orientation],[80,120,'blue',orientation]]]);
  const [file]=await createNativePorts(fixture).scanDocument();
  const bytes=new Uint8Array(await file.arrayBuffer()),pdf=await PDFDocument.load(bytes);
  const task=getDocument({data:bytes.slice()}),viewer=await task.promise;
  try{
    for(let number=1;number<=2;number++){
      const page=await viewer.getPage(number),ops=await page.getOperatorList(),stack=[],painted=[];
      let matrix=[1,0,0,1,0,0];
      for(let index=0;index<ops.fnArray.length;index++){
        const fn=ops.fnArray[index],args=ops.argsArray[index];
        if(fn===OPS.save)stack.push(matrix.slice());
        else if(fn===OPS.restore)matrix=stack.pop();
        else if(fn===OPS.transform)matrix=Util.transform(matrix,args);
        else if(fn===OPS.paintImageXObject)painted.push(matrix.slice());
      }
      assert.equal(painted.length,1);
      const width=page.view[2],height=page.view[3];
      assert.ok(Math.abs(width/height-(orientation>=5?120/80:80/120))<0.0001,'preservar dimensões de exibição');
      painted[0].map((value,index)=>value/(index%2?height:width)).forEach((value,index)=>assert.ok(Math.abs(value-expected[index])<0.0001,`matriz EXIF ${orientation}: ${painted[0]}`));
      const resources=pdf.getPage(number-1).node.Resources().lookup(PDFName.of('XObject'),PDFDict);
      const image=pdf.context.lookup(resources.entries()[0][1]);
      assert.deepEqual(Buffer.from(image.contents),fixture.bytes.get(`file:///scan/1/${number}.jpg`),'não recomprimir para girar');
    }
  }finally{await task.destroy();}
});

test('native base64 scanner accepts twenty pages as a single twenty-page PDF',async()=>{
  const fixture=await scannedPages([Array.from({length:20},()=>[80,120,'red'])]);
  const files=await createNativePorts(fixture).scanDocument();
  assert.equal(files.length,1);assert.equal(files[0].type,'application/pdf');
  assert.equal((await PDFDocument.load(await files[0].arrayBuffer())).getPageCount(),20);
  assert.deepEqual(fixture.released,[{id:'scan-session-1'}]);
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
