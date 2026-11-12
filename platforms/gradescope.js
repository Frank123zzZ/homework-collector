// Gradescope：在任意 Gradescope 页面上，抓取当前学期所有课程的作业表，保留 "No Submission" 的作业
(() => {
  const P = 'Gradescope';

  async function scan(force) {
    if (!force && !(await HW.throttle('gradescope', 10))) return;
    try {
      const settings = await HW.getSettings();
      const { doc, url } = await HW.fetchDoc('/account');
      if (/\/login/.test(url) || doc.querySelector('#session_email')) return HW.setStatus(P, '未登录', false);

      const term = doc.querySelector('.courseList--coursesForTerm');
      const boxes = [...(term || doc).querySelectorAll('a.courseBox[href^="/courses/"]')];
      if (!boxes.length) return HW.setStatus(P, '没找到课程（页面结构可能变了）', false);

      const items = [];
      for (const box of boxes) {
        const short = HW.text(box.querySelector('.courseBox--shortname'));
        const long = HW.text(box.querySelector('.courseBox--name'));
        const found = HW.findCourse(`${short} ${long}`, settings);
        const course = found || HW.mapCourse(short || long, settings);
        const courseUrl = new URL(box.getAttribute('href'), location.origin).href;
        const { doc: cd } = await HW.fetchDoc(courseUrl);

        for (const tr of cd.querySelectorAll('#assignments-student-table tbody tr')) {
          const th = tr.querySelector('th') || tr.cells[0];
          if (!th) continue;
          const status = HW.text(tr.querySelector('.submissionStatus')) || HW.text(tr);
          if (!/no submission/i.test(status)) continue;

          const title = HW.text(th.querySelector('a, button') || th);
          const dueEl = tr.querySelector('time.submissionTimeChart--dueDate') || tr.querySelector('time');
          const due = HW.parseDate((dueEl && dueEl.getAttribute('datetime')) || HW.text(dueEl));

          let link = courseUrl;
          const a = th.querySelector('a[href]');
          const btn = th.querySelector('[data-post-url]');
          if (a) link = new URL(a.getAttribute('href'), location.origin).href;
          else if (btn) {
            const m = btn.getAttribute('data-post-url').match(/^\/courses\/\d+\/assignments\/\d+/);
            if (m) link = location.origin + m[0];
          }
          items.push(HW.makeItem({ platform: P, prefix: 'gs', course, title, due, link }));
        }
      }
      await HW.report({ platform: P, scope: 'gradescope', items, message: `${boxes.length} 门课，${items.length} 条未提交` });
    } catch (e) {
      HW.setStatus(P, '出错：' + e.message, false);
    }
  }

  HW.onRescan(scan);
  scan(false);
})();
