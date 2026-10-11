import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { runBrowserLayout } from "./helpers/browser-layout-runner.mjs";

test("prévia das legendas de ponto, EPI e pagamento acompanha o PDF sem cortar texto", {timeout:90_000}, async t => {
  const browser=[process.env.CHROME_BIN,"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","/usr/bin/google-chrome","/usr/bin/chromium"].find(p=>p&&existsSync(p));
  if(!browser) return t.skip("Chrome indisponível");
  const server=await createServer({root:fileURLToPath(new URL("..",import.meta.url)),server:{host:"127.0.0.1",port:0},logLevel:"silent"});
  try {
    await server.listen();
    // Headless Chrome has a minimum window width on Windows. The narrow
    // fixture uses a 390px document container to exercise the phone caption.
    for(const width of [568,1280]) for(const scale of [.5,1.4,2]) {
      const {stdout}=await runBrowserLayout(browser,{width,height:844,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/signature-caption-readable.html?scale=${scale}`});
      const match=/data-layout="([^"]+)"/.exec(stdout);
      assert.ok(match,"prévia não foi renderizada");
      const data=JSON.parse(match[1].replaceAll("&quot;",'"').replaceAll("&amp;","&"));
      assert.equal(data.viewport,width);
      assert.equal(data.layouts.length,6);
      for(const layout of data.layouts) {
        if(layout.verified) {
          const expectedWidth=Math.min(595*layout.widthRatio*scale,591)*layout.pageWidth/595;
          assert.ok(Math.abs(layout.markerWidth-expectedWidth)<=1, `${layout.kind}: prévia difere do PDF em escala ${scale}`);
          assert.ok(layout.nameTextRight<=layout.sealLeft,`${layout.kind}: nome invade o selo`);
          for(const icon of layout.icons.filter(icon=>icon.kind!=='shield')) {
            assert.ok(icon.height/layout.markerWidth>=.055,`${layout.kind}: ícone ${icon.kind} precisa ser maior`);
          }
          assert.ok(layout.icons.find(icon=>icon.kind==='shield').width/layout.markerWidth>=.10,`${layout.kind}: selo precisa ser maior`);
        }
        assert.equal(new Set(layout.icons.filter(icon=>icon.kind!=='shield').map(icon=>icon.color)).size,3,`${layout.kind}: ícones precisam de cores diferentes`);
        if(!layout.verified) for(const icon of layout.icons) {
          assert.ok(icon.height/layout.markerWidth>=.049,layout.kind+': registro completo também precisa de ícones maiores');
        }
        assert.ok(Math.abs(layout.grid[0]-layout.grid[1])<=1,`${layout.kind}: reservar metade para a legenda`);
        assert.ok(layout.captionScroll<=layout.captionHeight+1,`${layout.kind}: legenda cortada`);
        for(const row of layout.rows) {
          assert.ok(row.scrollHeight<=row.height+1,`${layout.kind}: linha cortada verticalmente ${JSON.stringify(row)}`);
          assert.ok(row.scrollWidth<=row.width+1,`${layout.kind}: texto cortado lateralmente`);
        }
        assert.equal(layout.rows[2].text,layout.verified?'REGISTRO: 0123456789abcdef':'REGISTRO: 0123456789abcdef\n0123456789abcdef');
      }
    }
  } finally { await server.close(); }
});
