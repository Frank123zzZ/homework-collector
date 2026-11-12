// 公共工具：日期解析（统一换算成美东时间）、课程映射、ID 生成、和后台通信。
// 这个文件同时被 content script、background、popup、options 加载。
(function (root) {
  const HW = root.HW || (root.HW = {});
  const TZ = 'America/New_York';

  HW.PLATFORMS = ['Gradescope', 'WebAssign', 'Rephactor', 'ALEKS', 'Brightspace'];

  // 通用默认值。个人的课程映射和跳过规则写在 local-settings.js 里（会覆盖这里），
  // 在设置页保存的内容优先级最高。
  HW.DEFAULT_SETTINGS = Object.assign(
    {
      // match 里的任意一项出现在平台的课程名里（忽略大小写、空格、横线、下划线）就算这门课
      // 例：{ match: ['MATH 2310', 'Discrete Math'], name: 'Discrete Math', abbr: 'dm' }
      courses: [],
      // 跳过规则：platform / course 精确匹配（不写就是不限），title 是正则（忽略大小写）
      // 例：{ platform: 'Gradescope', course: 'CS101', title: 'homework|(^|[^a-z])hw\\s*\\d' }
      ignore: [],
      // Rephactor 的 Pending 列表不代表没做完，开启后会在后台标签页里逐个打开作业数 Solved!
      rephactorAutoCheck: true,
      rephactorDefaultCourse: 'Rephactor'
    },
    root.HW_LOCAL_SETTINGS || {}
  );

  HW.getSettings = async function () {
    const { settings } = await chrome.storage.local.get('settings');
    return Object.assign({}, HW.DEFAULT_SETTINGS, settings || {});
  };

  // ---------- 文本 / 课程 ----------
  HW.text = (el) => (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim();
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  HW.findCourse = function (text, settings) {
    const t = norm(text);
    if (!t) return null;
    for (const c of settings.courses || []) {
      for (const m of [].concat(c.match || [])) {
        const n = norm(m);
        if (n && t.includes(n)) return { name: c.name, abbr: c.abbr || autoAbbr(c.name) };
      }
    }
    return null;
  };

  HW.mapCourse = function (raw, settings) {
    const found = HW.findCourse(raw, settings);
    if (found) return found;
    const name = String(raw || '').replace(/\s+/g, ' ').trim() || '未知课程';
    return { name, abbr: autoAbbr(name) };
  };

  function autoAbbr(name) {
    const words = String(name).split(/[^A-Za-z0-9]+/).filter(Boolean);
    if (words.length === 1) return words[0].toLowerCase().slice(0, 12);
    return words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join('').toLowerCase().slice(0, 12) || 'x';
  }

  HW.slug = (s) =>
    String(s || '').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  // 标题以章节号开头（如 "5.1 Sequences"）就用章节号，否则用整个标题
  HW.titleKey = function (title) {
    const m = String(title || '').match(/^\s*(\d+(?:\.\d+)+|\d+)\b/);
    return m ? m[1] : HW.slug(title) || 'item';
  };

  HW.makeId = (prefix, abbr, title) => `${prefix}-${abbr}-${HW.titleKey(title)}`;

  HW.detectKind = function (title) {
    if (/\b(exam|midterm|final|quiz|test)\b|考试|测验/i.test(title)) return '考试';
    if (/\b(project|essay|paper)\b|项目|论文/i.test(title)) return '项目';
    return '作业';
  };

  // ---------- 时间 ----------
  function nyOffsetMinutes(date) {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName');
    const m = part && part.value.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10));
  }

  // 美东墙上时间 → Date
  HW.nyWallToDate = function (y, mo, d, h, mi) {
    const guess = Date.UTC(y, mo, d, h, mi);
    let off = nyOffsetMinutes(new Date(guess));
    let t = guess - off * 60000;
    const off2 = nyOffsetMinutes(new Date(t));
    if (off2 !== off) t = guess - off2 * 60000;
    return new Date(t);
  };

  // Date → "2026-11-24T23:59:00-05:00"
  HW.toNYISO = function (date) {
    if (!date || isNaN(date)) return null;
    const off = nyOffsetMinutes(date);
    const l = new Date(date.getTime() + off * 60000);
    const p = (n) => String(n).padStart(2, '0');
    const sign = off < 0 ? '-' : '+';
    const a = Math.abs(off);
    return (
      `${l.getUTCFullYear()}-${p(l.getUTCMonth() + 1)}-${p(l.getUTCDate())}` +
      `T${p(l.getUTCHours())}:${p(l.getUTCMinutes())}:00${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`
    );
  };

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const ZONES = { EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420, UTC: 0, GMT: 0 };

  // 解析各平台常见的日期写法；没写时间默认 23:59，没写年份取离现在最近的那一年；没写时区按美东
  HW.parseDate = function (text, now = new Date()) {
    if (!text) return null;
    const s = String(text).replace(/\s+/g, ' ').trim();

    let m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})/);
    if (m) {
      const off = m[7] === 'Z' ? 'Z' : m[7].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2');
      const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}${off}`);
      if (!isNaN(d)) return d;
    }

    let y = null, mo, d;
    m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?\s*(\d{4})?/i);
    if (m) {
      mo = MONTHS[m[1].toLowerCase()];
      d = +m[2];
      if (m[3]) y = +m[3];
    } else {
      m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
      if (m) {
        y = +m[1]; mo = +m[2] - 1; d = +m[3];
      } else {
        m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
        if (!m) return null;
        mo = +m[1] - 1; d = +m[2];
        if (m[3]) y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      }
    }
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;

    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const before = s.slice(Math.max(0, m.index - 20), m.index);
    const timeRe = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?(?![a-z])/i;
    const time24 = /\b(\d{1,2}):(\d{2})\b/;
    let hh = 23, mm = 59;
    const t = after.match(timeRe) || after.match(time24) || before.match(timeRe) || before.match(time24);
    if (t) {
      hh = +t[1]; mm = +(t[2] || 0);
      if (t[3]) {
        const pm = t[3].toLowerCase() === 'p';
        if (hh === 12) hh = pm ? 12 : 0;
        else if (pm) hh += 12;
      }
      if (hh > 23 || mm > 59) { hh = 23; mm = 59; }
    }

    const zone = (after.match(/\b([ECMP][SD]T|UTC|GMT)\b/) || [])[1];
    const build = (yy) =>
      zone && zone !== 'EST' && zone !== 'EDT'
        ? new Date(Date.UTC(yy, mo, d, hh, mm) - ZONES[zone] * 60000)
        : HW.nyWallToDate(yy, mo, d, hh, mm);

    if (y) return build(y);
    const day = 86400000;
    let yy = now.getFullYear();
    let r = build(yy);
    if (r.getTime() < now.getTime() - 120 * day) r = build(++yy);
    else if (r.getTime() > now.getTime() + 240 * day) r = build(--yy);
    return r;
  };

  // ---------- 作业对象 ----------
  HW.makeItem = function ({ platform, prefix, course, title, due, link, extra }) {
    title = String(title || '').replace(/\s+/g, ' ').trim();
    return Object.assign(
      {
        id: HW.makeId(prefix, course.abbr, title),
        course: course.name,
        title,
        platform,
        kind: HW.detectKind(title),
        due: due instanceof Date ? HW.toNYISO(due) : due || null,
        link: link || ''
      },
      extra || {}
    );
  };

  HW.isIgnored = function (item, settings) {
    return (settings.ignore || []).some((r) => {
      if (r.platform && r.platform.toLowerCase() !== String(item.platform).toLowerCase()) return false;
      if (r.course && r.course.toLowerCase() !== String(item.course).toLowerCase()) return false;
      if (r.title) {
        try {
          if (!new RegExp(r.title, 'i').test(item.title)) return false;
        } catch (e) {
          return false;
        }
      }
      return true;
    });
  };

  // Rephactor：后台数过题目，全部 Solved 就算完成
  HW.isDone = function (item, progress) {
    if (!item.rpId || !progress) return false;
    const p = progress[item.rpId];
    return !!(p && p.total > 0 && p.solved >= p.total);
  };

  // 按看板要求的格式输出：未提交、未过截止、不在跳过规则里，按截止时间排序
  HW.exportList = function (itemsObj, settings, progress, now = new Date()) {
    return Object.values(itemsObj || {})
      .filter((it) => it.due && new Date(it.due) > now)
      .filter((it) => !HW.isIgnored(it, settings) && !HW.isDone(it, progress))
      .sort((a, b) => new Date(a.due) - new Date(b.due))
      .map(({ id, course, title, platform, kind, due, link }) => ({ id, course, title, platform, kind, due, link }));
  };

  // ---------- content script 辅助 ----------
  HW.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  HW.waitFor = async function (fn, timeout = 15000, interval = 500) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await HW.sleep(interval);
    }
    return null;
  };

  HW.fetchDoc = async function (url) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return { doc: new DOMParser().parseFromString(await r.text(), 'text/html'), url: r.url };
  };

  HW.fetchJSON = async function (url) {
    const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!r.ok) {
      const e = new Error(`HTTP ${r.status} ${url}`);
      e.status = r.status;
      throw e;
    }
    return r.json();
  };

  // 同一个 key 在 minutes 分钟内只扫一次（避免每次翻页都重新抓）
  HW.throttle = async function (key, minutes) {
    const { lastScan = {} } = await chrome.storage.local.get('lastScan');
    if (lastScan[key] && Date.now() - lastScan[key] < minutes * 60000) return false;
    lastScan[key] = Date.now();
    await chrome.storage.local.set({ lastScan });
    return true;
  };

  HW.report = (msg) => chrome.runtime.sendMessage(Object.assign({ type: 'report' }, msg));
  HW.setStatus = (platform, message, ok) =>
    chrome.runtime.sendMessage({ type: 'status', platform, message, ok: !!ok });

  HW.onRescan = function (fn) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'rescan') {
        Promise.resolve(fn(true)).then(() => sendResponse({ ok: true }), (e) => sendResponse({ error: String(e) }));
        return true;
      }
    });
  };

  // 从链接往上找，找到一个"包含日期、又不太大"的容器当作这一行
  HW.rowOf = function (el, maxLen = 600) {
    let cur = el;
    for (let i = 0; i < 8 && cur && cur.parentElement; i++) {
      cur = cur.parentElement;
      const t = HW.text(cur);
      if (t.length > maxLen) break;
      if (HW.parseDate(t)) return cur;
    }
    return el.closest('tr, li') || el.parentElement;
  };

  // 文本里有 "Due" 就只看 Due 后面那段，避免把开始时间当截止时间
  HW.dueFromText = function (text) {
    const i = String(text).search(/\bdue\b/i);
    return HW.parseDate(i >= 0 ? text.slice(i) : text);
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
