# 本人控制权限升级

2026-09-26 用户明确要求在现有 ChatGPT 公网连接中加入文件创建/修改/删除、PowerShell/CMD、鼠标/键盘/截屏，并确认“全部权限”。这更新了之前固定只读的任务范围；不重建 GitHub OAuth App、不删除现有 ChatGPT 连接、不改动全局 Codex/Clash。

## 授权和范围

仅 GitHub 绑定的 GitHub 账号 / 绑定的不可变用户 ID。新权限必须由新的 S256 PKCE OAuth 流程明确同意 `mcp:read mcp:control`，签发加密控制属性；旧 `mcp:read` Token、Refresh Token 和 Primary 账户不会自动获得控制权限。Worker 验证 Token、本人 ID、scope 与加密属性，再设置内部控制路由头。客户端伪造同名头不会被转发。

官方 OAuth Provider 默认在同一个客户端完成新同意时撤销该客户端先前的 grant，签发独立新 grant，而不是修改旧 Token 的权限。其他客户端的旧只读 grant 不受影响。ChatGPT 追加同意是在保留连接条目的前提下更新它的凭据，不需要删除连接或 OAuth App。

原只读路由仍是 8780 → 8770，文件仅限 tests/public。新控制路由是 8780 → 8772 → 独立 Commander / 8769 Windows-MCP。原 8765/8768 本地入口保持默认配置。所有本地端口绑定 127.0.0.1，VPC 和 Named Tunnel 资源保持原样。桌面服务只在已登录的本人会话工作。

控制授权可以访问当前 Windows 用户权限内的文件、程序和网络；没有管理员提权，不承诺测试目录隔离。保留命令组件自身校验，不提供修改网关配置的工具。`delete_file` 删除明确指定的单个文件，拒绝递归删除目录；命令工具具有当前用户的正常程序权限。桌面截图会包含当时屏幕上可见的信息，仅返回给本人授权的客户端。

## 开关与实测证据

`config/public-control.json.enabled` 是本地控制服务授权；Worker `CONTROL_AUTH_ENABLED` 控制新增 scope 是否可申请，`MCP_CONTROL_ENABLED` 控制公网控制调用。`MCP_ENABLED` 是总入口开关。任一所需条件缺失都会拒绝访问。`/healthz` 显示实时开关。

- 本地真实控制测试：`tests/control-local-result.json`，11/11 通过，文件增删改、PowerShell/CMD stdout 和退出码、stderr/退出码 7、鼠标点击、键盘输入、原生截图均通过。
- OAuth/workerd：`tests/control-oauth-result.json`，完整 33/33（包含真实到期等待）。模拟 GitHub 身份，真实本机 MCP，包含旧只读 Token 越权拒绝、控制开关关闭拒绝、身份/PKCE/browser_binding/state、到期、刷新和撤销；增加 ChatGPT 两种回调和 opaque state 原样回传测试。`tests/control-oauth-quick-result.json`，32/32；快速测试没有到期等待，不替代完整报告。
- 新的真实 GitHub 控制同意：`tests/control-login-result.json`，已成功换码；凭据保存在受保护 secrets/sdk-control-oauth.json，不记录在报告中。
- 公网实际控制调用：`tests/control-public-result.json`，11/11 全部通过，发现 35 个工具，真实文件创建/修改/删除、PowerShell/CMD、鼠标/键盘、截图。`tests/control-protocol-result.json`，6/6，通过官方 SDK 1/2、三个 2025 协议握手及 2026-07-28、JSON Schema 和真实读取；错误协议镜像仍拒绝。公网控制已通过匹配当前凭据的真实同意报告启用。
- ChatGPT 三类控制调用：尚待用户在现有连接追加同意后实测；之前 ChatGPT list_directory/read_file 已通过不等于控制验收通过。

后续遇到“缺少 OAuth 回调数据”时，后台生命周期与 Token 元数据已证明 ChatGPT 控制同意/换码成功；实际 OpenAI 客户端 tools/list 已走 control 路由并返回 200。不能据此声明文件/命令/桌面动作已由 ChatGPT 实测。详情见 [回调调查](chatgpt-callback-diagnostic.md)。

桌面测试程序使用专用 GPT-MCP Acceptance Window，固定文字与点击事件写入独立测试目录。先检查 Snapshot 中实际存在该窗口按钮与输入框，再允许输入。测试开始时曾发现隐藏测试窗口造成定位失败，已修正测试窗显示与 DPI 坐标，复测通过。测试未向 ChatGPT 发送消息；若网页输入框留有 MCP_KEYBOARD_OK，请手动清除未发送的测试文字。

## 现有 ChatGPT 连接追加权限

1. 保留 My Windows PC Read Only 和 Primary 账户；名称不决定权限。打开现有连接并点 Refresh。
2. 启用该连接的新聊天中发送：`我授权新增文件修改、PowerShell/CMD 和桌面控制。请调用 request_control_access 发起追加权限的 OAuth 登录，不要先执行控制操作。`
3. 手动完成新的授权页与 GitHub 登录。授权页必须明确显示 `mcp:read mcp:control` 和文件修改、命令、桌面说明；使用同一个浏览器配置文件。
4. 同意后刷新现有连接目录，新建聊天；应包含 write_file、edit_block、delete_file、start_process、desktop_Click、desktop_Type、desktop_Screenshot 等。仅看到 request_control_access 和读取工具表示尚未获得控制授权。
5. 先进行以下可回收验收，只操作本项目 canary，不操作工作文件。桌面实际操作先发起专用测试窗口再定位。

```text
使用 My Windows PC Read Only 的本人控制授权，在 <PROJECT_ROOT>\tests\control\chatgpt-canary.txt
创建内容 MCP_CHATGPT_CONTROL_ORIGINAL；读取确认后用 edit_block 改为 MCP_CHATGPT_CONTROL_MODIFIED，
再次读取确认，最后仅删除这个测试文件并列目录确认删除。
然后用 start_process 执行 CMD echo MCP_CHATGPT_CMD_OK 和
powershell.exe -NoLogo -NoProfile -NonInteractive -Command "Write-Output 'MCP_CHATGPT_PS_OK'; exit 0"，
报告实际 stdout 与退出码；只调用 desktop_Screenshot 验证截图返回，暂不点击其他应用。
```

工具返回 `insufficient_scope` 与 `mcp/www_authenticate` 只触发追加同意，没有绕过认证。官方要求同时声明工具 securitySchemes 和返回 OAuth challenge，详见 [OpenAI 认证文档](https://developers.openai.com/plugins/build/auth#triggering-authentication-ui)；刷新见 [连接测试文档](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata)。若界面没有出现追加同意，请提供可见按钮或脱敏错误，不要删除连接、提供 Token 或发送完整地址栏。

## 本机管理

```powershell
# 本地专用窗验收
powershell.exe -NoProfile -File <PROJECT_ROOT>\scripts\test-control.ps1
# 新一轮真实 OAuth 同意
powershell.exe -NoProfile -File <PROJECT_ROOT>\scripts\test-control.ps1 -LoginOnly
# 安全验收后只开放新增 scope，保持公网控制关闭
powershell.exe -NoProfile -File <PROJECT_ROOT>\scripts\deploy-worker.ps1 -PreparePublicControl
# 必须有通过且匹配当前凭据的真实控制同意报告
powershell.exe -NoProfile -File <PROJECT_ROOT>\scripts\deploy-worker.ps1 -EnablePublicControl
# 实际公网能力验收（只用专用测试文件和窗口）
powershell.exe -NoProfile -File <PROJECT_ROOT>\scripts\test-control.ps1 -Public
# 关闭控制，保留旧授权的公网只读
powershell.exe -NoProfile -File <PROJECT_ROOT>\scripts\deploy-worker.ps1 -EnablePublicReadOnly
# 关闭所有公网 MCP
powershell.exe -NoProfile -File <PROJECT_ROOT>\scripts\deploy-worker.ps1
```

关闭公网控制不会把既有控制 Token 自动降为只读；控制请求会被拒绝。旧只读授权仍正常。要同时停掉额外本地控制服务，先将 config/public-control.json.enabled 改为 false，再执行 restart.ps1。原本地和公网开关相互独立；默认 restart.ps1 不是公网权限撤销命令。

没有购买/升级云端套餐、域名、绑卡或付费服务。Workers Free 控制台确认仍待本人核对；VPC 免费 Beta 的未来定价和既有 KV 额度限制沿用 README。截图与测试运行记录留在 tests 下，均不在 public 子目录，不公开这些文件。
