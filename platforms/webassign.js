// WebAssign：在课程首页（My Assignments）读作业列表。
// 首页不显示完成状态，所以逐个打开作业的 Assignment-Responses 页面看 "Total x/y"，满分算完成。
// 注意：不碰 webassign.net/v4cgi/student.pl（会跳到 Cengage 登出页）。
(() => {
  const P = 'WebAssign';

  async function scan(force) {
    const links = await HW.waitFor(() => {
      const l = document.querySelectorAll('a[href*="Assignment-Responses"]');
      return l.length ? [...l] : null;
    }, 15000);
    if (!links) return; // 不是课程首页

    const settings = await HW.getSettings();
    const header = [document.title, ...[...document.querySelectorAll('h1, h2, h3, [class*="course" i]')].slice(0, 40).map(HW.text)].join(' | ');
    const course =
      HW.findCourse(header, settings) ||
      HW.findCourse(HW.text(document.body).slice(0, 5000), settings) ||
      HW.mapCourse(HW.text(document.querySelector('h1')) || document.title, settings);

    if (!force && !(await HW.throttle('webassign:' + course.name, 10))) return;

    try {
      const seen = new Set();
      const items = [];
      const now = new Date();
      for (const a of links) {
        const href = a.href;
        if (seen.has(href)) continue;
        seen.add(href);

        const row = HW.rowOf(a);
        const due = HW.dueFromText(HW.text(row));
        if (due && due < now) continue;
        const title = HW.text(a) || HW.text(row).slice(0, 80);

        // 看分数判断是否完成
        let done = false;
        try {
          const r = await fetch(href, { credentials: 'include' });
          const html = (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
          const txt = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
          const m = txt.match(/Total\s*:?\s*([\d.]+|[–—-])\s*\/\s*([\d.]+)/i);
          if (m && /^[\d.]+$/.test(m[1])) done = parseFloat(m[1]) >= parseFloat(m[2]) - 1e-9;
        } catch (e) {
          /* 打不开就当作没完成 */
        }
        if (done) continue;
        items.push(HW.makeItem({ platform: P, prefix: 'wa', course, title, due, link: href }));
      }
      await HW.report({ platform: P, scope: 'webassign:' + course.name, items, message: `${course.name}：${items.length} 条未完成` });
    } catch (e) {
      HW.setStatus(P, '出错：' + e.message, false);
    }
  }

  HW.onRescan(scan);
  scan(false);
})();
