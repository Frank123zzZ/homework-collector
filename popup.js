const $ = (id) => document.getElementById(id);
const msg = (t) => ($('msg').textContent = t);

function fmtDue(iso) {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  if (m < 1440) return `${Math.round(m / 60)} 小时前`;
  return `${Math.round(m / 1440)} 天前`;
}

async function getList() {
  const { items = {}, rpProgress = {} } = await chrome.storage.local.get(['items', 'rpProgress']);
  return HW.exportList(items, await HW.getSettings(), rpProgress);
}

function renderDrive(drive) {
  const el = $('driveStatus');
  if (drive.error) {
    el.className = 'bad';
    el.textContent = '上传失败：' + drive.error + '（可以先用下面的「下载」或「复制 JSON」）';
  } else if (drive.lastSync) {
    el.className = 'ok';
    el.textContent = `已同步 ${drive.count} 条 · ${ago(drive.lastSync)}` + (drive.account ? ` · ${drive.account}` : '') + ` · Drive 根目录/homework-assignments.json`;
  } else {
    el.className = 'muted';
    el.textContent = '还没同步过，点「连接 Google Drive」';
  }
  $('driveConnect').textContent = drive.lastSync && !drive.error ? '重新连接' : '连接 Google Drive';
}

async function render() {
  const { status = {}, drive = {} } = await chrome.storage.local.get(['status', 'drive']);
  renderDrive(drive);
  $('plats').innerHTML = '';
  for (const p of HW.PLATFORMS) {
    const s = status[p];
    const row = document.createElement('div');
    row.className = 'plat';
    const b = document.createElement('b');
    b.textContent = p;
    const span = document.createElement('span');
    if (s) {
      span.textContent = `${s.message} · ${ago(s.at)}`;
      span.className = s.ok ? 'ok' : 'bad';
    } else span.textContent = '还没扫描过（登录后打开一次）';
    row.append(b, span);
    $('plats').append(row);
  }

  const list = await getList();
  $('count').textContent = `${list.length} 条`;
  $('list').innerHTML = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = '没有未完成作业，或还没扫描。';
    $('list').append(li);
  }
  const soon = Date.now() + 3 * 86400000;
  for (const it of list) {
    const li = document.createElement('li');
    const t = document.createElement('div');
    t.className = 't';
    const a = document.createElement('a');
    a.href = it.link || '#';
    a.target = '_blank';
    a.textContent = `[${it.course}] ${it.title}`;
    t.append(a);
    const m = document.createElement('div');
    m.className = 'm';
    const due = document.createElement('span');
    due.textContent = '截止 ' + fmtDue(it.due);
    if (new Date(it.due) < soon) due.className = 'soon';
    const meta = document.createElement('span');
    meta.textContent = `${it.platform} · ${it.kind}`;
    m.append(due, meta);
    li.append(t, m);
    $('list').append(li);
  }
}

$('download').onclick = async () => {
  const blob = new Blob([JSON.stringify(await getList(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'assignments.json';
  a.click();
  msg('已下载 assignments.json');
};

$('copy').onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(await getList(), null, 2));
  msg('已复制到剪贴板');
};

$('rescan').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  msg('扫描中…');
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'rescan' });
    msg(r && r.error ? '出错：' + r.error : '扫描完成');
  } catch (e) {
    msg('当前页不是支持的平台（先打开 Gradescope / WebAssign / Rephactor / ALEKS / Brightspace）');
  }
  render();
};

$('driveConnect').onclick = () => {
  msg('正在打开 Google 登录…（弹窗关掉也没关系，后台会继续）');
  chrome.runtime.sendMessage({ type: 'driveConnect' }).then(() => msg('完成'));
};
$('driveSync').onclick = () => {
  msg('同步中…');
  chrome.runtime.sendMessage({ type: 'driveSync' }).then(() => msg('完成'));
};

$('options').onclick = () => chrome.runtime.openOptionsPage();

chrome.storage.onChanged.addListener(render);
render();
