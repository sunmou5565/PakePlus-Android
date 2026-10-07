/**
 * 用 CDP 连到无头浏览器，检查「启动页是否会挡住界面」这件事
 * 检查项（真实浏览器、真实计算样式）：
 *   1) 正常 JS：2.5 秒后 #splash 的 computed opacity/visibility 应为隐藏，课表已渲染
 *   2) 禁用 JS：同一时刻 #splash 也应变透明（靠 CSS 兜底），否则用户会被永久挡住
 */
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PAGE = "file:///" + path.join(__dirname, "..", "index.html").replace(/\\/g, "/");
const PORT = 9333 + Math.floor(Math.random() * 200);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdp(profileDir, extraArgs) {
  const proc = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${PORT}`,
    "--window-size=420,900",
    ...extraArgs,
    PAGE,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stderr.on("data", d => { log += d.toString(); });

  // 等 devtools 端口就绪
  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find(t => t.type === "page" && t.url.startsWith("file://"));
      if (target && target.webSocketDebuggerUrl) break;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  if (!target) { proc.kill(); throw new Error("拿不到调试目标。stderr: " + log.slice(0, 400)); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("WS 连接失败")); });

  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params) => new Promise(res => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: false });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  return { proc, evaluate, send, close: async () => { try { ws.close(); } catch (e) {} proc.kill(); await sleep(200); } };
}

const PROBE = `(function(){
  var sp = document.getElementById('splash');
  var cs = sp ? getComputedStyle(sp) : null;
  return JSON.stringify({
    hasSplash: !!sp,
    cls: sp ? sp.className : '',
    opacity: cs ? cs.opacity : '',
    visibility: cs ? cs.visibility : '',
    display: cs ? cs.display : '',
    pointerEvents: cs ? cs.pointerEvents : '',
    title: (document.getElementById('topTitle')||{}).textContent || '',
    cards: document.querySelectorAll('.course-card').length,
    bodyText: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,60)
  });
})()`;

let pass = 0, fail = 0;
function judge(name, okv, detail) {
  if (okv) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (detail ? "  → " + detail : "")); }
}

(async () => {
  console.log("页面: " + PAGE + "\n");

  console.log("=== 1. 正常运行（JavaScript 打开）===");
  let s = await cdp(path.join(os.tmpdir(), "cdp-a-" + Date.now()), []);
  await sleep(3000);
  let st = JSON.parse(await s.evaluate(PROBE));
  console.log("  实际状态:", JSON.stringify(st));
  judge("启动页已被收起（opacity=0 或 visibility=hidden 或 display=none）",
    st.opacity === "0" || st.visibility === "hidden" || st.display === "none",
    `opacity=${st.opacity} visibility=${st.visibility}`);
  judge("启动页不再拦截点击（pointer-events=none）", st.pointerEvents === "none", st.pointerEvents);
  judge("课表已渲染出课程卡片", st.cards > 0, "cards=" + st.cards);
  judge("顶部标题有日期与周次", /月.*周/.test(st.title), st.title);
  await s.close();

  console.log("\n=== 2. 最坏情况：脚本被禁用 ===");
  s = await cdp(path.join(os.tmpdir(), "cdp-b-" + Date.now()), ["--blink-settings=scriptEnabled=false"]);
  await sleep(3500);
  st = JSON.parse(await s.evaluate(PROBE));
  console.log("  实际状态:", JSON.stringify(st));
  judge("脚本确实没执行（课表为空）", st.cards === 0, "cards=" + st.cards);
  judge("★ 启动页仍会自动让开（CSS 兜底生效）",
    st.opacity === "0" || st.visibility === "hidden" || st.display === "none",
    `opacity=${st.opacity} visibility=${st.visibility}`);
  judge("★ 兜底后不再拦截点击", st.pointerEvents === "none", st.pointerEvents);
  await s.close();

  console.log("\n──────────────────────────────────────");
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("异常: " + e.message); process.exit(1); });
