# ChatGPT 工具发现失败排查与修复

2026-09-26。保留现有 OAuth App、Worker、KV、Named Tunnel 与 ChatGPT Primary 连接；没有重建或撤销 ChatGPT 授权。公网仍固定只读，公开文件目录仍为 `<PROJECT_ROOT>\tests\public`。

## 确认的故障

线上 `/healthz` 为 `mcp_enabled=true`，Tunnel ready，本机监听仍在 127.0.0.1。旧版官方 SDK 1.30.1 与 2025 三个协议版本均能初始化、发现工具和读取文件，因此不能把问题归因于关闭的公网开关。

脱敏线上日志记录到 OpenAI 命名客户端先发送 `server/discover`，协议 `2026-07-28`，之后尝试 `2025-11-25` 的 initialize/initialized/tools/list。客户端类别仅通过已知名称分类，未记录原始 clientInfo、Token、Cookie 或会话值。

对同样的 2026 请求进行了本机/公网对照：

| 修复前请求 | 本机公共源站 | 公网 Worker |
|---|---|---|
| tools/list + 正确 Mcp-Method + 新版 `_meta` | 200，11 个工具 | 400，JSON-RPC `-32020`，Mcp-Method 不匹配 |
| server/discover + 正确 Mcp-Method | 404，`-32601` | 400，`-32020` |

Worker 旧请求头白名单遗漏新版要求的 **Mcp-Method / Mcp-Name**，导致上游必需的头部镜像与请求体一致性校验失败。上述错误是实际对照请求复现的结果；用户最初失败发生时尚未采集线上诊断，不能声称已经拿到最初那次 ChatGPT 的 400 响应。

只补转发头部后，公网新版 tools/list 已变成 200，但公共策略服务旧 SDK 仍不实现 server/discover，返回 404。随后将公共服务接入官方 SDK 2 的 **serveStdio** 协议入口，由官方入口根据首条消息选择旧握手或新版请求包。直接 connect 到裸 stdio Transport 使用旧编码器不足以完成新版发现，已通过回归测试排除此问题。

另外确认两个工具继承了未实现的 `ui://desktop-commander/file-preview` / openai/outputTemplate。公共策略服务没有此 resources/read handler，因此移除公共目录和结果中的上游 UI 元数据，提供准确的短描述与权限提示。没有修改本地目录的上游元数据，也没有修改 inputSchema 的业务参数。stop_search 只停止临时搜索会话，按真实行为保留 readOnlyHint=false；它不能写文件或执行外部命令。

## 请求与响应转发

Worker 验证 MCP Token、本人 ID、mcp:read 与只读属性后，将客户端 Authorization 替换为独立的本地源站 Bearer；客户端 Token 不转发到 Windows。Accept、Content-Type、MCP-Protocol-Version、Mcp-Session-Id、Last-Event-ID，以及新版 Mcp-Method、Mcp-Name 和有严格名称限制的 Mcp-Param-* 转发到固定 VPC 地址。Cookie、浏览器 Origin 和任意客户端头部不转发。上游继续验证新版头部与请求体相符，错误镜像仍返回 400/-32020。

响应转发 Content-Type、Mcp-Session-Id、MCP-Protocol-Version、Allow，并直接返回流，不把 SSE 解析成完整缓冲文本；SSE 加入 X-Accel-Buffering=no。2025 请求返回 text/event-stream，通知返回 202 空响应；2026 请求返回 application/json 且不使用旧会话。真实官方 SDK 已接收并解析这两种格式。

公共策略版本为 **1.0.2**。当前 Worker 版本为 **<DEPLOYMENT_ID>**。只重启本项目公共网关清除旧子进程缓存，OAuth KV 授权保留。Codex、Clash 配置未改动。

## 验收证据

- `tests/discovery-local-result.json`：官方 SDK 1/2、2025 三版本握手、2026 server/discover、工具读取与危险调用拒绝、错误头部拒绝。
- `tests/discovery-public-result.json`：同样的公网验收 **6/6 通过**；11 个工具，真实 read_file 返回 MCP_MODIFIED，目录外读取、write_file 等仍拒绝。
- 工具 name、description、inputSchema、annotations 通过 SDK 校验；JSON Schema 使用 AJV validateSchema 与编译检查，无未实现的 UI 引用。工具详情在 `tests/discovery-tools-public.json`。
- `tests/readonly-result.json`：只读边界回归 7/7。
- `tests/oauth-result.json`：完整 OAuth 回归，包含真实到期等待与新版镜像转发/拒绝测试；以当前报告为准。
- `tests/oauth-result.json` 最终完整回归 **24/24 通过**；`tests/remote-result.json` 最终公网读取、拒绝、重连与 SDK 授权撤销 **7/7 通过**。本轮没有重复停止 Tunnel；此前实际 Tunnel 故障恢复已通过。
- `logs/discovery-worker.jsonl`：仅保留方法枚举、协议日期、状态码、响应类型、耗时、头部/会话是否存在；不包含凭据或参数内容。Worker 的普通持久日志仍关闭，诊断通过临时 Wrangler tail 采集。

## 保留连接并刷新

按 [OpenAI 官方刷新流程](https://developers.openai.com/plugins/deploy/connect-chatgpt)，打开现有 My Windows PC Read Only 连接，点击 **Refresh**。保留 Primary 账户，无需重建 OAuth App 或删除连接。确认 read_file、list_directory 出现在工具目录后，新建启用该连接的聊天，发送：

```text
请实际调用 My Windows PC Read Only 的 read_file，
读取 <PROJECT_ROOT>\tests\public\mcp-sample.txt，
报告实际工具结果中的 MCP_MODIFIED 标记。
```

**最终验收已通过。** 用户在现有 My Windows PC Read Only / Primary 连接中确认工具列表显示，实际 list_directory 返回 `[FILE] mcp-sample.txt`，read_file 完整返回 2 行：`MCP_MODIFIED` 和 `This is the public read-only acceptance fixture.`，剩余 0 行。证据记录在 `tests/chatgpt-result.json`，明确区分用户工具内容证据与服务器仅记录的传输阶段。

线上记录还显示一次缺失旧会话/协议头的 tools/call 被 400 拒绝，随后客户端重新 initialize、initialized 并带会话重试，调用返回 200。没有通过无会话自动放行来修复。用户确认未尝试写入或命令操作；危险调用及目录外读取拒绝由独立 SDK 验收，不能声称 ChatGPT 也执行了这些负面测试。

完成后独立 SDK 测试授权已撤销，ChatGPT 授权保留。临时诊断 tail 已停止，脱敏记录留在本地；普通 Workers 持久日志仍关闭。
