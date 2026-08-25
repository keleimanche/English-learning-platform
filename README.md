# 英语学习平台

> 错词本 · AI 写作批改 · 智能出题 —— 让每一次错误都成为进步的阶梯

## 功能特性

- **错词本**：记录记错的单词，自动查询词义和音标，支持朗读
- **听写测试**：从错词本随机抽取单词，浏览器语音朗读，拼写作答
- **智能出题**：AI 根据你的错词生成阅读理解、完型填空等针对性练习
- **AI 写作批改**：提交英语作文，AI 给出评分、逐句修改、改进建议
- **写作历史**：记录每一次写作和批改，绘制进步曲线
- **学习统计**：连续学习天数、错词数、平均分等数据看板

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + TailwindCSS（CDN，单文件应用） |
| 后端 | Node.js + Express |
| 数据库 | Supabase（PostgreSQL 云数据库）通过 REST API 访问 |
| AI | DeepSeek API（兼容 OpenAI 接口） |
| 语音 | 浏览器原生 Web Speech API |

## 快速开始

### 1. 环境要求

- Node.js v18+
- Supabase 账号（免费版即可）

### 2. 配置后端

```bash
cd backend
npm install
```

编辑 `.env` 文件，填入 Supabase 和 AI 配置：

```env
# Supabase REST API
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key

# AI 配置
AI_API_KEY=your-deepseek-api-key
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat

# 认证
JWT_SECRET=your-secret-key
```

> **获取 Supabase Key**：Supabase Dashboard → Settings → API → `project_url` 和 `service_role key`
>
> **获取 DeepSeek Key**：https://platform.deepseek.com/ 申请 API Key

### 3. 初始化数据库

在 Supabase Dashboard 的 SQL Editor 中执行 `backend/prisma/init.sql` 创建所有表。

### 4. 启动服务

```bash
# 启动后端（在 backend 目录）
npm run dev

# 启动前端：直接用浏览器打开 frontend/index.html
# 或用任意静态服务器：
npx serve frontend
```

访问 http://localhost:3000/api/health 检查后端是否正常。

## Docker 一键部署

```bash
# 设置环境变量
export AI_API_KEY=your-key
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_KEY=your-service-role-key

# 启动
docker-compose up -d

# 前端: http://localhost:8080
# 后端: http://localhost:3000
```

## API 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/wrong-words` | 获取错词列表 |
| POST | `/api/wrong-words` | 添加错词（自动查词义） |
| PUT | `/api/wrong-words/:id` | 更新错词词义/音标 |
| DELETE | `/api/wrong-words/:id` | 删除错词 |
| POST | `/api/wrong-words/batch` | 批量添加错词 |
| POST | `/api/exercises/dictation` | 生成听写测试 |
| POST | `/api/exercises/generate` | AI 生成阅读/完型 |
| GET | `/api/exercises` | 获取练习历史 |
| POST | `/api/writings/grade` | 提交写作并 AI 批改 |
| GET | `/api/writings` | 获取写作历史 |
| GET | `/api/writings/:id` | 获取单篇写作 |
| DELETE | `/api/writings/:id` | 删除写作 |
| GET | `/api/stats` | 获取学习统计 |
| GET | `/api/health` | 健康检查 |

## 项目结构

```
english-learning-platform/
├── backend/
│   ├── src/server.js          # Express 服务器 + Supabase REST API 封装 + 所有路由
│   ├── prisma/
│   │   ├── schema.prisma      # 数据库模型定义（参考用）
│   │   └── init.sql           # 建表 SQL（在 Supabase SQL Editor 执行）
│   ├── .env                   # 环境变量
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   └── index.html             # 单文件前端应用
└── docker-compose.yml
```

## 数据库模型

- **User**：用户（email, password, name）
- **WrongWord**：错词（word, meaning, phonetic, frequency, lastErrorAt）
- **Writing**：写作记录（title, content, aiFeedback, score, wordCount）
- **Exercise**：练习记录（type, content, targetWords, difficulty）
- **LearningStats**：学习统计（totalWords, totalWritings, avgScore, streak）

## 常见问题

**Q: 数据库连接失败？**
检查 Supabase 项目是否正常运行（免费版 7 天不活动会自动暂停，需在 Dashboard 手动恢复）。确认 `.env` 中 `SUPABASE_URL` 和 `SUPABASE_KEY` 正确。

**Q: AI 批改/出题返回 500 错误？**
确认 `.env` 中 `AI_API_KEY` 已配置且余额充足。DeepSeek API 余额不足时会返回 402 错误。

**Q: 听写没有声音？**
使用 Chrome/Edge 浏览器，确保未静音。Web Speech API 需要浏览器支持。

**Q: 前端连不上后端？**
确认后端运行在 3000 端口，前端 `index.html` 中 `API_BASE` 地址正确。
