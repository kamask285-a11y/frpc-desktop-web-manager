# 新建 Node Web 项目规范

## 0. 适用范围

这份文档写给在这台 Mac mini 上创建或维护 Web 项目的 AI 与协作者。目标是：**新项目建成后不需要改动任何管理器代码**，就能被 Frpc-Desktop 的「Web 服务」模块扫描、启停、看日志，并在需要时一键发布到公网。

工作目录里（`NODE_PROJECT_STANDARD.md`）和管理工具仓库里（`docs/NODE_PROJECT_STANDARD.md`）各有一份，内容保持一致。

## 1. 目录与命名

- 项目放在管理器的「项目目录」下的**一级子目录**：`<项目目录>/<项目名>`。本机当前是 `/Volumes/Box-1T/Web`，默认值为 `~/Web`，可在管理器界面修改。
- 只扫描一级子目录，嵌套目录不会被视为独立项目；以 `.` 开头的目录会被跳过（适合放模板、备份、临时目录）。
- 项目名使用小写字母、数字和连字符，且首尾必须是字母或数字（`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`），因为这个值会直接作为公网域名前缀的建议值。
- 每个项目**必须**有顶层 `package.json`，否则不会被识别。

## 2. package.json 最低要求

```json
{
  "name": "my-service",
  "version": "1.0.0",
  "private": true,
  "description": "一句话说明这个服务做什么",
  "engines": { "node": ">= 22.12.0" },
  "scripts": {
    "start": "node server.js"
  }
}
```

- 必须提供 `start`、`dev`、`serve` 中的至少一个启动脚本；管理器按 `start` → `dev` → `serve` 的顺序自动选择，之后可以在界面上改。
- 启动脚本必须能**非交互运行**：不能等待输入、不能依赖 TTY、不能要求人工确认。
- 需要构建的项目把构建串进启动脚本，例如 `"start": "npm run build && node dist/server.js"`，保证点一次「启动」就能跑起来。

## 3. 端口由管理器注入，不要写死

```js
const port = Number.parseInt(process.env.PORT || "3000", 10);
server.listen(port, "127.0.0.1", () => {
  console.log(`listening on http://127.0.0.1:${port}`);
});
```

- 必须读取 `PORT` 环境变量。端口在管理器界面里配置，通过环境变量注入。
- 只监听回环地址 `127.0.0.1`。公网访问由 FRP 隧道 + 服务器 Caddy 反代完成，不要自己监听 `0.0.0.0:80/443`。
- 启动前管理器会检查端口占用，冲突会直接报错；改完端口在界面上点「重新发布」让隧道同步。
- 远程端口由域名推导（`SHA-256(完整域名)` 前 8 位 → 20000-29999），项目本身不需要关心。

## 4. 必须提供的行为

- **`/health`**：返回 200 与 JSON，例如 `{"status":"ok","port":3100}`。链路验证和排障都靠它。
- **`/`**：返回可读页面或基本信息，方便直接确认服务活着。
- **日志走 stdout/stderr**：管理器的「日志」抽屉只采集这两个流（保留最后 64KB）。需要留档的日志写到项目内，例如 `logs/`，并加入 `.gitignore`。

## 5. 优雅退出

```js
const shutdown = signal => {
  console.log(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

管理器的「停止」「重启」以及应用退出都会发 `SIGTERM` 并结束整个进程树。不要派生脱离管理的子进程；确实需要时，自己负责在退出时回收。

## 6. 数据、配置与密钥

- 运行数据（SQLite、上传文件、缓存）放在项目目录内，例如 `data/`；不要写进应用数据目录。
- 密钥、Token、密码用环境变量或项目内 `.env`，`.env` 必须写进 `.gitignore`，且不要出现在日志里。
- 端口、域名、回调地址等环境相关值不要硬编码。

## 7. 适配反向代理（公网发布）

服务实际运行在服务器 Caddy 之后：

- 生成绝对 URL 时使用相对路径，或读取 `X-Forwarded-Proto` / `X-Forwarded-Host`。
- WebSocket 与 SSE 可以直接使用（Caddy 会透传），但不要假设客户端能直连后端端口。
- 不要假设 `Host` 是 `127.0.0.1`，也不要把重定向目标写死成内网地址。

## 8. 依赖与兼容

- Node.js >= 22.12，优先零依赖或纯 JS 依赖。
- 需要原生模块时，确认存在 darwin-arm64 与 darwin-x64 预编译产物（本机是 Apple Silicon）。
- 不要依赖全局安装的命令行工具，依赖一律写进 `package.json`。

## 9. 项目内文档

每个项目至少包含：

- `README.md`：用途、启动命令、端口来源、健康检查地址、数据存放位置。
- `AGENTS.md`：项目级规则（本文件已覆盖的内容不必重复，只写项目特有的约定）。

## 10. 新项目清单

- [ ] 目录为 `<项目目录>/<项目名>`，名称符合 `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`
- [ ] 顶层有 `package.json`，含 `name` 与可用的启动脚本
- [ ] 读取 `PORT`，监听 `127.0.0.1`
- [ ] `/health` 返回 200 JSON
- [ ] 关键动作有 stdout/stderr 日志
- [ ] 处理 `SIGTERM` / `SIGINT`
- [ ] 数据与密钥不落在应用目录、不提交进仓库
- [ ] 有 `README.md` 与 `AGENTS.md`
- [ ] `git init` 并完成首个提交（提交信息用中文）
- [ ] 在管理器里：扫描 → 配置端口 → 启动 → 需要时「配置并启用公网访问」

## 11. 最小可用模板

`package.json`：

```json
{
  "name": "my-service",
  "version": "1.0.0",
  "private": true,
  "description": "Mac mini Web 服务",
  "engines": { "node": ">= 22.12.0" },
  "scripts": {
    "start": "node server.js"
  }
}
```

`server.js`（零依赖，可直接跑）：

```js
const http = require("node:http");

const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = "127.0.0.1";

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify({ status: "ok", port }));
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(
    '<!doctype html><meta charset="utf-8"><title>my-service</title><h1>my-service</h1>'
  );
});

server.listen(port, host, () => {
  console.log(`my-service listening on http://${host}:${port}`);
});

const shutdown = signal => {
  console.log(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

`README.md`：

````markdown
# my-service

用途：一句话说明。

## 运行

```sh
npm start
```

读取 `PORT` 环境变量（默认 3000），监听 `127.0.0.1`。健康检查：`/health`。
数据目录：`data/`。
````

`AGENTS.md`：

```markdown
# 项目说明

- 启动命令为 `npm start`，端口由 `PORT` 环境变量决定。
- 保留 `/health` 接口用于运行状态验证。
- 数据写在 `data/`，密钥走 `.env`（不提交）。
```

## 12. 管理器会怎么使用它

1. **扫描**：读取一级子目录的 `package.json`，生成项目记录并自动挑一个未占用的端口（从 3000 起）。
2. **启动**：在项目目录执行 `npm run <启动脚本>`，注入 `PORT`，捕获 stdout/stderr 作为日志。
3. **状态**：以进程存活与端口监听判断运行中。
4. **停止/重启**：`SIGTERM` 结束整个进程树。
5. **公网发布**：创建 FRP TCP 代理（`127.0.0.1:<本地端口>` → 远程端口），在服务器写入 Caddy 站点 `<域名前缀>.<基础域名>`，DNS 泛解析就绪后自动签发证书。
6. **重新发布**：改过端口或想重跑部署时使用，会按当前配置重建代理与站点文件。
