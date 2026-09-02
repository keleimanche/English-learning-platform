-- ============================================
-- 做题记录表 - 记录用户每次做题的选择和成绩
-- 在 Supabase SQL Editor 执行此脚本
-- ============================================

CREATE TABLE IF NOT EXISTS "ExerciseRecord" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "exerciseId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "exerciseContent" JSONB,
  "userAnswers" JSONB NOT NULL,
  "correctAnswers" JSONB,
  "score" INTEGER NOT NULL DEFAULT 0,
  "totalQuestions" INTEGER NOT NULL DEFAULT 0,
  "timeSpent" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 启用行级安全
ALTER TABLE "ExerciseRecord" ENABLE ROW LEVEL SECURITY;

-- 允许查询（后端用 service_role key 绕过 RLS）
CREATE POLICY "select_exercise_records" ON "ExerciseRecord"
  FOR SELECT USING (true);

-- 允许插入
CREATE POLICY "insert_exercise_records" ON "ExerciseRecord"
  FOR INSERT WITH CHECK (true);

-- 允许更新
CREATE POLICY "update_exercise_records" ON "ExerciseRecord"
  FOR UPDATE USING (true);

-- 允许删除
CREATE POLICY "delete_exercise_records" ON "ExerciseRecord"
  FOR DELETE USING (true);

-- 验证
SELECT count(*) as record_count FROM "ExerciseRecord";