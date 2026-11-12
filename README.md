# 作业收集器 Homework Collector（Chrome 插件，Manifest V3）

登录 Gradescope、WebAssign、Rephactor、ALEKS、Brightspace 时，插件会读取作业列表，只保留**未提交、未过截止时间**的作业，汇总到一起：在弹窗里查看，导出成 `assignments.json`，或者自动同步到 Google Drive。插件不保存、也不填写任何密码，只使用你在浏览器里已经登录的状态，数据只存在本地和你自己的 Drive 里。

## 安装

1. 打开 `chrome://extensions`
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择这个文件夹（`homework-collector`）

## 使用

| 平台 | 打开哪个页面就会扫描 | 怎么判断没做完 |
|---|---|---|
| Gradescope | 任意页面（每 10 分钟最多扫描一次，会抓当前学期所有课程） | 状态是 "No Submission" |
| Brightspace | 任意 `/d2l/` 页面（每 15 分钟最多扫描一次，通过 Brightspace 自己的 API 读取所有课程） | 作业箱里没有你的提交；其他待办项没有完成记录 |
| WebAssign | 每门课的课程首页（My Assignments）。从 Cengage dashboard 点 OPEN WEBASSIGN 进入 | 逐个打开作业，看 `Total x/y` 是不是满分 |
| Rephactor | `#!/dashboard`，读取 Pending Assignments | 在后台标签页打开每个作业，数 "Solved!"，全部 Solved 才算完成 |
| ALEKS | 进入课程后的 Assignments 表 | 跳过 ungraded 和已完成的作业 |

点工具栏里的插件图标可以查看每个平台的扫描状态和作业列表，还可以：
- **下载 assignments.json**：下载后导入作业看板
- **复制 JSON**：复制到剪贴板
- **重新扫描当前页**：忽略 10 到 15 分钟的扫描间隔，马上扫描

图标上的数字是当前未完成作业的数量。

## 自动同步到 Google Drive

每次扫描完成后，插件会把完整列表**覆盖**写进 Drive 根目录的 `homework-assignments.json`（只有这一个文件，用保存在本地的 file ID 更新）。另外每小时也会同步一次，把过了截止时间的作业去掉。上传失败时，弹窗里会显示原因，这时可以先用「下载」或「复制 JSON」。

第一次使用前需要在 Google Cloud Console 里做一次设置，并把自己的 OAuth client_id 填进 `manifest.json`，步骤见 **[SETUP-GOOGLE.md](SETUP-GOOGLE.md)**。不用 Drive 同步也行，插件的其他功能照常可用。

## 导出格式

```json
[
  {
    "id": "gs-dm-hw11",
    "course": "Discrete Math",
    "title": "HW11",
    "platform": "Gradescope",
    "kind": "作业",
    "due": "2026-11-24T23:59:00-05:00",
    "link": "https://www.gradescope.com/courses/.../assignments/..."
  }
]
```

- `id` = 平台前缀（gs / wa / rp / al / bs）+ 课程缩写 + 标题。标题以章节号开头时（如 `5.1 Sequences`）只用章节号，例如 `wa-dm-5.1`
- `kind`：标题里有 exam / midterm / final / quiz / test 的标为 `考试`；有 project / essay / paper 的标为 `项目`；其余为 `作业`
- `due`：统一换算成美东时间（America/New_York），带时区偏移

## 个人设置

有两个地方可以改，设置页里保存的优先级更高：

- **设置页**（插件图标 → 设置）：直接编辑课程映射和跳过规则，也可以开关 Rephactor 自动检查。
- **`local-settings.js`**：把自己的默认值写在这里，会覆盖 `common.js` 里的通用默认值。例如：

```js
self.HW_LOCAL_SETTINGS = {
  // 平台上的课程名里出现 match 中任意一项（忽略大小写和符号），就显示成 name；abbr 用来生成 id
  courses: [
    { match: ['MATH 2310', 'Discrete Math'], name: 'Discrete Math', abbr: 'dm' },
    { match: ['CS 101'], name: 'CS101', abbr: 'cs101' }
  ],
  // 满足一条就不导出：platform / course 精确匹配（可省略），title 是正则（忽略大小写）
  ignore: [
    { platform: 'Gradescope', course: 'CS101', title: 'homework|(^|[^a-z])hw\\s*\\d' }
  ],
  rephactorDefaultCourse: 'CS101'
};
```

不想把个人设置提交到 git，可以运行 `git update-index --skip-worktree local-settings.js`。

## 已知限制

- Gradescope 和 Brightspace 按这两个平台公开的页面结构和 API 编写，可靠性最高。
- WebAssign、Rephactor、ALEKS 的页面是动态生成的，插件用通用规则识别页面元素（找链接、日期和表头），还没有在真实页面上充分测试。如果某个平台的状态显示 0 条，或标题、日期不对，需要按实际页面调整 `platforms/` 里对应的文件。
- 截止时间统一按美东时间（America/New_York）输出。在其他时区使用时，要改 `common.js` 里的 `TZ`。
- Brightspace 课程公告里提到的考试日期不会被抓取。
