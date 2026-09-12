<a name="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Downloads][downloads-shield]][downloads-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/luckjiawei/frpc-desktop">
    <img src="public/logo/pack/1024x1024.png" alt="Logo" width="140">
  </a>

<h3 align="center">Frpc-Desktop</h3>

  <p align="center">
    🎉 FRP跨平台桌面客户端，可视化配置，轻松实现内网穿透！
    <br />
    支持所有frp版本 / 开机自启 / 可视化配置 / 免费开源
  </p>

  <p>🎊 <strong>下载量突破 10,000！感谢大家的支持！</strong></p>

  <p><a href="https://jwinks.com/p/frp/">📖 文档</a> &nbsp; <a href="https://jwinks.com/p/frpc-desktop-faq/">常见问题</a></p>

<a href="https://trendshift.io/repositories/12489" target="_blank"><img src="https://trendshift.io/api/badge/repositories/12489" alt="luckjiawei%2Ffrpc-desktop | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
<a href="https://hellogithub.com/repository/b0dc116e9f2e4b8188da5a6d3e1bd8a4" target="_blank"><img src="https://abroad.hellogithub.com/v1/widgets/recommend.svg?rid=b0dc116e9f2e4b8188da5a6d3e1bd8a4&claim_uid=8ZMOhz30mGJAHpa" alt="Featured｜HelloGitHub" style="width: 250px; height: 54px;" width="250" height="54" /></a>
</div>

> 💡 如果你更喜欢 **Web 界面**，试试 [Podux](https://github.com/luckjiawei/podux) —
> 基于浏览器的 frpc 可视化管理工具。

## TODO

- [x] 开机自启动
- [x] 适配多用户 user & meta_token
- [x] 便携版
- [x] 增加udp代理类型
- [x] 支持快速分享frps
- [x] 增加快速选择本地端口
- [x] 支持stcp代理类型
- [x] 通过镜像站下载frp
- [x] 支持所有配置的导入导出
- [x] 一键清空所有配置
- [x] 支持导入识别frpc.toml
- [x] tcp、udp协议支持批量端口
- [x] support multiple languages
- [x] 支持代理快速搜索及卡片/列表分页
- [x] 本机 Node.js Web 服务管理与 FRP 代理快捷配置

## Web 服务管理

将 Node.js 项目放在 `/Volumes/Box-1T/Web` 下。一级项目目录包含
`package.json` 时即可被识别。在侧栏打开“Web 服务”，可以扫描项目、选择 npm
启动脚本、配置服务端口、启动或停止进程、查看日志，并使用项目本地端口快速创建
TCP 或 HTTP FRP 代理。

配置的端口通过 `PORT` 环境变量传给项目。项目至少需要提供一个 npm script；默认
按 `start`、`dev`、`serve` 的顺序选择启动脚本。

退出应用时会先停止由它启动的项目进程，再停止 frpc，因此不会残留占用端口的孤儿
进程；下次启动应用时，勾选了“自动启动”的项目会重新拉起。这意味着应用退出期间，
由它发布的站点会暂时下线。

## 公网访问管理

在“Web 服务”页面点击“服务器设置”，配置一台通过 SSH 管理的公网网关（例如香港
Ubuntu 服务器）：

```text
SSH 地址：43.154.60.195
SSH 端口：22
SSH 用户：deploy
SSH 私钥文件：~/.ssh/xxx（留空则使用 SSH 默认密钥）
基础域名：work.199227.xyz
服务器公网 IP：43.154.60.195
Caddy 站点配置目录：/etc/caddy/acli.d/sites
Caddyfile 路径：/etc/caddy/Caddyfile
```

首次使用需先“确认服务器指纹”，再“测试连接”。指纹保存在应用数据目录的
`ssh/known_hosts` 中，只对本应用生效；私钥内容不会写入数据库或日志，应用也不会
保存服务器密码。

配置完成后，在项目卡片点击“公网访问”，填写域名前缀即可看到自动计算结果：

```text
域名前缀：notes
完整域名：notes.work.199227.xyz
本地端口：3000
FRP 远程端口：26556（由域名 SHA-256 前 8 位推导，范围 20000-29999）
```

点击“配置并启用公网访问”后，应用会依次启动本地服务、创建 TCP 代理、等待 FRP
后端可用，再通过 SSH 部署 Caddy 站点文件并执行 `caddy fmt`、`caddy validate`
和 reload。整个过程失败时会回滚已创建的代理和站点文件，并保留错误原因。

部署完成后只需要手动添加一条 DNS 记录：

```text
类型：A
主机记录：notes
记录值：43.154.60.195
```

DNS 生效后点击“重新验证”，公网访问状态会变为“公网正常”。“取消公网访问”会删除
服务器 Caddy 站点文件（移动到站点目录下的备份目录）和本地 FRP 代理，但不会删除
项目源码；“从管理器移除”会在此之上停止服务并移除管理记录。

远程操作由 `electron/scripts/web-gateway.sh` 完成，该脚本通过 SSH 标准输入直接
执行，不会在服务器上安装常驻服务；`REMOTE_PORT` 只对服务器本机的 Caddy 开放，
不需要在云安全组中放行。

远程端口由完整域名决定，因此同一域名在 Mac 与服务器上会得到相同端口。修改已发布
项目的域名前缀前必须先取消公网访问，避免新旧配置同时存在。


## 常见问题

### macOS universal 构建在 better-sqlite3 预编译文件处失败

使用 electron-builder 26 构建时，请保留 `electron-builder.json5` 中的 `mac.x64ArchFiles` 规则。该规则允许 better-sqlite3 随包携带、在两个架构包中内容相同的 `darwin-x64.node` 和 `darwin-arm64.node` 保留在 universal 应用中，运行时由 better-sqlite3 选择匹配的架构文件。在 macOS 上运行 `npm run build:electron:mac` 重新构建。

## 里程碑

- 2026-05-21: 发布v1.2.6版本 增加下载代理选择
- 2026-03-26: 发布v1.2.5版本 修复已知BUG
- 2025-09-10: 发布v1.2.3版本 修复已知BUG，支持代理协议，优化性能
- 2025-04-22: 发布v1.2.2版本 修复已知BUG，支持HTTP路径设置
- 2025-03-25: 发布v1.2.1版本 修复已知BUG，支持英文
- 2025-03-06: 发布v1.2.0版本 底层重构，提高稳定性
- 2025-01-09: 发布v1.1.6版本
- 2024-12-04: 发布v1.1.5版本 优化体验、支持修改webport、解决github限流问题、日志优化
- 2024-11-08: 发布v1.1.4版本 修复已知BUG
- 2024-10-14: 发布v1.1.3版本 支持xtcp协议、优化体验
- 2024-09-25: 发布v1.1.2版本 支持 http basic、子域名
- 2024-09-07: 发布v1.1.0版本 支持批量端口、支持单条代理开关控制
- 2024-08-24: 发布v1.0.9版本 支持镜像下载、导出导入配置
- 2024-08-17: 发布v1.0.8版本 支持stcp代理
- 2024-08-11: 发布v1.0.7版本
- 2024-08-09: 发布v1.0.6版本
- 2024-08-06: 发布v1.0.5版本
- 2024-08-06: 发布v1.0.4版本 适配支持多用户插件
- 2024-07-17: 发布v1.0.3版本 修复已知bug 增加开机自启 增加删除frp版本
- 2024-01-29: 发布v1.0.2版本 增加Linux客户端和代理模式
- 2023-12-01: 发布v1.0.1版本
- 2023-11-28: 发布v1.0版本

## 社区

广告勿进！！！

### TG

[https://t.me/+4kziSBL3LxVmYzVl](https://t.me/+4kziSBL3LxVmYzVl)

### 微信群

**~~微信扫描加入开源项目交流群~~ 微信群超过200人无法扫码进群 关注公众号进群**



 <img src="screenshots/wechat-qr.png" alt="二维码" width="200"><img src="screenshots/mp_qr.jpg" alt="公众号二维码" width="200">

## 演示

![launch](https://github.com/luckjiawei/frpc-desktop/blob/main/screenshots/zh/launch.png?raw=true)

![proxys manager](https://github.com/luckjiawei/frpc-desktop/blob/main/screenshots/zh/proxy.png?raw=true)

![frp download](https://github.com/luckjiawei/frpc-desktop/blob/main/screenshots/zh/download.png?raw=true)

![config](https://github.com/luckjiawei/frpc-desktop/blob/main/screenshots/zh/config.png?raw=true)

![logger](https://github.com/luckjiawei/frpc-desktop/blob/main/screenshots/zh/logger.png?raw=true)

![about](https://github.com/luckjiawei/frpc-desktop/blob/main/screenshots/zh/about.png?raw=true)

## 捐赠

👉👉👉[点击去捐赠](https://jwinks.com/donate/)👈👈👈

## 贡献者

<a href="https://github.com/luckjiawei/frpc-desktop/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=luckjiawei/frpc-desktop" />
</a>

## License

[MIT](LICENSE)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=luckjiawei/frpc-desktop&type=Date)](https://star-history.com/#luckjiawei/frpc-desktop&Date)
<!-- MARKDOWN LINKS & IMAGES -->

[downloads-shield]: https://img.shields.io/github/downloads/luckjiawei/frpc-desktop/total.svg?style=for-the-badge

[downloads-url]: https://github.com/luckjiawei/frpc-desktop/releases

[forks-shield]: https://img.shields.io/github/forks/luckjiawei/frpc-desktop.svg?style=for-the-badge

[forks-url]: https://github.com/luckjiawei/frpc-desktop/network/members

[stars-shield]: https://img.shields.io/github/stars/luckjiawei/frpc-desktop.svg?style=for-the-badge

[stars-url]: https://github.com/luckjiawei/frpc-desktop/stargazers

[issues-shield]: https://img.shields.io/github/issues/luckjiawei/frpc-desktop.svg?style=for-the-badge

[issues-url]: https://github.com/luckjiawei/frpc-desktop/issues

[license-shield]: https://img.shields.io/github/license/luckjiawei/frpc-desktop.svg?style=for-the-badge

[license-url]: https://github.com/luckjiawei/frpc-desktop/blob/master/LICENSE
