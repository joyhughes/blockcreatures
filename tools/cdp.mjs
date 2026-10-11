// Drive headless Chrome over CDP: node tools/cdp.mjs <url> <out.png> [waitMs] [js-to-eval-before-shot]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const [url, out = 'shot.png', wait = '4000', js = ''] = process.argv.slice(2);
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1400,850', `--user-data-dir=${tmpdir()}/cdp-${port}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = list.find(t => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl); break;
  } catch { await sleep(200); }
}
await new Promise(r => ws.onopen = r);
let id = 0; const waiters = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') console.log('[console]', m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') console.log('[exception]', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Log.entryAdded') console.log('[log]', m.params.entry.level, m.params.entry.text, m.params.entry.url || '');
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 850, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(+wait);
if (js) {
  const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
  console.log('[eval]', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description));
}
// SHOTS=n,ms takes n screenshots ms apart: out-0.png, out-1.png, ...
const [nShots, gap] = (process.env.SHOTS || '1,0').split(',').map(Number);
for (let k = 0; k < nShots; k++) {
  if (k) await sleep(gap);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: process.env.CLIP ? { x: 0, y: 0, width: 1060, height: 850, scale: 0.5 } : undefined });
  writeFileSync(nShots > 1 ? out.replace(/\.png$/, `-${k}.png`) : out, Buffer.from(shot.result.data, 'base64'));
}
ws.close(); proc.kill();
process.exit(0);
