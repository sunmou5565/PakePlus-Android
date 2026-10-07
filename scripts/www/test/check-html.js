/**
 * 静态体检：HTML 结构 / CSS 括号 / script 语法 / 关键功能是否齐全
 * 运行： node test\check-html.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
let pass = 0, fail = 0;
const bad = [];
function check(name, fn) {
  try { fn(); pass++; console.log("  ✅ " + name); }
  catch (e) { fail++; bad.push(name + " → " + e.message); console.log("  ❌ " + name + "\n     " + e.message); }
}
function ok(v, msg) { if (!v) throw new Error(msg || "期望为真"); }
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || "断言失败") + ` 期望 ${JSON.stringify(b)} 实际 ${JSON.stringify(a)}`);
}

console.log("\n=== HTML 结构 ===");
check("文件以 <!DOCTYPE html> 开头并正确收尾", () => {
  ok(html.startsWith("<!DOCTYPE html>"), "缺少 doctype");
  ok(/<\/html>\s*$/.test(html.trim() + "\n") || html.trim().endsWith("</html>"), "结尾应为 </html>");
});
check("包含 utf-8 声明（中文不乱码）", () => ok(/<meta charset="UTF-8">/i.test(html)));
check("只有一个 <script> 块", () => eq((html.match(/<script>/g) || []).length, 1));
check("没有外部 JS/CSS 依赖（纯单文件）", () => {
  const ext = html.match(/<(script|link)[^>]+(src|href)="https?:\/\/[^"]+"/gi) || [];
  eq(ext, [], "不应有外链资源：");
});
check("div 标签数量平衡", () => {
  const open = (html.match(/<div\b/g) || []).length;
  const close = (html.match(/<\/div>/g) || []).length;
  eq(open, close, "开闭标签数不一致");
});
check("关键弹窗 id 齐全", () => {
  ["weekModalMask", "editModalMask", "detailModalMask", "importModalMask",
    "settingsModalMask", "previewModalMask", "fixModalMask"].forEach(id => {
      ok(html.indexOf(`id="${id}"`) >= 0, "缺少弹窗 " + id);
    });
});
check("AI 相关控件齐全", () => {
  ["inputApiKey", "inputModel", "inputBaseUrl", "inputUseRef", "inputRefPath",
    "imageInput", "excelInput", "aiSpinner", "pvSummary", "pvList", "aiRaw", "fixPrompt"].forEach(id => {
      ok(html.indexOf(`id="${id}"`) >= 0, "缺少控件 " + id);
    });
});
check("顶部有 ⚙ 设置入口 + AI 修正悬浮按钮", () => {
  ok(html.indexOf("openSettings()") >= 0, "缺少设置入口");
  ok(html.indexOf("openFixModal()") >= 0, "缺少 AI 修正入口");
  ok(html.indexOf("shiftWeek(-1)") >= 0 && html.indexOf("shiftWeek(1)") >= 0, "缺少上/下一周按钮");
});

console.log("\n=== CSS ===");
check("花括号平衡", () => {
  const css = /<style>([\s\S]*)<\/style>/.exec(html)[1];
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  eq(open, close, "CSS 大括号不匹配");
  ok(css.indexOf("@keyframes slideUp") >= 0, "缺少弹窗动画");
});

console.log("\n=== 脚本语法与关键函数 ===");
const code = /<script>([\s\S]*)<\/script>/.exec(html)[1];
check("脚本能被 Node 解析（无语法错误）", () => {
  new vm.Script(code, { filename: "index.html<script>" });
});
check("新增的 AI 函数都已定义", () => {
  const fns = ["openSettings", "saveSettings", "clearApiKey", "testConnection", "callDeepSeek",
    "extractJson", "shrinkImage", "unzip", "xlsxToRows", "parseCsv", "rowsToSheetText",
    "normalizeCourse", "normalizeCourses", "toWeeks", "buildSchedulePrompt",
    "startImageAnalyze", "startExcelAnalyze", "coursesFromTable", "openPreview", "renderPreview",
    "applyPreview", "setApplyMode", "diffAgainstExisting", "openFixModal", "startFix",
    "findCourseIndex", "mergeCourse", "switchImportTab", "bindDropAndInput", "shiftWeek",
    "calcTotalWeeks", "updateWeekNav", "persistAiConfig", "loadAiConfig"];
  const missing = fns.filter(f => !new RegExp("function " + f + "\\b").test(code));
  eq(missing, [], "缺少函数：");
});
check("Key 不会硬编码在页面里", () => {
  // 占位符 sk-xxxx… 不算；出现其它 sk- 开头的长串视为疑似真实 Key
  const keys = (html.match(/sk-[A-Za-z0-9_-]{16,}/g) || []).filter(k => !/^sk-x+$/i.test(k));
  eq(keys, [], "页面里不应出现真实 Key");
});
check("接口地址默认指向 DeepSeek 官方", () => {
  ok(code.indexOf('baseUrl: "https://api.deepseek.com"') >= 0, "默认 baseUrl 不正确");
  ok(code.indexOf('model: "deepseek-flash"') >= 0, "默认模型不正确");
});
check("识图请求使用 base64 图片 + json_object 输出", () => {
  ok(code.indexOf('{ type: "image_url", image_url: { url: small.dataUrl, detail: "original" } }') >= 0, "图片块写法不对");
  ok(code.indexOf('body.response_format = { type: "json_object" }') >= 0, "缺少 JSON 输出约束");
});
check("写入课表前必经预览（不会直接覆盖）", () => {
  const applyCalls = (code.match(/applyPreview\(\)/g) || []).length;
  ok(applyCalls >= 1, "缺少应用入口");
  ok(code.indexOf("function openPreview(") >= 0, "缺少预览入口");
  // startImageAnalyze / startExcelAnalyze 里不应直接改 scheduleData
  const img = /async function startImageAnalyze[\s\S]*?\n}/.exec(code)[0];
  const xls = /async function startExcelAnalyze[\s\S]*?\n}\n/.exec(code)[0];
  ok(img.indexOf("scheduleData =") < 0, "识图流程不应直接改课表");
  ok(xls.indexOf("scheduleData =") < 0, "Excel 流程不应直接改课表");
});

console.log("\n=== PWA 可安装性 ===");
const fsExists = p => fs.existsSync(path.join(ROOT, p));
check("manifest.json 存在且是合法 JSON", () => {
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  ok(mf.name && mf.short_name, "缺少 name/short_name");
  eq(mf.start_url, "./index.html?from=pwa");
  eq(mf.display, "standalone");
  eq(mf.theme_color, "#FAF0EB");
  eq(mf.background_color, "#FAF0EB");
  ok(mf.icons.length >= 3, "图标条目不足");
  ok(mf.icons.some(i => i.purpose === "maskable"), "缺少 maskable 图标");
  ok(mf.icons.some(i => i.sizes === "192x192"), "缺少 192 图标");
  ok(mf.icons.some(i => i.sizes === "512x512"), "缺少 512 图标");
});
check("manifest 里引用的图标文件都真实存在", () => {
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  eq(mf.icons.filter(i => !fsExists(i.src)).map(i => i.src), [], "缺少图标文件：");
});
check("快捷方式都带 action 参数", () => {
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  eq(mf.shortcuts.length, 3, "应有 3 个快捷方式");
  mf.shortcuts.forEach(s => ok(/[?&]action=(import|fix|settings)/.test(s.url), "快捷方式 URL 缺少 action：" + s.url));
});
check("sw.js 语法正确、生命周期齐全、不缓存 AI 接口", () => {
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  new vm.Script(sw, { filename: "sw.js" });
  ok(sw.indexOf("deepseek.com") >= 0, "应显式排除 AI 接口");
  ["\"install\"", "\"activate\"", "\"fetch\""].forEach(ev => ok(sw.indexOf(ev) >= 0, "缺少事件 " + ev));
  ok(sw.indexOf("skipWaiting") >= 0, "新版本应能立即接管");
});
check("sw.js 预缓存清单里的文件都存在", () => {
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const list = /const CORE = \[([\s\S]*?)\];/.exec(sw)[1];
  const files = (list.match(/"\.\/[^"]*"/g) || []).map(s => s.replace(/"/g, "").replace(/^\.\//, ""));
  eq(files.filter(f => f && !fsExists(f)), [], "预缓存文件缺失：");
});
check("页面已挂载 manifest + 图标 + iOS 元信息", () => {
  ok(/<link rel="manifest" href="manifest.json">/.test(html), "缺少 manifest 链接");
  ok(/<link rel="apple-touch-icon" href="img\/icon-192\.png">/.test(html), "缺少 apple-touch-icon");
  ok(/name="apple-mobile-web-app-capable" content="yes"/.test(html), "缺少 iOS 全屏 meta");
  ok(/name="theme-color"/.test(html), "缺少 theme-color");
  ok(/viewport-fit=cover/.test(html), "viewport 缺少 viewport-fit=cover（刘海屏适配）");
});
check("启动页元素与样式齐全", () => {
  ok(html.indexOf('id="splash"') >= 0, "缺少启动页");
  ok(html.indexOf('class="sp-mark"') >= 0, "缺少图标位");
  ok(/setTimeout\(hideSplash, 2000\)/.test(code), "应 2 秒后自动进入");
  ok(html.indexOf("轻触跳过") >= 0, "应可跳过");
  ok(html.indexOf('src="img/icon-192.png"') >= 0, "启动页应使用应用图标");
});
check("启动页一次会话只显示一次", () => {
  ok(code.indexOf('sessionStorage.getItem("splashShown")') >= 0, "缺少会话标记读取");
  ok(code.indexOf('sessionStorage.setItem("splashShown", "1")') >= 0, "缺少会话标记写入");
});
check("安装能力齐全（按钮 + 事件 + 手动指引）", () => {
  ok(html.indexOf('id="btnInstall"') >= 0, "缺少安装按钮");
  ok(code.indexOf("beforeinstallprompt") >= 0, "缺少安装事件监听");
  ok(code.indexOf("appinstalled") >= 0, "缺少安装完成监听");
  ok(code.indexOf("添加到主屏幕") >= 0, "缺少手动安装指引");
});
check("独立窗口下的移动端优化", () => {
  ok(html.indexOf("@media (display-mode: standalone)") >= 0, "缺少 standalone 适配");
  ok(code.indexOf("setupBackButton") >= 0 && code.indexOf("popstate") >= 0, "缺少返回键处理");
});
check("本地启动脚本存在且只用标准库", () => {
  const p = path.join(ROOT, "启动.py");
  ok(fs.existsSync(p), "缺少 启动.py");
  const py = fs.readFileSync(p, "utf8");
  ["import http.server", "import socketserver", "import webbrowser"].forEach(lib => {
    ok(py.indexOf(lib) >= 0, "缺少标准库引用：" + lib);
  });
  ok(!/pip install|import requests|import flask/i.test(py), "不应依赖第三方库");
});
check("Python 脚本语法正确（py_compile）", () => {
  const { spawnSync } = require("child_process");
  const py = process.env.PY_EXE || "python";
  const scripts = ["启动.py", path.join("test", "make_icons.py"), path.join("test", "make_test_xlsx.py")];
  const r = spawnSync(py, ["-c",
    "import py_compile,sys\n" +
    "for f in sys.argv[1:]:\n" +
    "    py_compile.compile(f, doraise=True)\n" +
    "print('ok')",
    ...scripts], { cwd: ROOT, encoding: "utf8" });
  if (r.error) throw new Error("无法调用 Python：" + r.error.message);
  if (r.status !== 0) throw new Error((r.stderr || "").trim().split("\n").slice(-3).join(" | "));
  ok((r.stdout || "").indexOf("ok") >= 0, "py_compile 未返回成功");
});
check("图标文件都是有效 PNG 且尺寸与声明一致", () => {
  const want = { "icon-192.png": 192, "icon-512.png": 512, "icon-maskable-512.png": 512 };
  Object.keys(want).forEach(f => {
    const buf = fs.readFileSync(path.join(ROOT, "img", f));
    const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    ok(buf.slice(0, 8).equals(sig), f + " 不是 PNG");
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    eq([w, h], [want[f], want[f]], f + " 尺寸不符");
  });
});

console.log("\n──────────────────────────────────────");
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) { bad.forEach(b => console.log("  - " + b)); process.exit(1); }
console.log("静态体检通过 🎉");
