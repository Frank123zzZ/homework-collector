// Rephactor：Dashboard 上 "Your Pending Assignments in <课程>" 下面列的就是还没做的作业。
// 每条的结构是：
//   QC-Day-19                       ← 标题（ES 作业旁边还有 "Solve Them Now" 按钮）
//   Quick checks of the Day 19 content
//   Due: Nov 16, 2026 8:00 am EST
// 列表以 "Show Past Assignments" 按钮结束。
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
    for (i = i + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^show past assignments$|^your (grades|books|courses)\b|^your pending assignments\b/i.test(l)) break;
      if (/^due\s*:/i.test(l)) {
        const title = (block[0] || '').replace(/\s*solve them now\s*/i, '').trim();
        if (title) out.push({ title, due: HW.parseDate(l.replace(/^due\s*:\s*/i, '')) });
        block = [];
      } else if (!/^solve them now$/i.test(l)) {
        block.push(l);
      }
    }
    return out;
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
        items.push(HW.makeItem({ platform: P, prefix: 'rp', course, title: it.title, due: it.due, link: location.origin + '/#!/dashboard' }));
      }
    }
    await HW.report({ platform: P, scope: 'rephactor', items, message: `Pending 里 ${items.length} 条` });
  }

  async function route() {
    const h = location.hash;
    if (!(/dashboard/i.test(h) || h === '' || h === '#!/' || h === '#!')) return;
    try {
      await scanDashboard();
    } catch (e) {
      HW.setStatus(P, '出错：' + e.message, false);
    }
  }

  window.addEventListener('hashchange', route);
  HW.onRescan(route);
  route();
})();
