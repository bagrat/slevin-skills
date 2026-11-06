#!/usr/bin/env node
// Tests .claude/skills/relay/poll.sh against a tiny local stub of the app's HTTP door.
//
//   node scripts/test-poll.mjs
//
// It checks that the loop: refuses to run without APP_HOST or APP_BASE; refuses a header file that
// isn't mode 600; keeps polling on "none" but never busy-loops (pollAgain 0 answered at once waits
// at least 2 s); honours POLL_DELAY; exits with one line on a wake or a refusal; refuses a second
// loop on the same header file; gives up with pollFailed after 5 network errors; and stops at once
// on TERM, leaving no temp files.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const script = join(root, ".claude/skills/relay/poll.sh");
const dir = mkdtempSync(join(tmpdir(), "poll-test-"));
const header = join(dir, "header");
writeFileSync(header, "Authorization: Bearer test-attachment\n");
chmodSync(header, 0o600);

// The stub: each test sets `answer`, a function from the poll count to [status, body, delayMs].
let polls = [];
let answer = () => [200, { none: true, pollAgain: 0 }, 0];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const auth = req.headers.authorization;
    polls.push({ at: Date.now(), path: req.url, auth });
    const [status, json, delay] = answer(polls.length);
    setTimeout(() => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    }, delay);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const tmpBefore = new Set(readdirSync(tmpdir()));
function run(env = {}, args = [header]) {
  const child = spawn("bash", [script, ...args], {
    env: { PATH: process.env.PATH, HOME: dir, NO_PROXY: "*", no_proxy: "*", ...env },
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const done = new Promise((r) => child.on("exit", (code, signal) => r({ code, signal, out, err })));
  return { child, done };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
async function test(name, fn) {
  polls = [];
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (e) {
    results.push(`✗ ${name}: ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

await test("refuses to run without APP_HOST or APP_BASE", async () => {
  const r = await run().done;
  assert(r.code === 2, `exit ${r.code}`);
  assert(/APP_HOST/.test(r.err), r.err);
});

await test("refuses a header file that isn't mode 600", async () => {
  const loose = join(dir, "loose");
  writeFileSync(loose, "Authorization: Bearer x\n");
  chmodSync(loose, 0o644);
  const r = await run({ APP_BASE: base }, [loose]).done;
  assert(r.code === 2, `exit ${r.code}`);
  assert(polls.length === 0, `${polls.length} polls`);
});

await test("polls on none without busy-looping, then exits on a wake", async () => {
  const wake = { wake: { id: "w1", session: "s1", post: { t: "AccountManager" }, subjects: [{ t: "Nudge" }], text: "t", queuedFor: 5 } };
  answer = (n) => (n < 4 ? [200, { none: true, pollAgain: 0 }, 0] : [200, wake, 0]);
  const t0 = Date.now();
  const r = await run({ APP_BASE: base }).done;
  const took = Date.now() - t0;
  assert(r.code === 0, `exit ${r.code} ${r.err}`);
  assert(r.out.trim() === `200 ${JSON.stringify(wake)}`, r.out);
  assert(polls.length === 4, `${polls.length} polls`);
  assert(polls.every((p) => p.path === "/agent/relay_poll" && p.auth === "Bearer test-attachment"), "path or auth");
  for (let i = 1; i < polls.length; i++) {
    const gap = polls[i].at - polls[i - 1].at;
    assert(gap >= 1900, `gap ${gap} ms between polls ${i} and ${i + 1}`);
  }
  assert(took >= 5800, `took ${took} ms`);
});

await test("a held none (over 5 s) is followed by the next poll at once", async () => {
  answer = (n) => (n < 2 ? [200, { none: true, pollAgain: 0 }, 5200] : [409, { t: "Refused", refusal: { check: "post-lost" } }, 0]);
  const r = await run({ APP_BASE: base }).done;
  assert(r.code === 0, `exit ${r.code}`);
  assert(r.out.startsWith("409 "), r.out);
  const gap = polls[1].at - polls[0].at;
  assert(gap < 6500, `gap ${gap} ms`);
});

await test("pollAgain is honoured", async () => {
  answer = (n) => (n < 2 ? [200, { none: true, pollAgain: 3 }, 0] : [401, { t: "Refused", refusal: { check: "no-attachment" } }, 0]);
  const r = await run({ APP_BASE: base }).done;
  assert(r.out.startsWith("401 "), r.out);
  const gap = polls[1].at - polls[0].at;
  assert(gap >= 2900, `gap ${gap} ms`);
});

await test("POLL_DELAY waits before the first poll", async () => {
  answer = () => [429, { t: "Refused", refusal: { check: "rate-limited", retryAfter: 5 } }, 0];
  const t0 = Date.now();
  const r = await run({ APP_BASE: base, POLL_DELAY: "2" }).done;
  assert(r.out.startsWith("429 "), r.out);
  assert(polls[0].at - t0 >= 1900, `first poll after ${polls[0].at - t0} ms`);
});

await test("a second loop on the same header file exits 3 and leaves the first running", async () => {
  answer = () => [200, { none: true, pollAgain: 0 }, 0];
  const first = run({ APP_BASE: base });
  await sleep(500);
  const second = await run({ APP_BASE: base }).done;
  assert(second.code === 3, `second exit ${second.code}`);
  assert(first.child.exitCode === null, "the first loop stopped");
  first.child.kill("SIGTERM");
  const r = await first.done;
  assert(r.code === 143 || r.signal === "SIGTERM", `first exit ${r.code} ${r.signal}`);
});

await test("TERM stops it at once, mid-poll, and removes its temp files", async () => {
  answer = () => [200, { none: true, pollAgain: 0 }, 30000];
  const p = run({ APP_BASE: base });
  await sleep(800);
  const t0 = Date.now();
  p.child.kill("SIGTERM");
  const r = await p.done;
  assert(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms to stop`);
  assert(r.code === 143, `exit ${r.code}`);
  await sleep(200);
  const left = readdirSync(tmpdir()).filter((n) => !tmpBefore.has(n) && n.startsWith("tmp."));
  assert(left.length === 0, `temp files left: ${left.join(", ")}`);
});

await test("gives up with pollFailed after 5 network errors in a row", async () => {
  // A port nothing listens on.
  const dead = createServer();
  await new Promise((r) => dead.listen(0, "127.0.0.1", r));
  const port = dead.address().port;
  await new Promise((r) => dead.close(r));
  const t0 = Date.now();
  const r = await run({ APP_BASE: `http://127.0.0.1:${port}` }).done;
  assert(r.code === 1, `exit ${r.code}`);
  assert(r.out.startsWith("pollFailed "), r.out);
  const took = Date.now() - t0;
  assert(took >= 19000, `gave up after ${took} ms (backs off 2+4+6+8 s)`);
});

server.close();
for (const l of results) console.log(l);
const failed = results.filter((l) => l.startsWith("✗")).length;
console.log(failed ? `${failed} failed` : `OK: ${results.length} tests`);
process.exit(failed ? 1 : 0);
