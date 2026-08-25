-- 英语学习平台 - 数据库初始化 SQL
-- 在 Supabase Dashboard -> SQL Editor 中执行此文件

-- 1. 创建迁移记录表（Prisma 需要）
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);

-- 2. 创建用户表
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- 3. 创建错词表
CREATE TABLE "WrongWord" (
    "id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "phonetic" TEXT,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "lastErrorAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    CONSTRAINT "WrongWord_pkey" PRIMARY KEY ("id")
);

-- 4. 创建写作表
CREATE TABLE "Writing" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "aiFeedback" JSONB,
    "score" DOUBLE PRECISION,
    "wordCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Writing_pkey" PRIMARY KEY ("id")
);

-- 5. 创建练习表
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "targetWords" TEXT[],
    "difficulty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- 6. 创建学习统计表
CREATE TABLE "LearningStats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalWords" INTEGER NOT NULL DEFAULT 0,
    "totalWritings" INTEGER NOT NULL DEFAULT 0,
    "avgScore" DOUBLE PRECISION DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "lastStudyDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LearningStats_pkey" PRIMARY KEY ("id")
);

-- 7. 创建索引
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "WrongWord_userId_frequency_idx" ON "WrongWord"("userId", "frequency");
CREATE UNIQUE INDEX "WrongWord_userId_word_key" ON "WrongWord"("userId", "word");
CREATE INDEX "Writing_userId_createdAt_idx" ON "Writing"("userId", "createdAt");
CREATE UNIQUE INDEX "LearningStats_userId_key" ON "LearningStats"("userId");

-- 8. 创建外键关系
ALTER TABLE "WrongWord" ADD CONSTRAINT "WrongWord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Writing" ADD CONSTRAINT "Writing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningStats" ADD CONSTRAINT "LearningStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9. 记录迁移状态（让 Prisma 知道迁移已完成）
INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
VALUES ('1000000000000_init', 'manual_init', CURRENT_TIMESTAMP, 'init', CURRENT_TIMESTAMP, 1);

-- 完成！
SELECT '数据库初始化成功！' as result;