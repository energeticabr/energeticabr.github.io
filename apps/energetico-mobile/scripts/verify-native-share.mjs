import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";

const [binary] = process.argv.slice(2);
assert.ok(binary, "Provide the compiled native-share test binary");
let received = 0;
let requests = 0;
const server = createServer((request, response) => {
  requests += 1;
  if (request.method !== "POST" || request.url !== "/upload") {
    response.writeHead(404).end();
    return;
  }
  request.on("data", (chunk) => {
    received += chunk.length;
    request.pause();
    setTimeout(() => request.resume(), 10);
  });
  request.on("end", () => {
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "processed", messages: [] }));
    }, 200);
  });
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const child = spawn(binary, [], {
    stdio: "inherit",
    env: { ...process.env, NATIVE_SHARE_TEST_UPLOAD_URL: `http://127.0.0.1:${server.address().port}/upload` },
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 90_000);
  const [code] = await once(child, "exit");
  clearTimeout(timeout);
  assert.equal(code, 0, "The native Swift tests must pass");
  assert.equal(requests, 1, "Progress must not cause duplicate uploads");
  assert.equal(received, 8 * 1024 * 1024, "The loopback server must receive the exact file bytes");
  console.log("PASS: loopback received one complete native upload, without a production request");
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
