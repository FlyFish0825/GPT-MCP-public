# ChatGPT “缺少 OAuth 回调数据”调查

2026-09-26，用户确认提示在 GitHub 登录成功返回 ChatGPT 后出现。之后 ChatGPT 已发现 12 个工具，包括 request_control_access，但控制工具目录尚未同步。

## 已确认的事实

- 只读入口和追加授权工具可以正常发现。并非服务完全离线。
- 只读取 Cloudflare KV 中的授权生命周期和 Token 元数据，过滤所有 ID、密文、授权码、Cookie、Secret、Token 内容。`tests/oauth-grant-lifecycle.json` 显示 2026-09-26 22:52:31 北京时间创建的 ChatGPT CIMD grant 属于本人，scope 为 mcp:read mcp:control；授权码已消费，Refresh 已签发，Access Token 的目标资源和两个 scope 正确。这证明后台换码已成功，不能因页面提示声称 GitHub 或 Token 换取失败。
- 2026-09-26 23:02:52 / 23:02:54 北京时间，临时诊断观察到命名为 OpenAI 客户端的 2026-07-28 server/discover / tools/list 返回 200，权限路由为 control。服务端已经向该客户端提供控制目录。
- 新版公网官方 SDK 1/2、四个协议版本、Schema 与真实读取继续 6/6 通过；控制目录为 35 个工具。测试使用独立 SDK grant，没有读取或复用 ChatGPT Token。
- 完整 OAuth 回归现为 33/33，包含 ChatGPT 稳定及独立客户端回调路径、包含特殊字符的 opaque state 原样返回、issuer 和 S256 PKCE 换码；到期等待保留。新增诊断字段的快速回归 32/32，不替代完整报告。

## 修复与诊断变化

Worker 在返回 OAuth 回调前再次核对原始 state、issuer 和授权码存在性；任何异常拒绝，不生成替代 state，不修改注册回调，不关闭 browser_binding 或 PKCE。增加 OAUTH_DIAGNOSTIC，仅记录阶段、状态码、参数存在性和已分类的回调类型；不记录值。MCP_DIAGNOSTIC 增加 read/control/none 权限路由，不记录客户端 ID 或 Token。

临时 tail 只从 Wrangler 事件中提取字段白名单，原始事件 URL、请求头及 body 不写入文件。输出在 logs/oauth-worker.jsonl 和 logs/discovery-worker.jsonl；不启用云端持久日志或付费服务。生命周期检查程序 diagnose-oauth-grants.mjs 仅读取已存在 KV 记录，报告不含凭据。

目前证据更支持 ChatGPT 页面或工具目录更新未完成，而非后台 OAuth 失败；没有独立读取 ChatGPT 前端存储，因此尚不能断言“缺少回调数据”的前端内部根因。不能声称控制操作已通过 ChatGPT 实测，直到用户确认真实调用。

## 保留现有连接的恢复步骤

用完成授权的同一个 Chrome 配置文件，在新标签页打开 https://chatgpt.com/plugins?view=personal，从列表进入现有 My Windows PC Read Only 并点击 Refresh。不要刷新之前的 OAuth 回调落地页面，不重放旧 code/state，不删除连接、OAuth App 或 Cookie。随后新建聊天启用连接。

后台已换取控制 Token 时无需重复调用 request_control_access。只有实际仍收到 insufficient_scope 才应发起新一轮授权。写入验收仅使用 tests/control 下的专用 canary，命令只输出固定标记；截图验收与鼠标/键盘测试窗口说明见 owner-control.md。

回调和追加同意要求依据 [OpenAI 官方认证文档](https://developers.openai.com/plugins/build/auth)；目录刷新依据 [官方连接测试](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata)。
