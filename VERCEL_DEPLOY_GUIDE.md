# Vercel 部署环境变量配置指南

## 🚀 部署步骤

### 1. 连接 GitHub 仓库到 Vercel
1. 访问 [Vercel](https://vercel.com)
2. 点击 "New Project"
3. 选择你的 GitHub 仓库 `Gndys/zhaiyao`
4. 点击 "Import"

### 2. 配置环境变量

在 Vercel 项目设置中，添加以下环境变量：

#### 基础配置
```
NEXT_PUBLIC_WEB_URL=https://your-domain.vercel.app
NEXT_PUBLIC_PROJECT_NAME=ShipAny
```

#### 数据库配置
```
DATABASE_URL=你的 Supabase 数据库连接字符串
```

#### 认证配置
```
AUTH_SECRET=使用 openssl rand -base64 32 生成的密钥
AUTH_URL=https://your-domain.vercel.app/api/auth
AUTH_TRUST_HOST=true
```

#### Google 认证（可选）
```
AUTH_GOOGLE_ID=你的 Google OAuth ID
AUTH_GOOGLE_SECRET=你的 Google OAuth 密钥
NEXT_PUBLIC_AUTH_GOOGLE_ID=你的 Google OAuth ID
NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true
NEXT_PUBLIC_AUTH_GOOGLE_ONE_TAP_ENABLED=false
```

#### GitHub 认证（可选）
```
AUTH_GITHUB_ID=你的 GitHub OAuth ID
AUTH_GITHUB_SECRET=你的 GitHub OAuth 密钥
NEXT_PUBLIC_AUTH_GITHUB_ENABLED=true
```

#### 支付配置
Stripe 或 Creem 配置（根据需要选择）

#### 阿里云配置（必需）
```
ALIYUN_ISI_ACCESS_KEY_ID=你的阿里云 AccessKey ID
ALIYUN_ISI_ACCESS_KEY_SECRET=你的阿里云 AccessKey Secret
ALIYUN_ISI_APP_KEY=你的阿里云 App Key

OSS_ACCESS_KEY_ID=你的 OSS AccessKey ID
OSS_ACCESS_KEY_SECRET=你的 OSS AccessKey Secret
```

#### AI 服务配置
```
APIMART_API_KEY=你的 APIMart API 密钥
APIMART_MODEL=gemini-3-pro-preview
DEEPSEEK_API_KEY=你的 DeepSeek API 密钥
DEEPSEEK_MODEL=deepseek-chat
NEXT_PUBLIC_DEFAULT_CHAT_PROVIDER=deepseek # 可选：deepseek / apimart
```
DeepSeek 官方文档：https://api-docs.deepseek.com/zh-cn/

### 3. 部署
配置完环境变量后，点击 "Deploy" 开始部署。

## 🔧 本地开发
本地开发时，复制 `.env.example` 为 `.env.local` 并填入你的实际配置：

```bash
cp .env.example .env.local
```

然后在 `.env.local` 中填入你的实际密钥和配置。

## ⚠️ 重要提醒

1. **不要将 `.env` 文件提交到 GitHub**
2. **所有敏感信息都应该通过 Vercel 环境变量设置**
3. **本地开发使用 `.env.local` 文件**
4. **确保所有 API 密钥都有适当的权限设置**

## 📋 必需的环境变量

部署前请确保至少配置以下必需的环境变量：

- `DATABASE_URL`
- `AUTH_SECRET`
- `ALIYUN_ISI_ACCESS_KEY_ID`
- `ALIYUN_ISI_ACCESS_KEY_SECRET`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`

## 🔍 故障排除

如果部署失败，请检查：
1. 所有必需的环境变量是否已配置
2. 数据库连接是否正常
3. API 密钥是否有正确的权限
4. 查看 Vercel 部署日志获取详细错误信息
