importScripts('local-settings.js', 'common.js', 'drive.js');

// 所有写 storage 的操作排队执行，避免多个标签页同时上报时互相覆盖
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

// Drive 上传单独排队（避免同时新建两个文件），收集结果 3 秒后合并成一次上传
let syncChain = Promise.resolve();
let syncTimer;
const runSync = (opts) => (syncChain = syncChain.then(() => HW.Drive.sync(opts)).catch(() => {}));
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync({}), 3000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'driveConnect' || msg.type === 'driveSync') {
    runSync({ interactive: msg.type === 'driveConnect', force: true }).then(() => sendResponse({ ok: true }));
    return true;
  }
  serial(() => handle(msg, sender)).then(
    (r) => sendResponse(r || { ok: true }),
    (e) => sendResponse({ error: String(e) })
  );
  return true;
});

async function handle(msg, sender) {
  if (msg.type === 'report') return onReport(msg);
  if (msg.type === 'status') return setStatus(msg.platform, msg.message, msg.ok);
  if (msg.type === 'rpProgress') return onRpProgress(msg, sender);
  if (msg.type === 'refreshBadge') return updateBadge();
}

async function setStatus(platform, message, ok, count) {
  const { status = {} } = await chrome.storage.local.get('status');
  status[platform] = { at: Date.now(), message, ok, count: count == null ? (status[platform] || {}).count : count };
  await chrome.storage.local.set({ status });
}

// 一次上报替换同一个 scope（比如 "gradescope" 或 "webassign:Discrete Math"）下的全部作业
async function onReport({ platform, scope, items, message }) {
  const store = await chrome.storage.local.get('items');
  const all = store.items || {};
  for (const [id, it] of Object.entries(all)) if (it.scope === scope) delete all[id];
  for (const it of items) all[it.id] = Object.assign({}, it, { scope, seenAt: Date.now() });
  await chrome.storage.local.set({ items: all });
  await setStatus(platform, message || `找到 ${items.length} 条未提交`, true, items.length);
  await updateBadge();

  if (platform === 'Rephactor') {
    const settings = await HW.getSettings();
    if (settings.rephactorAutoCheck) scheduleRephactorChecks(items);
  }
}

async function updateBadge() {
  const { items = {}, rpProgress = {} } = await chrome.storage.local.get(['items', 'rpProgress']);
  const n = HW.exportList(items, await HW.getSettings(), rpProgress).length;
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#c2410c' });
  scheduleSync();
}

// ---------- Rephactor 进度检查 ----------
const rpWaiters = new Map(); // tabId -> resolve
let rpChain = Promise.resolve();

async function scheduleRephactorChecks(items) {
  const { rpProgress = {} } = await chrome.storage.local.get('rpProgress');
  const stale = items.filter((it) => {
    if (!it.rpId || !it.link) return false;
    const p = rpProgress[it.rpId];
    return !p || Date.now() - p.at > 30 * 60000;
  });
  if (!stale.length) return;
  rpChain = rpChain.then(async () => {
    for (const it of stale.slice(0, 10)) {
      let tab;
      try {
        tab = await chrome.tabs.create({ url: it.link, active: false });
        await new Promise((res) => {
          rpWaiters.set(tab.id, res);
          setTimeout(res, 30000);
        });
      } catch (e) {
        /* 忽略单个失败 */
      } finally {
        if (tab) {
          rpWaiters.delete(tab.id);
          chrome.tabs.remove(tab.id).catch(() => {});
        }
      }
    }
  });
}

async function onRpProgress({ rpId, solved, total }, sender) {
  const { rpProgress = {} } = await chrome.storage.local.get('rpProgress');
  rpProgress[rpId] = { solved, total, at: Date.now() };
  await chrome.storage.local.set({ rpProgress });
  await updateBadge();
  const tabId = sender.tab && sender.tab.id;
  if (rpWaiters.has(tabId)) rpWaiters.get(tabId)();
}

// 每小时同步一次：就算没有新扫描，过了截止时间的作业也会从 Drive 文件里去掉
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'hourlySync') updateBadge();
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('hourlySync', { periodInMinutes: 60 });
  updateBadge();
});
chrome.runtime.onStartup.addListener(() => updateBadge());
