# Tunnel 掉线诊断与自动恢复

## 症状

当 ChatGPT 中所有 MCP 工具同时返回 `The tool failed internally`，先检查本机服务和 Tunnel，而不要先重新做 OAuth。OAuth 元数据可以正常返回，但 Worker 到本机 MCP 的 VPC 请求仍然需要活动 Tunnel 连接。

```powershell
Set-Location <PROJECT_ROOT>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\status.ps1
```

重点看 `TunnelReady`。它来自 `127.0.0.1:8781/ready`，表示 `cloudflared` 当前至少有活动连接。查看脱敏后的连接日志：

```powershell
Get-Content .\logs\tunnel.log -Tail 80
```

不要把完整 Tunnel Token、OAuth Cookie、授权码或 Token 内容复制到日志、Issue 或聊天中。

## 已实现的恢复机制

Supervisor 每 15 秒读取一次 Tunnel `/ready`。如果 `cloudflared` 进程仍在但 `/ready` 连续 45 秒不是 200，Supervisor 只终止并重启 Tunnel 子进程。MCP 网关、OAuth 网关、桌面服务和当前 Windows 用户会话不会因为这个恢复动作被重启。

恢复动作会写入 `logs\supervisor.log`，只包含子进程名称和时间，不包含凭据。重启后等待活动连接恢复，再在 ChatGPT 中新建聊天或刷新连接。

## 网络要求

Workers VPC 的 Tunnel 使用 `auto` 或 `quic` 传输，当前配置使用 QUIC。必须允许本机向 Cloudflare Tunnel 端点发起出站 UDP 7844，并允许返回流量。DNS 成功并不代表 QUIC 会话能持续；日志中的 `no recent network activity`、`control stream error: context deadline exceeded` 表示传输层连接未保持。

```powershell
& .\runtime\cloudflared\cloudflared.exe tunnel diag --metrics 127.0.0.1:8781 --no-diag-logs
```

如果诊断显示 UDP 7844 不稳定，应在当前路由器、企业防火墙或网络出口放行 UDP 7844，并检查是否有 VPN、代理或 UDP 会话超时策略。不要把固定 HTTP/2 作为 Workers VPC 的永久配置；即使普通 Tunnel 的 HTTP/2 连接稳定，也可能不满足 Workers VPC 的 QUIC 要求。

## 恢复后的验收

等待 `TunnelReady=true` 后，再运行无凭据公网探针：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-remote.ps1 -ProbeOnly
```

探针只验证 OAuth challenge、授权服务器元数据和 PKCE 声明，不会伪造本人 Token。随后在 ChatGPT 现有连接详情点击 Refresh，并在新聊天中先调用 `list_directory`；不要重放旧 OAuth 回调页。
