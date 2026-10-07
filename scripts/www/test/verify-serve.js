/**
 * 一次性验证脚本（跑完自动关服务，不留任何东西）
 * 1) 直接启动 启动.py 的子进程
 * 2) 通过 http 拉取所有 PWA 资源，检查状态码与类型
 * 3) 检查 sw.js 的关键行为（不缓存 AI 接口、导航网络优先）
 * 4) 关掉子进程
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const PY = process.env.PY_EXE;
const PORT = 8123;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitReady(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  return false;
}

(async () => {
  // 用固定端口起服务（直接用 python -m http.server，避免占用默认 8000）
  const srv = spawn(PY, ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  let srvErr = "";
  srv.stderr.on("data", d => { srvErr += d.toString(); });
  srv.stdout.on("data", () => {});

  const base = `http://127.0.0.1:${PORT}`;
  const files = [
    "index.html", "manifest.json", "sw.js",
    "img/icon-192.png", "img/icon-512.png", "img/icon-maskable-512.png",
    "img/favicon.ico", "img/class.jpg",
  ];

  let pass = 0, fail = 0;
  const bad = [];

  try {
    const ready = await waitReady(base + "/index.html");
    if (!ready) throw new Error("服务未能在 10 秒内启动。stderr: " + srvErr.slice(0, 500));
    console.log("本地服务已就绪：" + base);

    console.log("\n--- 静态资源可达性 ---");
    for (const f of files) {
      try {
        const r = await fetch(`${base}/${f}`);
        const body = await r.arrayBuffer();
        const ct = r.headers.get("content-type") || "";
        const okType = f.endsWith(".js") ? /javascript/.test(ct)
          : f.endsWith(".json") ? /json/.test(ct)
            : f.endsWith(".png") ? /image\/png/.test(ct)
              : f.endsWith(".ico") ? /image\//.test(ct)
                : f.endsWith(".jpg") ? /image\/jpeg/.test(ct)
                  : /html/.test(ct);
        const line = `  ${f.padEnd(28)} ${r.status}  ${String(body.byteLength).padStart(7)} B  ${ct}`;
        if (r.ok && okType && body.byteLength > 0) { pass++; console.log("  ✅" + line); }
        else { fail++; bad.push(f + " 状态/类型异常"); console.log("  ❌" + line); }
      } catch (e) {
        fail++; bad.push(f + " → " + e.message);
        console.log("  ❌ " + f + " 请求失败: " + e.message);
      }
    }

    console.log("\n--- manifest 可被浏览器解析 ---");
    const mf = await (await fetch(base + "/manifest.json")).json();
    const checks = [
      ["name 存在", !!mf.name],
      ["display=standalone", mf.display === "standalone"],
      ["start_url 可解析", typeof mf.start_url === "string"],
      ["图标 ≥3 且含 maskable", mf.icons.length >= 3 && mf.icons.some(i => i.purpose === "maskable")],
    ];
    for (const [name, okv] of checks) {
      if (okv) { pass++; console.log("  ✅ " + name); }
      else { fail++; bad.push("manifest: " + name); console.log("  ❌ " + name); }
    }

    console.log("\n--- manifest 图标真实可下载（浏览器会去取） ---");
    for (const ic of mf.icons) {
      const r = await fetch(base + "/" + ic.src.replace(/^\.\//, ""));
      const buf = Buffer.from(await r.arrayBuffer());
      const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      const [ew, eh] = ic.sizes.split("x").map(Number);
      const okAll = r.ok && isPng && w === ew && h === eh;
      if (okAll) { pass++; console.log(`  ✅ ${ic.src} → 实际 ${w}×${h}（声明 ${ic.sizes}）`); }
      else { fail++; bad.push(`${ic.src} 尺寸不符：${w}×${h} ≠ ${ic.sizes}`); console.log(`  ❌ ${ic.src} → ${w}×${h}，声明 ${ic.sizes}`); }
    }

    console.log("\n--- sw.js 行为约束 ---");
    const swText = await (await fetch(base + "/sw.js")).text();
    const swChecks = [
      ["排除 AI 接口域名", /deepseek\.com/.test(swText)],
      ["导航请求网络优先", /mode === "navigate"/.test(swText)],
      ["安装时预缓存", /cache\.add\(/.test(swText)],
      ["激活时清理旧缓存", /caches\.delete/.test(swText)],
      ["不缓存非 GET", /method !== "GET"/.test(swText)],
    ];
    for (const [name, okv] of swChecks) {
      if (okv) { pass++; console.log("  ✅ " + name); }
      else { fail++; bad.push("sw: " + name); console.log("  ❌ " + name); }
    }

    console.log("\n--- 页面 PWA 挂钩 ---");
    const page = await (await fetch(base + "/index.html")).text();
    for (const [name, re] of [
      ["manifest 已引用", /rel="manifest" href="manifest\.json"/],
      ["注册 sw.js", /serviceWorker\.register\("sw\.js"\)/],
      ["启动页存在", /id="splash"/],
      ["安装按钮存在", /id="btnInstall"/],
    ]) {
      if (re.test(page)) { pass++; console.log("  ✅ " + name); }
      else { fail++; bad.push("page: " + name); console.log("  ❌ " + name); }
    }

  } catch (e) {
    fail++; bad.push("异常: " + e.message);
    console.log("  ❌ " + e.message);
  } finally {
    srv.kill();
    await sleep(300);
    console.log("\n──────────────────────────────────────");
    console.log(`通过 ${pass} 项，失败 ${fail} 项`);
    if (fail) { bad.forEach(b => console.log("  - " + b)); process.exit(1); }
    console.log("本地服务验证通过 🎉（服务已关闭）");
  }
})();
