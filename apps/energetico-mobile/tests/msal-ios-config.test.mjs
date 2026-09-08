import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("native app declares both query schemes required for MSAL broker initialization", async () => {
  const xml = await readFile(new URL("../ios/App/App/Info.plist", import.meta.url), "utf8");
  const dom = new JSDOM(xml, { contentType: "text/xml" });
  try {
    const dict = dom.window.document.querySelector("plist > dict");
    const key = [...dict.children].find(node => node.tagName === "key" && node.textContent === "LSApplicationQueriesSchemes");
    const value = key?.nextElementSibling;
    assert.equal(value?.tagName, "array", "MSAL requires LSApplicationQueriesSchemes in Info.plist");
    const schemes = [...value.children].map(node => node.textContent);
    for (const required of ["msauthv2", "msauthv3"]) {
      assert.ok(schemes.includes(required), `Missing required MSAL query scheme: ${required}`);
    }
  } finally {
    dom.window.close();
  }
});
