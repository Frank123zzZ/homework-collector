// Google Drive 同步：把导出的作业列表覆盖写进 Drive 根目录的 homework-assignments.json。
// 第一次新建文件并记下 fileId，之后一直更新同一个文件。由 background.js 加载。
(function (root) {
  const HW = root.HW;
  const Drive = (HW.Drive = {});
  const FILE_NAME = 'homework-assignments.json';
  const API = 'https://www.googleapis.com';

  Drive.FILE_NAME = FILE_NAME;

  Drive.clientIdMissing = function () {
    const id = ((chrome.runtime.getManifest().oauth2 || {}).client_id || '').trim();
    return !id || id.startsWith('PASTE_');
  };

  Drive.getToken = async function (interactive) {
    const r = await chrome.identity.getAuthToken({ interactive: !!interactive });
    return typeof r === 'string' ? r : r && r.token;
  };

  async function call(token, method, url, body, contentType) {
    const headers = { Authorization: `Bearer ${token}` };
    if (contentType) headers['Content-Type'] = contentType;
    const r = await fetch(url, { method, headers, body });
    if (!r.ok) {
      let detail = '';
      try {
        detail = ((await r.json()).error || {}).message || '';
      } catch (e) {}
      const err = new Error(`Drive ${r.status}${detail ? '：' + detail : ''}`);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }

  async function create(token, json) {
    const b = 'hwcollector' + Date.now();
    const meta = { name: FILE_NAME, mimeType: 'application/json' };
    const body =
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n--${b}--`;
    const r = await call(token, 'POST', `${API}/upload/drive/v3/files?uploadType=multipart&fields=id`, body, `multipart/related; boundary=${b}`);
    return r.id;
  }

  // 有 fileId 就覆盖内容；文件被删了（404）或在回收站里，就重新建一个
  Drive.upload = async function (token, fileId, json) {
    if (fileId) {
      try {
        const r = await call(
          token,
          'PATCH',
          `${API}/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,trashed`,
          json,
          'application/json; charset=UTF-8'
        );
        if (!r.trashed) return r.id;
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    }
    return create(token, json);
  };

  async function account() {
    try {
      const u = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
      return (u && u.email) || '';
    } catch (e) {
      return '';
    }
  }

  function explain(e) {
    const m = String((e && e.message) || e);
    if (/not granted|revoked|user is not signed in|did not approve|canceled|cancelled/i.test(m))
      return '还没连接 Google（点「连接 Google Drive」登录）';
    if (/invalid.*client|bad client id|oauth2/i.test(m)) return 'manifest 里的 client_id 不对：' + m;
    if (/admin|blocked|access_denied|org_internal/i.test(m)) return '账号的管理员阻止了这个应用：' + m;
    return m;
  }

  // 计算导出内容并上传。内容没变且上次成功时跳过（force 时强制上传）
  Drive.sync = async function ({ interactive = false, force = false } = {}) {
    const store = await chrome.storage.local.get(['items', 'rpProgress', 'drive']);
    const drive = store.drive || {};
    const list = HW.exportList(store.items || {}, await HW.getSettings(), store.rpProgress || {});
    const json = JSON.stringify(list, null, 2);
    const save = (patch) => chrome.storage.local.set({ drive: Object.assign({}, drive, patch) });

    if (Drive.clientIdMissing()) return save({ error: '还没在 manifest.json 里填 client_id（见 SETUP-GOOGLE.md）' });
    if (!force && drive.fileId && !drive.error && drive.lastContent === json) return;

    let token;
    try {
      token = await Drive.getToken(interactive);
      if (!token) throw new Error('not granted');
    } catch (e) {
      return save({ error: explain(e), errorAt: Date.now() });
    }

    try {
      let fileId;
      try {
        fileId = await Drive.upload(token, drive.fileId, json);
      } catch (e) {
        if (e.status !== 401) throw e;
        await chrome.identity.removeCachedAuthToken({ token });
        token = await Drive.getToken(false);
        fileId = await Drive.upload(token, drive.fileId, json);
      }
      await save({ fileId, lastSync: Date.now(), count: list.length, lastContent: json, error: null, account: await account() });
    } catch (e) {
      await save({ error: explain(e), errorAt: Date.now() });
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
