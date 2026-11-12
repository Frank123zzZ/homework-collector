const $ = (id) => document.getElementById(id);
const msg = (t) => ($('msg').textContent = t);

async function load() {
  const s = await HW.getSettings();
  $('courses').value = JSON.stringify(s.courses, null, 2);
  $('ignore').value = JSON.stringify(s.ignore, null, 2);
  $('rpAuto').checked = !!s.rephactorAutoCheck;
  $('rpCourse').value = s.rephactorDefaultCourse || '';
}

$('save').onclick = async () => {
  let courses, ignore;
  try {
    courses = JSON.parse($('courses').value);
    ignore = JSON.parse($('ignore').value);
    if (!Array.isArray(courses) || !Array.isArray(ignore)) throw new Error('需要是数组 [...]');
    for (const r of ignore) if (r.title) new RegExp(r.title, 'i');
  } catch (e) {
    return msg('格式有误，没有保存：' + e.message);
  }
  await chrome.storage.local.set({
    settings: { courses, ignore, rephactorAutoCheck: $('rpAuto').checked, rephactorDefaultCourse: $('rpCourse').value.trim() }
  });
  chrome.runtime.sendMessage({ type: 'refreshBadge' });
  msg('已保存。课程映射在下次扫描时生效，跳过规则立即生效。');
};

$('reset').onclick = async () => {
  await chrome.storage.local.remove('settings');
  await load();
  chrome.runtime.sendMessage({ type: 'refreshBadge' });
  msg('已恢复默认设置');
};

$('clear').onclick = async () => {
  if (!confirm('清空所有已收集的作业和扫描记录？（设置不受影响）')) return;
  await chrome.storage.local.remove(['items', 'status', 'lastScan', 'rpProgress']);
  chrome.runtime.sendMessage({ type: 'refreshBadge' });
  msg('已清空，重新打开各平台即可重新收集');
};

load();
