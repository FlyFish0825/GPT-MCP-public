# GitHub OAuth App 注册（免费）

在你自己的 GitHub 账号登录后打开 https://github.com/settings/applications/new 。这里只创建 OAuth App，不订阅任何付费服务。

| 字段 | 精确值 |
|---|---|
| Application name | My Windows PC Read Only |
| Homepage URL | https://your-worker.workers.dev/healthz |
| Application description | Private authenticated read-only MCP access to my Windows test folder. |
| Authorization callback URL | https://your-worker.workers.dev/callback |
| Enable Device Flow | 不勾选 |

点击 Register application，然后 Generate a new client secret。Client ID 和 Client Secret 是此应用的开发凭据；不是你的 GitHub 密码。不要把 Secret 或截图发到聊天。

在本机 PowerShell 运行（替换为你自己的 GitHub 用户名）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File <PROJECT_ROOT>\scripts\configure-identity.ps1 -GitHubUsername "你的GitHub用户名"
```

脚本会从 GitHub 官方公开 API 解析数字用户 ID，提示输入 Client ID，再隐藏输入 Client Secret。密钥仅写入已经限制 ACL 的 `<PROJECT_ROOT>\secrets\identity-client.json`；数字用户 ID 写入公开配置。Codex 会完成 Worker Secret 上传、部署和后续测试。创建应用后回复“已注册并保存”，并提供 GitHub 用户名即可，无需任何密钥。

GitHub 登录只请求 `read:user`，不请求 repo、组织、SSH key、代码写入或邮箱权限。Worker 校验 GitHub 官方 `/user` 返回的不可变 ID，其他账号不能获得 MCP Token。MCP 与 GitHub 两段授权码流程均使用 S256 PKCE，并由官方 OAuth Provider 绑定浏览器 Cookie、state 和单次授权请求。

依据：https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app 和 https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps 。
