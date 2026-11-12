# 设置 Google Drive 同步（一次性）

扫描完成后，插件会自动把未完成作业写进 Drive 根目录的 `homework-assignments.json`。这个文件只有一个，每次覆盖。完成下面的设置后就不用再管了。

**扩展 ID 固定为 `blocejopldlhhloghadfgplefoagglci`**：manifest 里的 `key` 决定了这个 ID，重新加载或换电脑都不会变。第 4 步要用到它。
如果想要自己的扩展 ID，可以删掉 manifest 里的 `key`，加载插件后用 `chrome://extensions` 上显示的 ID。

---

## 0. 先确认 Chrome 用的是哪个 Google 账号

`chrome.identity.getAuthToken` 只能用 **Chrome 当前登录的那个 Google 账号**（右上角头像对应的账号），不能在登录窗口里另选账号。

- 打开 `chrome://settings/people` 查看当前账号。
- 文件会写进这个账号的 Drive。想用学校账号，就让这个 Chrome 个人资料登录学校账号；也可以单独新建一个 Chrome 个人资料登录学校账号，把插件装在那里。
- 连接成功后，插件弹窗会显示文件实际写进了哪个账号。

## 1. 新建 Google Cloud 项目

1. 打开 <https://console.cloud.google.com/>，右上角确认登录的是你要用的账号。
2. 点顶部的项目选择器 → **新建项目**，名称填 `homework-collector`。
3. 用学校账号建项目时，Organization 会显示学校的域名，而且必须选一个 **Parent resource**。点 **Browse**，选学校给个人项目用的文件夹（名字通常类似 `…-Personal-Projects`）。直接放在组织根目录下一般会提示没有权限。
4. 点 **创建**，然后**在顶部的项目选择器里选中这个新项目**。
   如果顶部还显示 "No organization"，或者没有选中任何项目，后面点「启用」时会报 *Permission Required*。

## 2. 启用 Google Drive API

1. 左上角菜单 → **API 和服务** → **库**。
2. 搜索 **Google Drive API**，点进去，点 **启用**。

## 3. 配置 OAuth 同意屏幕

1. 左侧菜单 → **API 和服务** → **OAuth 同意屏幕**（新版界面叫 **Google Auth Platform**）。没配置过的话点 **开始**。
2. **应用信息**：应用名称填 `Homework Collector`，用户支持邮箱选你自己。
3. **受众群体（Audience）**：
   - 有 **内部（Internal）** 选项（学校或公司账号）就选它：只限本组织账号使用，不需要测试用户，授权也不会 7 天过期。
   - 只能选 **外部（External）** 的话（个人 Gmail）：选外部，然后在 **测试用户** 里加上你自己的邮箱。
4. **联系信息**：填你的邮箱，同意政策，点 **创建**。
5. **数据访问（Data Access）** → **添加或移除范围**，搜索并勾选
   `https://www.googleapis.com/auth/drive.file`（只能访问插件自己创建的文件），保存。
6. 如果选的是外部：在 **受众群体** 页点 **发布应用**，切到「正式版」。`drive.file` 是非敏感权限，不用经过 Google 审核。
   不发布也能用，但「测试中」状态下授权每 7 天过期，到时要在弹窗里重新点「连接 Google Drive」。

## 4. 创建 Chrome 扩展用的 OAuth 客户端 ID

1. **Google Auth Platform → 客户端（Clients）**（或 **API 和服务 → 凭据 → 创建凭据 → OAuth 客户端 ID**）。
2. **应用类型**选 **Chrome 扩展程序（Chrome Extension）**。
3. 名称随便填，**商品 ID（Item ID）** 填扩展 ID：

   ```
   blocejopldlhhloghadfgplefoagglci
   ```

4. 点 **创建**，复制生成的客户端 ID（形如 `1234567890-abc...apps.googleusercontent.com`）。

## 5. 把 client_id 填进 manifest

打开 `manifest.json`，把

```json
"client_id": "PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com",
```

换成你复制的 ID。client_id 不是密码，放在扩展里没问题。

> 如果你 fork 了这个仓库，又不想把自己的 client_id 提交上去，可以运行
> `git update-index --skip-worktree manifest.json`，让 git 忽略本地的这处改动。

## 6. 重新加载插件并连接

1. 打开 `chrome://extensions`，在作业收集器卡片上点 **重新加载（↻）**。
   如果之前装的是没有 `key` 的旧版本，先 **移除**，再「加载已解压的扩展程序」，否则扩展 ID 不会变。
2. 确认卡片上显示的 ID 和第 4 步填的 Item ID 一致。
3. 点插件图标 → **连接 Google Drive** → 在弹出的窗口里允许访问。
4. 打开 Gradescope 之类的平台扫描一次，几秒后弹窗会显示「已同步 N 条」。
5. 在 Drive 根目录里确认出现了 `homework-assignments.json`。

之后每次扫描完都会自动上传，另外每小时也会同步一次，把过了截止时间的作业去掉。

---

## 常见问题

| 弹窗里的提示 | 原因和解决办法 |
|---|---|
| 还没在 manifest.json 里填 client_id | 第 5 步没做，或改完后没有重新加载插件 |
| manifest 里的 client_id 不对 / `bad client id` | 客户端类型不是「Chrome 扩展程序」，或者 Item ID 和扩展 ID 对不上 |
| 账号的管理员阻止了这个应用 / `access_denied` | 学校或公司的管理员不允许这个应用，见下面 |
| 还没连接 Google | 点「连接 Google Drive」。如果 Chrome 没登录 Google 账号，要先登录 |

### 被学校阻止时

学校的 Google Workspace 可能会拦截自己建的 OAuth 应用。这时可以换成个人 Gmail：用一个登录个人 Gmail 的 Chrome 个人资料装插件，Cloud 项目也用个人 Gmail 建（受众群体选外部，然后发布）。文件就会写进个人 Gmail 的 Drive。
