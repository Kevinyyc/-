# 🃏 在线斗地主

一个轻量的网页版斗地主，3 人联机，发链接给同学就能玩。

## ✨ 功能

- 创建 / 加入房间（房间号 4 位）
- 完整斗地主规则：单 / 对 / 三带 / 顺子 / 连对 / 飞机 / 炸弹 / 火箭
- 抢地主流程
- 15 秒未操作自动托管
- 断线自动托管
- 一局结束后可重开

## 🛠 技术栈

- **后端**：Node.js + Express + Socket.IO
- **前端**：原生 HTML / CSS / JS（无框架，加载快）
- **存储**：纯内存（重启服务会清空房间，不影响一般玩）

## 🚀 本地开发

```bash
cd server
npm install
npm start
# 打开 http://localhost:3000
```

## 🧪 测试

```bash
cd server
# 单元 + 集成测试（验证房间/抢地主/出牌校验）
node test.js

# 端到端测试（完整一局 + 重开）
node test-e2e.js
```

## 🕹 怎么玩

1. 打开主页（`http://localhost:3000`）
2. 输入昵称，点「创建房间」
3. 复制链接（点「复制链接」按钮）发给同学
4. 同学打开链接，在主页输入你的房间号和昵称，点「加入」
5. 3 人到齐后自动开始抢地主

也可以**同机多窗口测试**：复制 `http://localhost:3000/?room=ABCD` 打开 3 个浏览器窗口（推荐隐身模式），分别输入不同昵称加入同一房间。

## 🌐 部署

### 方案 A：Render（国际平台，免费但 15 分钟无访问会休眠）

1. 把代码 push 到 GitHub
2. 去 [render.com](https://render.com) 注册
3. New → Web Service → 选你的 GitHub repo
4. 配置：
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
   - **Instance Type**: Free
5. 点 Create Web Service，等部署完成，会得到一个 `https://xxx.onrender.com` 的链接

⚠️ 免费版会休眠：15 分钟没人访问就自动停，下次访问需要等 30 秒冷启动。同学玩的时候不会卡，但空闲时偶尔慢一下。

### 方案 B：腾讯云开发 CloudBase（国内访问快）

适合发给国内同学，延迟低，但配置略复杂（需要实名 + 微信扫码）。

1. 去 [cloud.tencent.com](https://cloud.tencent.com) 注册，开通「云开发 CloudBase」
2. 新建环境，选「按量计费」（有免费额度）
3. 安装 CloudBase CLI：`npm install -g @cloudbase/cli`
4. 登录：`tcb login`（微信扫码）
5. 在 `doudizhu` 目录创建 `cloudbaserc.json`：

```json
{
  "version": "2.0",
  "envId": "你的环境ID",
  "framework": {
    "name": "doudizhu",
    "runtime": "Nodejs",
    "handlers": {
      "http": [
        { "path": "/", "method": ["GET", "POST", "PUT", "DELETE"] }
      ],
      "ws": [
        { "path": "/socket.io/" }
      ]
    }
  }
}
```

6. 创建 `server/package.json` 的启动脚本：`"start": "node index.js"`，并确保 `PORT` 从环境变量读（代码里已经做了）
7. 部署：`tcb framework deploy`

⚠️ Socket.IO 需要 WebSocket 支持，CloudBase 自带支持。

### 方案 C：自己的服务器 / VPS

```bash
# 在服务器上
git clone <你的 repo>
cd doudizhu/server
npm install
PORT=3000 nohup node index.js &
```

然后用 nginx 反代 + HTTPS，绑定域名。

## 📁 目录结构

```
doudizhu/
├── server/
│   ├── index.js       # Socket.IO 服务入口
│   ├── room.js        # 房间注册表
│   ├── game.js        # 单局游戏逻辑
│   ├── rules.js       # 牌型识别 + 大小比较
│   ├── test.js        # 集成测试
│   ├── test-e2e.js    # 端到端测试
│   └── package.json
├── public/
│   ├── index.html     # 主页（创建/加入）
│   ├── room.html      # 牌桌页
│   ├── css/style.css
│   └── js/
│       ├── main.js
│       └── game.js
└── README.md
```

## 🎯 简化决策（已实现）

- **抢地主**：3 人按座位轮流叫，第一个叫的当地主，全不叫则重新发牌（firstBidder 顺延）
- **AI**：暂无（必须 3 个真人；断线则自动托管）
- **牌型**：完整实现单/对/三带/顺子/连对/飞机/四带二/炸弹/火箭
- **超时**：15 秒未出牌自动托管（出最小合法牌）
- **断线**：标记离线，由托管机制继续操作

## 🔜 未来可加

- 简单 AI（可单机自测）
- 战绩 / 积分系统
- 聊天框
- 观战模式
- 美化卡牌素材
- 微信小程序版

## 📝 License

MIT
