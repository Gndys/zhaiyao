# Coolify v4 部署指南（Git 拉代码）

本项目为 Next.js（`output: "standalone"`），仓库已提供 `Dockerfile`，可直接在 Coolify v4 通过 Git 构建并部署。

## 1) 前置条件

- VPS 已安装并运行 Coolify v4（Docker 正常）
- 域名已解析到 VPS
- 防火墙/安全组已放行 `80/443`

## 2) 在 Coolify 创建应用（Dockerfile）

1. Coolify → **New** → **Application**
2. Source 选择 **Git Repository**，授权并选择你的仓库与分支
3. Build 方式选择 **Dockerfile**
4. Dockerfile Path 填 `Dockerfile`
5. Exposed Port（或 Container Port）填 `3000`
6. 保存后先不要急着部署，先把环境变量配好（下一节）

> 如果你在日志里看到 `next start does not work with output: standalone`，说明实际启动命令在跑 `next start`（通常是选了 Nixpacks/Node 预设或覆盖了 Start Command），请确保使用 Dockerfile 部署，或按下方「非 Dockerfile」方案改启动命令。

## 3) 环境变量（从 Vercel 迁移到 Coolify）

你在 `VERCEL_DEPLOY_GUIDE.md` 里配置过的环境变量，基本都需要在 Coolify 里同样配置一份。

### 3.1 必须修改为你自己的域名

- `NEXT_PUBLIC_WEB_URL=https://你的域名`
- `AUTH_URL=https://你的域名/api/auth`

如果你启用了 OAuth（Google/GitHub），确保这些 URL 对应的回调地址也已经在第三方平台控制台更新（见第 5 节）。

### 3.2 构建期变量（非常重要）

Next.js 的 `NEXT_PUBLIC_*` 变量会在 `pnpm build`（构建阶段）被内联到前端产物里；如果只在运行时注入，页面里可能还是旧值。

在 Coolify v4 里，建议把以下变量配置为「**Build 时也可用**」的变量（不同版本 UI 文案可能是 Build Variables / Build Args / Build Environment Variables）：

- `NEXT_PUBLIC_WEB_URL`
- `NEXT_PUBLIC_PROJECT_NAME`
- 任何 `NEXT_PUBLIC_*` 的开关/ID（例如 `NEXT_PUBLIC_AUTH_GOOGLE_ID`、`NEXT_PUBLIC_AUTH_GOOGLE_ENABLED` 等）

为避免踩坑，你也可以把这些变量**同时**配置到 Build Variables 与 Runtime Environment Variables（两边都填一遍）。

### 3.3 运行时变量（服务端使用）

至少需要（按你的实际使用情况增减）：

- `DATABASE_URL`
- `AUTH_SECRET`
- `AUTH_TRUST_HOST=true`（反向代理/自托管常用）
- 阿里云/OSS 相关变量（如果你用到）
- AI 服务相关变量（如果你用到）
- PushPlus（可选）

注意：不要把 `.env.local` 提交到仓库；生产环境以 Coolify 的环境变量为准。

## 4) 部署与校验

1. 在 Coolify 点击 **Deploy**
2. 部署成功后访问域名，确认：
   - 首页正常渲染
   - 登录/回调 URL 正确（如启用 NextAuth/OAuth）
   - 相关 API（如生成摘要）能正常调用外部服务（数据库、阿里云、AI 网关等）

## 4.2) 健康检查（推荐配置）

Coolify/Traefik 出现 **Running (unknown)** 或访问提示 **no available server** 时，优先把端口与健康检查配清楚：

- 端口：确保应用的 **Container Port** 为 `3000`
- Health Check Path：建议用本项目提供的 `GET /api/health`（永远返回 `200`）

## 4.1) 非 Dockerfile 部署（不推荐，但可用）

如果你不想用 Dockerfile（例如使用 Coolify 的 Node/Nixpacks 预设），在 `next.config.mjs` 启用了 `output: "standalone"` 的情况下：

- Build Command：`pnpm build`
- Start Command：`pnpm start`（本仓库已将 `start` 脚本改为 `node .next/standalone/server.js`）

## 5) OAuth 回调地址（如果启用了 Google/GitHub 登录）

在 Google/GitHub 控制台把回调地址从 Vercel 域名替换为你的新域名，常见为：

- Google：`https://你的域名/api/auth/callback/google`
- GitHub：`https://你的域名/api/auth/callback/github`

并确认 `AUTH_URL=https://你的域名/api/auth` 与实际域名一致。

## 6) 数据库迁移（Drizzle，可选）

如果你需要在部署时执行迁移：

- 方式 A：在 Coolify 提供的 Web Terminal 进入容器后执行 `pnpm db:migrate`
- 方式 B：在 Coolify 配置 Post-deploy Command（如果你的部署流程支持）执行 `pnpm db:migrate`

（本项目脚本见 `package.json`：`db:migrate` / `db:push` / `db:studio`）

## 7) 常见问题排查

- 页面里 `NEXT_PUBLIC_WEB_URL` 仍是旧域名：确认该变量在 Coolify 的构建期也注入了（见 3.2），然后重新 Deploy（触发重新构建）。
- 登录报 Host/Callback 相关错误：确认 `AUTH_URL`、`NEXT_PUBLIC_WEB_URL` 是新域名，并设置 `AUTH_TRUST_HOST=true`。
- 502/无法访问：确认应用端口是 `3000`，并且 Coolify 的域名路由已指向该端口。
