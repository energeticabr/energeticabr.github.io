// Shared measured text column: the seal never shares space with metadata.
function wrapText(text, size, width, measure) {
  const lines=[];
  for(const paragraph of String(text).split('\n')) {
    let line='';
    for(const word of paragraph.split(/\s+/).filter(Boolean)) {
      const combined=line ? `${line} ${word}` : word;
      if(measure(combined,size)<=width) { line=combined; continue; }
      if(line) { lines.push(line); line=''; }
      for(const character of word) {
        if(measure(line+character,size)>width && line) { lines.push(line); line=''; }
        line+=character;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function layoutSignatureMetadata({width, captionHeight, labels, measure}) {
  const inset=Math.max(2,width*.018);
  const availableHeight=captionHeight-inset*2;
  const iconSize=Math.min(width*.07,availableHeight/labels.length);
  const textX=inset+iconSize+width*.02;
  const sealX=width-inset-width*.21;
  const dividerX=sealX-inset*.5;
  const textWidth=dividerX-textX-width*.035;
  let size=Math.min(12,width*.042), rows;
  // Wrap first, then reduce uniformly only if the complete footer is too tall.
  do {
    rows=labels.map(label=>{
      const lines=wrapText(label,size,textWidth,measure);
      return {lines,height:Math.max(iconSize,lines.length*size*1.15)};
    });
    if(rows.reduce((sum,row)=>sum+row.height,0)<=availableHeight) break;
    size*=.96;
  } while(size>.1);
  const extra=(availableHeight-rows.reduce((sum,row)=>sum+row.height,0))/rows.length;
  return {inset,iconSize,textX,textWidth,sealX,dividerX,size,
    rows:rows.map(row=>({...row,height:row.height+extra}))};
}
