// ALEKS：页面是单页应用，进入某门课的 Assignments 表后，读表格里带 "Due" 列的行。
// 标注 ungraded 的、已完成的跳过。
(() => {
  const P = 'ALEKS';
  let last = '';

  const cellsOf = (row) =>
    [...row.children].filter((c) => /^(TD|TH)$/.test(c.tagName) || /cell|header/i.test(c.getAttribute('role') || ''));

  async function scan(force) {
    const settings = await HW.getSettings();
    const tables = [...document.querySelectorAll('table, [role="grid"], [role="table"]')];
    const items = [];
    let foundTable = false;

    const header = [document.title, ...[...document.querySelectorAll('h1, h2, h3, header, [class*="class" i]')].slice(0, 40).map(HW.text)].join(' | ');
    const course = HW.findCourse(header, settings) || HW.findCourse(HW.text(document.body).slice(0, 5000), settings) || HW.mapCourse('ALEKS', settings);

    for (const table of tables) {
      const rows = [...table.querySelectorAll('tr, [role="row"]')];
      const headIdx = rows.findIndex((r) => r.querySelector('th, [role="columnheader"]'));
      if (headIdx < 0) continue;
      const heads = cellsOf(rows[headIdx]).map(HW.text);
      const dueIdx = heads.findIndex((h) => /due/i.test(h));
      if (dueIdx < 0) continue;
      foundTable = true;
      let nameIdx = heads.findIndex((h) => /name|assignment|title/i.test(h));
      if (nameIdx < 0) nameIdx = 0;
      const statusIdx = heads.findIndex((h) => /status|score|progress|grade|complet/i.test(h));

      for (const row of rows.slice(headIdx + 1)) {
        const cells = cellsOf(row);
        if (cells.length <= dueIdx) continue;
        const rowText = HW.text(row);
        if (/ungraded/i.test(rowText)) continue;
        const status = statusIdx >= 0 && cells[statusIdx] ? HW.text(cells[statusIdx]) : '';
        const pending = /not (started|submitted|complete)|incomplete|in progress/i.test(status);
        if (!pending && /\b(completed?|submitted|done)\b|100\s*%/i.test(status)) continue;

        const title = HW.text(cells[nameIdx]);
        if (!title) continue;
        const due = HW.parseDate(HW.text(cells[dueIdx]));
        const a = row.querySelector('a[href]');
        items.push(HW.makeItem({ platform: P, prefix: 'al', course, title, due, link: a ? a.href : location.href }));
      }
    }
    if (!foundTable) return;

    const sig = JSON.stringify(items);
    if (!force && sig === last) return;
    last = sig;
    await HW.report({ platform: P, scope: 'aleks:' + course.name, items, message: `${course.name}：${items.length} 条未完成` });
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => scan(false).catch((e) => HW.setStatus(P, '出错：' + e.message, false)), 2000);
  }).observe(document.documentElement, { childList: true, subtree: true });

  HW.onRescan(scan);
  setTimeout(() => scan(false).catch(() => {}), 3000);
})();
