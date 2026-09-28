# Windows MCP 部署报告

2026-09-26，北京时间。工作目录：`<PROJECT_ROOT>`。

**后续权限升级状态：** 用户已明确授权现有公网连接的文件增删改、PowerShell/CMD 和桌面控制。已保留原 Worker/Tunnel/OAuth App/ChatGPT 连接，实现新的 mcp:control 同意；用户真实 GitHub 同意已成功。控制本地与实际公网测试各 11/11，SDK 1/2 与四个协议版本验收 6/6，完整 OAuth 31/31，额外 grant 替换回归通过。公网控制开关已开启，仅新的本人控制 grant 能进入 8772/8769；旧只读 grant 保持原政策。ChatGPT 仍需在原连接完成追加同意及三类能力实测。当前权限与操作步骤以 [owner-control.md](owner-control.md) 和实时 healthz 为准。以下十项保留此前只读阶段的部署结果，不能用它们声明新增 ChatGPT 控制已验收。

1. **状态：服务部署、安全验收与 ChatGPT 实际调用已通过。** 真实 GitHub 本人 OAuth 已成功，公网只读已开启；用户确认现有 Primary 连接刷新目录、list_directory 和 read_file 实测成功。Workers Free 控制台确认仍待用户结果，不能据订阅 API 403 声称已确认 Free。
2. **实际架构：** 现有 Worker + 官方 workers-oauth-provider + KV → Workers VPC → 现有 Named Tunnel → 本机独立认证 → Supergateway → 固定只读策略 → 隔离的 Desktop Commander。Windows-MCP 桌面接口留在本机回环，没有经过 Tunnel。
3. **本地入口：** 文件/任务 MCP 为 `http://127.0.0.1:8765/mcp`，Windows-MCP 为 `http://127.0.0.1:8768/mcp/`；均需本地认证。项目 `.codex/config.toml` 提供默认只读 stdio 接入。所有本项目 TCP 监听地址均为 127.0.0.1。
4. **公网入口：** https://your-worker.workers.dev/mcp 。部署版本 `<DEPLOYMENT_ID>`；公共策略 1.0.2，`/healthz` 实测 `mcp_enabled=true`。未认证/伪造凭据拒绝，不能直接访问电脑控制。
5. **ChatGPT 实际验收：已通过。** 用户的 My Windows PC Read Only / Primary 连接实际发现工具，list_directory 返回测试文件，read_file 完整读取 2 行并返回 MCP_MODIFIED，剩余 0 行；证据在 `tests/chatgpt-result.json`。修复新版头部转发与发现流程，保留原 OAuth App 与现有连接。操作步骤详见 [README](../README.md#chatgpt-网页端实际添加)。
6. **功能：** 公网发现 11 个只读工具，只能读取 `tests/public` 文件及查询本项目任务状态/日志/固定配方；实际读到 `MCP_MODIFIED`。本地具备按需启用的写文件、执行、桌面输入和持久任务能力，默认已恢复只读。
7. **稳定性证据：** 本地测试 17/17、只读隔离 7/7、任务恢复 8/8、桌面 4/4、OAuth 最终回归 24/24、真实 GitHub 登录 3/3 通过；本轮 SDK 1/2 公网协议验收 6/6，公网读取/拒绝/重连/撤销 7/7。前轮真实 Tunnel 进程故障后自动恢复，本地分离任务继续并成功完成，本轮未重复停止 Tunnel。登录计划任务已实测。没有执行 Windows 物理重启、物理断网或停止用户现有 Clash。
8. **安全证据：** 仅允许 GitHub 绑定的不可变用户 ID；S256 PKCE、单次 state/授权码、官方 browser_binding 保留。Cookie 为 Secure/HttpOnly/SameSite=Lax/Path=/、无 Domain。Access Token 900 秒，Refresh Token 86400 秒；过期、刷新身份验证与撤销测试通过，SDK 验收授权已撤销。凭据精确扫描无匹配泄露，secrets ACL 仅当前用户/SYSTEM。Client Secret 不进入公开仓库；如凭据曾经暴露，应在 GitHub 设置中撤销并重新生成。
9. **剩余本人操作：** 在 Cloudflare 控制台确认 Workers Free。账户订阅 API 返回 403，未自动确证 Free；部署没有购买、升级、绑卡。ChatGPT 连接和真实调用已经完成，无需删除或重建。未触碰原全局 MCP/代理配置，保留了同期界面选择变化，审计见 [验收记录](acceptance.md)。
10. **长期使用结论：** 当前具备经过 ChatGPT 实际验证的认证只读公网服务。电脑需开机且本地服务运行；桌面需当前用户登录。Supervisor 子进程可自恢复，Supervisor 自身退出需手动或下次登录恢复。机器重启不重放未完成任务。KV 撤销有传播延迟，免费额度耗尽会不可用；Workers VPC 为当前免费 Open Beta，未来定价仍需关注。账户套餐与物理重启测试仍须按实际证据区分。

管理、备份、恢复、关闭公网、卸载及详细限制见 [README](../README.md)，每项测试的证据见 [验收记录](acceptance.md)。
