// Rephactor：Dashboard 上 "Your Pending Assignments in <课程>" 下面列的就是还没做的作业。
// 每条的结构是：
//   QC-Day-19                       ← 标题（ES 作业旁边还有 "Solve Them Now" 按钮）
//   Quick checks of the Day 19 content
//   Due: Nov 16, 2026 8:00 am EST
// 列表以 "Show Past Assignments" 按钮结束。
// Pending 不一定代表没做完：带 "Solve Them Now" 的作业，后台会开一个检查标签页，
// 点进去数 "Solved!"，全部 Solved 就算完成，不再列出。
(() => {
  const P = 'Rephactor';
  const HEADING = /^your pending assignments\b/i;

  function findHeadings() {
    return [...document.querySelectorAll('body *')].filter((e) => {
      const t = HW.text(e);
      return t.length < 120 && HEADING.test(t) && ![...e.children].some((c) => HEADING.test(HW.text(c)));
    });
  }

  // 把一个 Pending 区块的文字按行切开，遇到 "Due:" 行就结束一条作业
  function parseBlock(heading) {
    let box = heading.parentElement;
    while (box && !/\bdue\s*:/i.test(box.innerText || '')) box = box.parentElement;
    if (!box) return [];
    const lines = (box.innerText || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const headText = HW.text(heading);
    let i = lines.findIndex((l) => l === headText || HEADING.test(l));
    const out = [];
    let block = [];
    let hasSolve = false;
    for (i = i + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^show past assignments$|^your (grades|books|courses)\b|^your pending assignments\b/i.test(l)) break;
      if (/solve them now/i.test(l)) hasSolve = true;
      if (/^due\s*:/i.test(l)) {
        const title = (block[0] || '').replace(/\s*solve them now\s*/i, '').trim();
        if (title) out.push({ title, due: HW.parseDate(l.replace(/^due\s*:\s*/i, '')), hasSolve });
        block = [];
        hasSolve = false;
      } else if (!/^solve them now$/i.test(l)) {
        block.push(l);
      }
    }
    return out;
  }

  // ---------- 检查某个作业是不是已经全部 Solved（只在后台打开的检查标签页里运行） ----------
  const SOLVED = /^solved!?$/i;
  const UNSOLVED = /^(unsolved|not (yet )?solved|attempted|not attempted|incomplete|in progress)$/i;
  const EXERCISE = /^(exercise|problem|question)\s*#?\s*\d+\b/i;

  function leafTexts() {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length === 0) {
        const t = HW.text(el);
        if (t && t.length < 40) out.push(t);
      }
    }
    return out;
  }

  // 返回 { solved, total }；total 为 0 表示数不出题目总数，这时作业继续算没做完（宁可多列）
  function countSolved() {
    const body = HW.text(document.body);
    const m = body.match(/(\d+)\s*(?:of|\/)\s*(\d+)\s*(?:exercises?|problems?)?\s*(?:solved|completed)/i);
    if (m) return { solved: +m[1], total: +m[2] };
    const leaves = leafTexts();
    const solved = leaves.filter((t) => SOLVED.test(t)).length;
    const unsolved = leaves.filter((t) => UNSOLVED.test(t)).length;
    const exercises = leaves.filter((t) => EXERCISE.test(t)).length;
    if (!exercises && !unsolved) return { solved, total: 0 };
    return { solved, total: Math.max(exercises, solved + unsolved) };
  }

  function findSolveButton(title) {
    const buttons = [...document.querySelectorAll('button, a, [role="button"], input[type="button"]')].filter((b) =>
      /^solve them now$/i.test(HW.text(b) || b.value || '')
    );
    for (const b of buttons) {
      let box = b.parentElement;
      while (box && !/\bdue\s*:/i.test(box.innerText || '')) box = box.parentElement;
      if (!box) continue;
      const first = (box.innerText || '').split('\n').map((l) => l.replace(/\s*solve them now\s*/i, '').trim()).find(Boolean);
      if (first === title) return b;
    }
    // 退路：按顺序对应——第 k 个带按钮的作业对应第 k 个 Solve Them Now 按钮
    const withSolve = findHeadings().flatMap(parseBlock).filter((it) => it.hasSolve);
    const k = withSolve.findIndex((it) => it.title === title);
    return k >= 0 && withSolve.length === buttons.length ? buttons[k] : null;
  }

  async function runCheck(check) {
    const btn = await HW.waitFor(() => findSolveButton(check.title), 15000);
    if (!btn) return chrome.runtime.sendMessage({ type: 'rpProgress', id: check.id, solved: 0, total: 0 });
    const before = location.href;
    btn.click();
    await HW.waitFor(() => location.href !== before, 10000);
    await HW.waitFor(() => {
      const leaves = leafTexts();
      return leaves.some((t) => SOLVED.test(t) || UNSOLVED.test(t) || EXERCISE.test(t)) ||
        /\d+\s*(of|\/)\s*\d+\s*(exercises?|problems?)?\s*(solved|completed)/i.test(HW.text(document.body));
    }, 20000);
    await HW.sleep(1500); // 等题目列表渲染完
    const { solved, total } = countSolved();
    chrome.runtime.sendMessage({ type: 'rpProgress', id: check.id, solved, total });
  }

  async function scanDashboard() {
    const headings = await HW.waitFor(() => {
      const h = findHeadings();
      return h.length ? h : null;
    }, 15000);
    if (!headings) return;

    const settings = await HW.getSettings();
    const items = [];
    for (const h of headings) {
      // "Your Pending Assignments in CSUY 1114" → 课程 CSUY 1114
      const courseRaw = HW.text(h).replace(HEADING, '').replace(/^\s*in\s*/i, '').trim();
      const course = HW.findCourse(courseRaw, settings) || HW.mapCourse(courseRaw || settings.rephactorDefaultCourse, settings);
      for (const it of parseBlock(h)) {
        items.push(
          HW.makeItem({
            platform: P,
            prefix: 'rp',
            course,
            title: it.title,
            due: it.due,
            link: location.origin + '/#!/dashboard',
            extra: it.hasSolve ? { rpCheck: true } : {}
          })
        );
      }
    }
    await HW.report({ platform: P, scope: 'rephactor', items, message: `Pending 里 ${items.length} 条` });
  }

  let checkMode = false;

  async function route() {
    if (checkMode) return;
    const h = location.hash;
    if (!(/dashboard/i.test(h) || h === '' || h === '#!/' || h === '#!')) return;
    try {
      await scanDashboard();
    } catch (e) {
      HW.setStatus(P, '出错：' + e.message, false);
    }
  }

  async function start() {
    // 先问后台：这个标签页是不是专门打开来检查某个作业的
    let who = {};
    try {
      who = (await chrome.runtime.sendMessage({ type: 'rpWhoAmI' })) || {};
    } catch (e) {}
    if (who.check) {
      checkMode = true;
      return runCheck(who.check).catch(() => {});
    }
    route();
  }

  window.addEventListener('hashchange', route);
  HW.onRescan(route);
  start();
})();
