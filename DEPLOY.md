# 🚀 Render 部署指南（5 分钟）

## 第 1 步：创建 GitHub 仓库

1. 打开 https://github.com/new
2. 填写：
   - **Repository name**: `doudizhu`（或者别的英文名）
   - **Description**（可选）: `在线斗地主`
   - **Public** 或 **Private**（选 Private 也行）
3. ⚠️ **不要**勾选 Add a README / .gitignore / license（我们已经有了）
4. 点 **Create repository**

创建后会跳到一个空仓库页面，**先别关**，下面要用。

---

## 第 2 步：推送代码到 GitHub

打开 PowerShell，**复制下面整段命令**执行（把 `你的用户名` 替换成你的 GitHub 用户名）：

```powershell
cd D:\实验室\游戏\doudizhu

# 加远程仓库（用 HTTPS）
git remote add origin https://github.com/你的用户名/doudizhu.git

# 把 master 分支改名为 main（GitHub 默认 main）
git branch -M main

# 推送
git push -u origin main
```

### 第一次推送会让你登录

- **Username**: 你的 GitHub 用户名
- **Password**: ⚠️ **不是你的 GitHub 密码**，需要 Personal Access Token

### 怎么获取 Personal Access Token

1. 打开 https://github.com/settings/tokens
2. 点 **Generate new token** → **Generate new token (classic)**
3. 填写：
   - **Note**: `doudizhu deploy`（随便起名）
   - **Expiration**: 选 7 天或 30 天
   - **Scopes**: 勾选 `repo`（其它不用勾）
4. 点 **Generate token**
5. **复制那一长串字符**（只会显示一次！）
6. 回到 PowerShell 粘贴作为密码

---

## 第 3 步：在 Render 创建 Web Service

1. 打开 https://render.com 注册（用 GitHub 账号一键登录）
2. 登录后点右上角 **New +** → **Web Service**
3. 选 **Build and deploy from a Git repository** → 点 **Next**
4. 找到你刚创建的 `doudizhu` 仓库，点 **Connect**
5. 配置：
   ```
   Name:           doudizhu（会成为子域名的一部分）
   Region:         Oregon (US West) 或 Singapore（新加坡，国内快一点）
   Branch:         main
   Root Directory: server       ← 重要！别填错
   Runtime:        Node
   Build Command:  npm install
   Start Command:  node index.js
   Instance Type:  Free
   ```
6. 拉到最下面，点 **Create Web Service**

---

## 第 4 步：等部署完成

- 第一次部署大概 **2-3 分钟**
- 部署过程中会装依赖、启动服务
- 成功后页面会显示 `Your service is live 🎉`
- 上面会显示你的链接，类似：`https://doudizhu-xxxx.onrender.com`

---

## 第 5 步：发给同学

把链接发给同学，他们打开就能玩：

```
兄弟们，斗地主搞好了：
https://doudizhu-xxxx.onrender.com

一个人先点「创建房间」，把房间号（比如 ABCD）发我，我再加
```

---

## ⚠️ 注意事项

1. **免费版会休眠**：15 分钟没人访问，服务器会自动停。下次有人访问要等 **30 秒冷启动**。同学玩的时候不会卡。
2. **数据是临时的**：服务器重启会丢失所有房间。重启后再玩需要重新创建房间。
3. **第一次访问慢**：因为休眠冷启动，多等几秒。

---

## 🔄 改代码后重新部署

```powershell
cd D:\实验室\游戏\doudizhu
git add .
git commit -m "改了点东西"
git push
```

Render 会自动检测到 push 并重新部署（2-3 分钟）。
