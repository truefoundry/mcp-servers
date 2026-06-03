/**
 * Smoke test: boots the real server in a child process and exercises the
 * transport-level contract (health + bearer enforcement) end to end.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 38123;
const BASE = `http://127.0.0.1:${PORT}`;

/** Start src/index.js and resolve once it logs that it's listening. */
async function startServer() {
  const proc = spawn(process.execPath, ["src/index.js"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });

  const ready = new Promise((resolve, reject) => {
    proc.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("listening")) resolve();
    });
    proc.once("error", reject);
    proc.once("exit", (code) =>
      reject(new Error(`server exited early with code ${code}`)),
    );
  });

  await Promise.race([
    ready,
    delay(5000).then(() => Promise.reject(new Error("server did not start in time"))),
  ]);
  return proc;
}

test("health and bearer enforcement", async (t) => {
  const proc = await startServer();
  t.after(() => proc.kill());

  await t.test("GET /health is 200 ok", async () => {
    const res = await fetch(`${BASE}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
  });

  await t.test("POST /mcp without a token is 401 / -32001", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, -32001);
  });

  await t.test("GET /mcp is 405 (POST-only endpoint)", async () => {
    const res = await fetch(`${BASE}/mcp`);
    assert.equal(res.status, 405);
  });
});
