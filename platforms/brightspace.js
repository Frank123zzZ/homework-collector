// Brightspace (D2L)：用 Brightspace 自带的 Valence API（沿用你已登录的会话），
// 读所有在读课程的作业箱（Assignments）+ 日历里的待办项（quiz、讨论等）。
(() => {
  const P = 'Brightspace';
  if (location.pathname.startsWith('/d2l/login') || location.pathname.startsWith('/d2l/logout')) return;

  async function scan(force) {
    if (!force && !(await HW.throttle('brightspace:' + location.host, 15))) return;
    try {
      const settings = await HW.getSettings();
      const now = new Date();
      const vers = await HW.fetchJSON('/d2l/api/versions/');
      const ver = (code, fb) => ((vers || []).find((v) => v.ProductCode === code) || {}).LatestVersion || fb;
      const le = ver('le', '1.74');
      const lp = ver('lp', '1.43');

      // 1. 在读课程
      const courses = new Map();
      let bookmark = '';
      for (let page = 0; page < 10; page++) {
        const r = await HW.fetchJSON(
          `/d2l/api/lp/${lp}/enrollments/myenrollments/?orgUnitTypeId=3` +
            (bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : '')
        );
        for (const e of r.Items || []) {
          const acc = e.Access || {};
          if (acc.CanAccess === false || acc.IsActive === false) continue;
          if (acc.EndDate && new Date(acc.EndDate) < now) continue;
          courses.set(e.OrgUnit.Id, e.OrgUnit);
        }
        if (!(r.PagingInfo && r.PagingInfo.HasMoreItems)) break;
        bookmark = r.PagingInfo.Bookmark;
      }

      const courseOf = (ou) => {
        const o = courses.get(ou) || {};
        return HW.findCourse(`${o.Code || ''} ${o.Name || ''}`, settings) || HW.mapCourse(o.Name || o.Code || `OU ${ou}`, settings);
      };
      const key = (ou, name) => `${ou}|${String(name).toLowerCase().replace(/\s+/g, ' ').trim()}`;
      const byKey = new Map();
      const submittedKeys = new Set();

      // 2. 作业箱：有截止时间、还没截止的，查自己有没有提交
      for (const ou of [...courses.keys()].slice(0, 40)) {
        let folders = [];
        try {
          folders = await HW.fetchJSON(`/d2l/api/le/${le}/${ou}/dropbox/folders/`);
        } catch (e) {
          continue;
        }
        for (const f of folders || []) {
          if (f.IsHidden || !f.DueDate || new Date(f.DueDate) < now) continue;
          let submitted = false;
          try {
            const subs = await HW.fetchJSON(`/d2l/api/le/${le}/${ou}/dropbox/folders/${f.Id}/submissions/mysubmissions/`);
            submitted = (subs || []).some((s) => (s.Submissions || []).length > 0);
          } catch (e) {
            /* 查不到就当作没交，宁可多列 */
          }
          const k = key(ou, f.Name);
          if (submitted) {
            submittedKeys.add(k);
            continue;
          }
          byKey.set(
            k,
            HW.makeItem({
              platform: P,
              prefix: 'bs',
              course: courseOf(ou),
              title: f.Name,
              due: new Date(f.DueDate),
              link: `${location.origin}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${f.Id}&ou=${ou}`
            })
          );
        }
      }

      // 3. 跨课程的待办项（quiz、讨论、checklist 等），已完成或豁免的跳过
      try {
        const end = new Date(now.getTime() + 120 * 86400000);
        let url =
          `/d2l/api/le/${le}/content/myItems/due/?startDateTime=${encodeURIComponent(now.toISOString())}` +
          `&endDateTime=${encodeURIComponent(end.toISOString())}`;
        for (let page = 0; url && page < 10; page++) {
          const r = await HW.fetchJSON(url);
          for (const it of r.Objects || []) {
            if (it.IsExempt || it.DateCompleted) continue;
            const dueStr = it.DueDate || it.EndDate;
            if (!dueStr || new Date(dueStr) < now) continue;
            if (courses.size && !courses.has(it.OrgUnitId)) continue;
            const k = key(it.OrgUnitId, it.ItemName);
            if (byKey.has(k) || submittedKeys.has(k)) continue;
            byKey.set(
              k,
              HW.makeItem({
                platform: P,
                prefix: 'bs',
                course: courseOf(it.OrgUnitId),
                title: it.ItemName,
                due: new Date(dueStr),
                link: it.ItemUrl ? new URL(it.ItemUrl, location.origin).href : `${location.origin}/d2l/home/${it.OrgUnitId}`
              })
            );
          }
          url = r.Next || '';
        }
      } catch (e) {
        /* 老版本 Brightspace 没有这个接口，只用作业箱结果 */
      }

      const items = [...byKey.values()];
      await HW.report({ platform: P, scope: 'brightspace:' + location.host, items, message: `${courses.size} 门课，${items.length} 条未完成` });
    } catch (e) {
      if (e.status === 401 || e.status === 403) HW.setStatus(P, '未登录或会话过期', false);
      else HW.setStatus(P, '出错：' + e.message, false);
    }
  }

  HW.onRescan(scan);
  scan(false);
})();
