# browser_binding 调查与修复

2026-09-26。用户确认失败发生在点击同意按钮之后、到达 GitHub 之前，所以失败阶段是初始同意事务的浏览器绑定，不是 GitHub 本人 ID 校验。

已用线上 Worker 核对 HTTP 响应：初始 Cookie 与 GitHub 上游 Cookie 均为 `__Host-` host-only、Secure、HttpOnly、SameSite=Lax、Path=/、无 Domain、Max-Age=600。跳转阶段的删除旧 Cookie 与设置新 Cookie 是两个独立 Set-Cookie，没有被合并。回调仍为 `https://your-worker.workers.dev/callback`。测试只保存属性与布尔结果，不保存 Cookie 值、state、授权码或 Token。

控制 HTTP Cookie jar 的公网测试可以通过两段绑定；真实用户浏览器此前没有通过初始绑定。尚无证据证明用户切换过配置文件，也不能把协议测试当成浏览器 Cookie 存储的实测。

新流程：

1. 本机 `http://127.0.0.1:8790/start` 是本轮单次入口，启动后只生成一条新的 OAuth 请求和 PKCE verifier。第二次使用本机入口返回 409，不重建链接。旧授权页与旧回调不能替代本轮 state。
2. Worker 首次 GET 开始官方 consent transaction，发送原有安全 Cookie，再以 303 进行同源 GET。第二次 GET 核实浏览器确实发回对应 Cookie，校验事务请求指纹后，才显示同意按钮。页面会显示 `Browser cookie receipt verified`。
3. 指纹仅以 SHA-256 摘要保存于项目 KV，600 秒过期；防止回执页面显示被改动的 client、redirect、scope 或 PKCE 请求。它不是新认证凭据，不替代官方加密事务。
   新版先检查事务有效期，再检查 Cookie。官方 helper 原本先检查 Cookie，所以 Cookie 已随 10 分钟期限过期的旧页面也可能表现为 browser_binding；新版明确区分 transaction_expired 与有效事务的 missing_cookie。此前页面具体点击时间未记录，不能断言实际原因一定是过期。
4. 用户点击 Continue 后，官方 `approveConsent` 再次进行完整绑定与单次事务校验。随后创建一次官方 upstream state 和 GitHub S256 challenge。先以 200 文档响应提交 HttpOnly Cookie，再开始顶层 GET 导航到 GitHub，避免直接 POST 重定向链。
5. GitHub 的 `/callback` 仍由官方 `finishUpstream` 校验 Cookie、state、事务有效期和单次使用，再交换 GitHub 授权码、验证本人数字 ID；MCP Token 仍要求原来的 S256 PKCE。

没有降低 Cookie 属性、移除 browser_binding 或取消 PKCE/state。真实 GitHub 登录通过之前，线上 `mcp_enabled` 保持 false；本人登录与安全验收通过后才启用公网只读入口。

浏览器会话：Windows 默认 HTTPS handler 是 Chrome。只打开一次无 OAuth 参数的本机入口，后续跳转全部由同一窗口完成，没有再次调用操作系统打开 GitHub，也不传递旧链接。用户应保持这一个窗口和配置文件，不复制链接到别的浏览器/无痕窗口。

若浏览器仍未发送 Cookie，会在同意按钮出现之前拒绝，并提供 `stage=consent_cookie_receipt`、`binding_reason=missing_cookie/cookie_mismatch` 等不含秘密的诊断。已经通过回执却在 POST 丢失 Cookie，阶段为 `consent_submission`；GitHub 返回时丢失则为 `github_callback`。网站或浏览器隐私设置的实际阻止原因仍需用户浏览器的结果确认，不会自动调整浏览器安全设置。

实现依赖官方 Provider 1.1.0 的 Cookie 名称算法；依赖版本已经锁定，升级该包时必须重跑回执、篡改、缺失 Cookie、回放和完整 OAuth 测试。每次登录额外使用一次 KV 指纹写入与删除，计入免费额度。

证据：`tests/browser-binding-result.json`（真实公网、控制 HTTP cookie jar）；`tests/oauth-result.json`（本地 workerd + 模拟 GitHub，包含真实 MCP 与 Token 到期测试）；`tests/remote-login-result.json`（真实 GitHub 浏览器登录，只有此报告成功才算本人登录通过）。

## GitHub 回调 TypeError 的后续修复

随后用户已经到达 `github_callback`，错误转为 TypeError。2026-09-26 在真实 Worker 创建独立测试事务，并使用明确无效的测试授权码，复现到 `operation=github_code_exchange`、`failure=redirect_refused`。此测试没有借用或打印用户的实际授权码。

身份请求改用 `redirect=manual`，明确拒绝任何 3xx；为 GitHub Token 请求补上固定 User-Agent。没有允许自动跳转，Client Secret/上游 Token 不会随重定向转发。诊断只返回固定操作名、分类和经过白名单的 GitHub 错误代号，不返回原始异常消息、响应体、URL、Cookie 或凭据。

同一个真实公网无效码测试随后返回 `OAuthError / identity_code_rejected / bad_verification_code`，确认原先的传输 TypeError 已消失，GitHub 正常拒绝无效码。报告在 `tests/identity-transport-result.json`。新增回归验证 GitHub Token 与用户资料端点的重定向均被拒绝。

随后用户完成新一轮实际浏览器授权，本地页面显示 `Authorization received`。`tests/remote-login-result.json` 于 2026-09-26 21:45 北京时间记录真实 GitHub 绑定的不可变用户 ID 与 SDK 授权码交换成功。此次流程没有复用旧授权链接，浏览器绑定、state 与 PKCE 均通过校验。完整 OAuth 23/23 与真实公网 MCP 8/8 测试通过后，公网只读入口已开启；验收 SDK 授权随后已撤销。

依据：[Cloudflare Headers](https://developers.cloudflare.com/workers/runtime-apis/headers/)、[Set-Cookie 属性](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)、本机官方 OAuth Provider 1.1.0 的 consent/upstream 实现。
