// Rephactor：
//  - Dashboard（#!/dashboard）：读 Pending Assignments 列表
//  - 作业页（#!/exerciseAssignment/<id>）：数 "Solved!"，把进度报给后台；全部 Solved 的作业不会导出
(() => {
  const P = 'Rephactor';
  const SOLVED = /^solved!?$/i;
  const STATUS = /^(solved!?|unsolved|not (yet )?solved|attempted|not attempted|incomplete|in progress)$/i;

  function leafTexts() {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length === 0) {
        const t = HW.text(el);
        if (t && t.length < 30) out.push(t);
      }
    }
    return out;
  }

  async function checkAssignment(rpId) {
    const ready = await HW.waitFor(() => leafTexts().some((t) => STATUS.test(t)) || /\d+\s*(of|\/)\s*\d+\s*(exercises?\s*)?(solved|completed)/i.test(HW.text(document.body)), 20000);
    let solved = 0, total = 0;
    const m = HW.text(document.body).match(/(\d+)\s*(?:of|\/)\s*(\d+)\s*(?:exercises?\s*)?(?:solved|completed)/i);
    if (m) {
      solved = +m[1];
      total = +m[2];
    } else if (ready) {
      const leaves = leafTexts();
      solved = leaves.filter((t) => SOLVED.test(t)).length;
      total = leaves.filter((t) => STATUS.test(t)).length;
    }
    chrome.runtime.sendMessage({ type: 'rpProgress', rpId, solved, total });
  }

  async function scanDashboard(force) {
    const heading = await HW.waitFor(() =>
      [...document.querySelectorAll('h1,h2,h3,h4,h5,div,span')].find((e) => /^pending assignments$/i.test(HW.text(e)))
    , 15000);
    if (!heading) return;

    // 找包住 Pending Assignments 标题和作业链接的最小容器
    let box = heading.parentElement;
    while (box && !box.querySelector('a[href*="exerciseAssignment/"]')) box = box.parentElement;
    const links = [...(box || document).querySelectorAll('a[href*="exerciseAssignment/"]')];

    const settings = await HW.getSettings();
    const items = [];
    const seen = new Set();
    for (const a of links) {
      const rpId = (a.getAttribute('href').match(/exerciseAssignment\/([^/?#]+)/) || [])[1];
      if (!rpId || seen.has(rpId)) continue;
      seen.add(rpId);
      const row = HW.rowOf(a, 400);
      const rowText = HW.text(row);
      const titleEl = [...row.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b,[class*="title" i],[class*="name" i]')].find(
        (e) => HW.text(e) && !/solve them now/i.test(HW.text(e))
      );
      const title = titleEl
        ? HW.text(titleEl)
        : rowText.replace(/solve them now/gi, '').replace(/\bdue\b.*$/i, '').trim().slice(0, 80) || `Assignment ${rpId}`;
      const course = HW.findCourse(rowText, settings) || HW.mapCourse(settings.rephactorDefaultCourse, settings);
      items.push(
        HW.makeItem({ platform: P, prefix: 'rp', course, title, due: HW.dueFromText(rowText), link: a.href, extra: { rpId } })
      );
    }
    await HW.report({ platform: P, scope: 'rephactor', items, message: `Pending 里 ${items.length} 条（会自动检查是否全部 Solved）` });
  }

  async function route(force) {
    const h = location.hash;
    const m = h.match(/exerciseAssignment\/([^/?#]+)/);
    try {
      if (m) await checkAssignment(m[1]);
      else if (/dashboard/i.test(h) || h === '' || h === '#!/') await scanDashboard(force);
    } catch (e) {
      HW.setStatus(P, '出错：' + e.message, false);
    }
  }

  window.addEventListener('hashchange', () => route(false));
  HW.onRescan(route);
  route(false);
})();
