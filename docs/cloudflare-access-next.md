# 旧 Access 路线已停用

本项目不再使用 Cloudflare Access、Zero Trust Team domain 或 AUD tag，也不需要注册涉及银行卡的 Zero Trust 套餐。

当前方案为 GitHub OAuth App + Cloudflare 官方 workers-oauth-provider + Workers KV + Workers VPC + 已有 Named Tunnel。本人身份绑定 GitHub 数字用户 ID，公网只读。

请使用 [GitHub OAuth 注册说明](github-oauth-registration.md) 和 [项目 README](../README.md)。旧部署备份仅用于追溯，不属于当前有效配置。
