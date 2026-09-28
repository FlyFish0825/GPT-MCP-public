# 部署验收记录

更新：2026-09-26。项目位置 `<PROJECT_ROOT>`。本记录区分自动测试与真实用户/网页端验收。

**最新权限升级：** 用户后来明确授权公网文件增删改、PowerShell/CMD、鼠标/键盘/截屏。新版本通过真实 GitHub `mcp:read mcp:control` 同意后已启用本人控制，旧只读授权不自动升级。控制本地 11/11、真实公网 11/11、官方 SDK 1/2 与协议/Schema 6/6；完整 OAuth 回归 31/31（包含实际到期等待），另追加同客户端新同意撤销旧 grant 的快速回归 31/31。控制工具数 35，旧只读入口额外提供无控制操作的 request_control_access。详见 [本人控制权限](owner-control.md)。**ChatGPT 控制调用尚待追加同意和实际验收；下表的 ChatGPT 成功证据是之前的只读阶段。**

| 项目 | 证据与状态 |
|---|---|
| 本地文件、执行、HTTP/stdio、认证、桌面快照 | `tests/local-result.json`：17/17 通过；2026-09-26 重跑 |
| 公共源站隔离 | `tests/readonly-result.json`：7/7 通过；独立密钥、目录边界、junction、URL 拒绝、强制只读 |
| OAuth 安全 | `tests/oauth-result.json` / `tests/control-oauth-result.json`：31/31 通过；本地 workerd，GitHub 身份模拟，MCP 调用真实；实际 Token 到期等待、PKCE、Cookie/state、身份拒绝、授权码单次使用、刷新与撤销、新版协议镜像转发，以及旧 grant 无法越权和追加同意 challenge |
| 本地持久任务与恢复 | `tests/recovery-result.json`：8/8 通过；断开、网关/认证进程退出、CMake、取消、幂等与代理异常 |
| 本地桌面输入 | `tests/desktop-result.json`：4/4 通过；实际测试窗口、点击、文字输入、截图，完成后恢复只读；截图未公开 |
| 公网未认证访问与元数据 | HTTPS 验证：未认证/伪造 Token 返回 401；RFC 8414/9728、S256、只读 scope 正确 |
| 公网同意页与浏览器绑定 | 初始 303 Cookie 回执后显示同意页；提交 200 再顶层 GET 到 GitHub，官方 Cookie/state 校验保留。受控 HTTP cookie jar 验证见 `tests/browser-binding-result.json`，不能代替实际浏览器 |
| GitHub 请求传输 | `tests/identity-transport-result.json`：真实 Worker 到 GitHub 的无效码测试正常得到 `bad_verification_code`；重定向默认拒绝 |
| ChatGPT CIMD | 官方 `https://chatgpt.com/oauth/client.json` + 官方稳定回调，真实 Worker 接受并进入同意流程 |
| 真实 GitHub 本人登录 | `tests/remote-login-result.json`：3/3 通过；2026-09-26 21:45 北京时间，绑定的不可变用户 ID，SDK 成功换取 900 秒有效期 Token；用户确认 Authorization received |
| 公网真实工具调用 | `tests/remote-result.json`：本轮 7/7 通过；发现 11 个只读工具，实际读取 `MCP_MODIFIED`，危险工具/目录外访问拒绝，断开重连与 SDK 授权撤销 |
| Tunnel 中断恢复 | 前轮 2026-09-26 21:48 实际测试，Tunnel PID 14000 被停止后自动恢复为 6912，本地分离任务成功完成；本轮未重复停止 Tunnel |
| 新旧协议工具发现 | `tests/discovery-public-result.json`：6/6 通过，SDK 1/2、三个 2025 握手版本与 2026-07-28 请求流程，JSON Schema 校验与实际安全调用 |
| 实际公网撤销 | 测试 SDK 授权已撤销，Access 与 Refresh 均拒绝；缓存 Token 已清除。独立 ChatGPT 授权不受影响 |
| ChatGPT 当前账号连接与实际工具调用 | `tests/chatgpt-result.json`：用户确认现有 Primary 连接刷新工具成功，真实 list_directory 与 read_file 返回测试文件与 MCP_MODIFIED，2 行完整内容；服务器脱敏阶段记录佐证 200 |
| 开机启动 | 当前用户登录计划任务启动已实际验证；未进行物理 Windows 重启 |
| 免费套餐 | 没有购买/升级/绑定银行卡操作；订阅 API 查询权限 403，需控制台核实当前 Workers Free |
| 密钥 | 源码/配置/文档/日志精确匹配扫描没有找到当前受保护密钥；ACL 仅当前用户与 SYSTEM |
| npm 依赖 | `docs/npm-audit-final.json`：0 个已知漏洞；版本与校验值见 `component-manifest.json` |

之前只读工具发现修复的 Worker 版本为 **<DEPLOYMENT_ID>**，公共策略版本为 1.0.2。之后用户明确授权的本人控制部署版本为 **<DEPLOYMENT_ID>**（部署命令报告的版本，随后上传同一受保护凭据），公共策略 1.1.0。公网总开关与控制开关分别查询 `/healthz` 的 `mcp_enabled` 和 `control_enabled`。未认证访问继续拒绝；默认部署关闭所有公网，-EnablePublicReadOnly 关闭控制而保留只读；-EnablePublicControl 还检查本地控制、安全 OAuth 与匹配当前身份凭据的真实控制同意报告。详细控制证据见 owner-control.md，之前只读发现修复见 chatgpt-discovery-fix.md。

Cookie 仍为 Secure、HttpOnly、SameSite=Lax、Path=/、无 Domain，PKCE、state 与官方 browser_binding 均保留。实际登录已通过这些校验，但没有直接读取用户 Chrome 配置文件或 Cookie 存储，也不宣称已独立查明浏览器最初丢失 Cookie 的内部原因。

公开仓库不包含 GitHub Client Secret。若旧凭据曾经暴露，应在 GitHub 设置中撤销并重新生成，再按注册文档保存到本机受保护目录。

全局配置对比：OpenCodex 与主要 Clash 配置哈希不变；Codex 仅 `service_tier` 存在同期差异，Clash profiles 有 `name`/`now` 选择记录增加。没有覆盖这些同期变化；详细审计在 `existing-config-audit.json` 和 `config-selection-drift.json`。本项目没有修改全局 MCP 或代理设置。

旧 Access 测试报告属于已停用路线，不能作为当前 GitHub OAuth 的验收依据。Workers VPC 目前处于免费 Open Beta，不保证未来永远免费。KV 撤销存在最终一致性传播延迟，不能宣称全球瞬时撤销。物理断网、停止现有 Clash、Windows 重启尚未测试；Supervisor 自身退出需手动或下次登录恢复，登录前不提供桌面会话，机器重启未完成任务不自动重放。限制见 README。
