-- 用户反馈和系统公告建表 SQL
-- 在 Supabase Dashboard -> SQL Editor 中执行此文件

-- 1. 用户反馈表
CREATE TABLE IF NOT EXISTS "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "userEmail" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT DEFAULT 'other',
    "status" TEXT DEFAULT 'pending',
    "adminReply" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repliedAt" TIMESTAMP(3),
    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- 2. 系统公告表
CREATE TABLE IF NOT EXISTS "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT DEFAULT 'info',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- 3. 索引
CREATE INDEX IF NOT EXISTS "Feedback_userId_idx" ON "Feedback"("userId");
CREATE INDEX IF NOT EXISTS "Feedback_status_idx" ON "Feedback"("status");
CREATE INDEX IF NOT EXISTS "Announcement_active_idx" ON "Announcement"("isActive");

-- 完成
SELECT '反馈和公告表创建成功！' as result;