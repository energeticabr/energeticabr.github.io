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
    for(const width of [568,1280]) {
      const {stdout}=await runBrowserLayout(browser,{width,height:844,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/signature-caption-readable.html`});
      const match=/data-layout="([^"]+)"/.exec(stdout);
      assert.ok(match,"prévia não foi renderizada");
      const data=JSON.parse(match[1].replaceAll("&quot;",'"').replaceAll("&amp;","&"));
      assert.equal(data.viewport,width);
      assert.equal(data.layouts.length,3);
      for(const layout of data.layouts) {
        assert.ok(Math.abs(layout.grid[0]-layout.grid[1])<=1,`${layout.kind}: reservar metade para a legenda`);
        assert.ok(layout.captionScroll<=layout.captionHeight+1,`${layout.kind}: legenda cortada`);
        for(const row of layout.rows) {
          assert.ok(row.scrollHeight<=row.height+1,`${layout.kind}: linha cortada verticalmente`);
          assert.ok(row.scrollWidth<=row.width+1,`${layout.kind}: texto cortado lateralmente`);
        }
        assert.match(layout.rows[2].text,/REGISTRO: 0123456789abcdef\n0123456789abcdef/);
      }
    }
  } finally { await server.close(); }
});
