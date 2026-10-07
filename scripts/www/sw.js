/* 我的课表 · Service Worker
 * 作用：让 App 装到桌面后可以离线打开（课表本身完全本地，AI 功能仍需联网）。
 * 策略：
 *   - 页面导航：网络优先，失败回落缓存（这样改完页面刷新即可看到新版）
 *   - 页面/图标/脚本：后台同时更新缓存（stale-while-revalidate）
 *   - DeepSeek 接口：绝不缓存，始终走网络
 */
const CACHE = "schedule-app-v1";
const CORE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./img/icon-192.png",
  "./img/icon-512.png",
  "./img/icon-maskable-512.png",
  "./img/favicon.ico",
  "./img/class.jpg",
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 逐个添加：个别文件缺失时不会让整个安装失败
    await Promise.all(CORE.map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (err) {}
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // AI 接口：不缓存
  if (url.hostname.endsWith("deepseek.com")) return;

  // 只接管同源资源（图标、页面、图片）
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch (err) {
        const cache = await caches.open(CACHE);
        return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error();
      }
    })());
    return;
  }

  // 其它同源静态资源：先用缓存、后台刷新
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const network = fetch(req).then(res => {
      if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await network) || Response.error();
  })());
});
