// Local-only perspective correction. Coordinates are clockwise TL, TR, BR, BL.
export function validDocumentCorners(corners) {
  if (!Array.isArray(corners) || corners.length !== 4
    || corners.some(p => !Number.isFinite(p?.x) || !Number.isFinite(p?.y)
      || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false;
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
    if ((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x) <= 0.0001
      || Math.hypot(b.x-a.x,b.y-a.y) < 0.03) return false;
    area += a.x*b.y-b.x*a.y;
  }
  return area > 0.02;
}

function solve(matrix) {
  const n = matrix.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col+1; row < n; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    [matrix[col],matrix[pivot]] = [matrix[pivot],matrix[col]];
    const divisor = matrix[col][col];
    if (Math.abs(divisor) < 1e-10) throw new Error('Ajuste as bordas do documento.');
    for (let j = col; j <= n; j++) matrix[col][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = matrix[row][col];
      for (let j = col; j <= n; j++) matrix[row][j] -= factor*matrix[col][j];
    }
  }
  return matrix.map(row => row[n]);
}

export function rectifyDocument(source, corners, { maxEdge = 2400 } = {}) {
  if (!validDocumentCorners(corners)) throw new Error('Ajuste as bordas do documento.');
  const { width: sw, height: sh, data } = source;
  if (!Number.isInteger(sw) || !Number.isInteger(sh) || sw < 2 || sh < 2
    || sw*sh > 24_000_000 || data?.length !== sw*sh*4) throw new Error('Imagem inválida ou muito grande para escanear.');
  const points = corners.map(p => ({x:p.x*(sw-1),y:p.y*(sh-1)}));
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  let width = Math.round(Math.max(distance(points[0],points[1]),distance(points[3],points[2])))+1;
  let height = Math.round(Math.max(distance(points[0],points[3]),distance(points[1],points[2])))+1;
  const cap = Math.min(2400, Math.max(2, Number(maxEdge) || 2400));
  const scale = Math.min(1,cap/Math.max(width,height));
  width = Math.max(2,Math.floor(width*scale)); height = Math.max(2,Math.floor(height*scale));
  const matrix = [];
  [[0,0],[1,0],[1,1],[0,1]].forEach(([u,v],i) => {
    const {x,y} = points[i];
    matrix.push([u,v,1,0,0,0,-u*x,-v*x,x]);
    matrix.push([0,0,0,u,v,1,-u*y,-v*y,y]);
  });
  const h = solve(matrix), output = new Uint8ClampedArray(width*height*4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u=x/(width-1),v=y/(height-1),d=h[6]*u+h[7]*v+1;
    const sx=Math.max(0,Math.min(sw-1,(h[0]*u+h[1]*v+h[2])/d));
    const sy=Math.max(0,Math.min(sh-1,(h[3]*u+h[4]*v+h[5])/d));
    const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1);
    const fx=sx-x0,fy=sy-y0,index=(y*width+x)*4;
    for(let c=0;c<3;c++) output[index+c] = data[(y0*sw+x0)*4+c]*(1-fx)*(1-fy)
      +data[(y0*sw+x1)*4+c]*fx*(1-fy)+data[(y1*sw+x0)*4+c]*(1-fx)*fy+data[(y1*sw+x1)*4+c]*fx*fy;
    output[index+3]=255;
  }
  return {width,height,data:output};
}

export function suggestDocumentCorners({width,height,data}) {
  const fallback = { detected:false, corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] };
  if (width < 2 || height < 2 || width*height > 100_000 || data?.length !== width*height*4) return fallback;
  const visited = new Uint8Array(width*height), queue = new Int32Array(width*height);
  let largest = [];
  const bright = i => data[i*4]*0.2126+data[i*4+1]*0.7152+data[i*4+2]*0.0722 > 170;
  for (let start=0;start<visited.length;start++) {
    if (visited[start] || !bright(start)) continue;
    let head=0,tail=1; queue[0]=start;visited[start]=1;
    while(head<tail) {
      const i=queue[head++],x=i%width,y=Math.floor(i/width);
      for (const next of [x>0?i-1:-1,x<width-1?i+1:-1,y>0?i-width:-1,y<height-1?i+width:-1]) {
        if(next<0 || visited[next] || !bright(next)) continue;
        visited[next]=1;queue[tail++]=next;
      }
    }
    if(tail>largest.length) largest=Array.from(queue.subarray(0,tail));
  }
  if(largest.length<width*height*0.1 || largest.length>width*height*0.9) return fallback;
  const points=largest.map(i=>({x:(i%width)/(width-1),y:Math.floor(i/width)/(height-1)}));
  const extreme = score => points.reduce((a,b)=>score(b)>score(a)?b:a);
  const corners=[extreme(p=>-p.x-p.y),extreme(p=>p.x-p.y),extreme(p=>p.x+p.y),extreme(p=>p.y-p.x)];
  return validDocumentCorners(corners) ? {detected:true,corners} : fallback;
}
