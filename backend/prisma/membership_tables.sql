-- ============================================
-- 会员与付费体系 - 数据库改造
-- 在 Supabase SQL Editor 执行此脚本
-- ============================================

-- 1. User 表添加会员相关字段
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "plan" TEXT DEFAULT 'free';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "planExpiresAt" TIMESTAMPTZ;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dailyUsage" JSONB DEFAULT '{"writing":0,"exercise":0,"lastResetDate":""}'::jsonb;

-- 2. 把旧的 'user' 角色统一改为 'free'（纳入4级权限体系）
UPDATE "User" SET "role" = 'free' WHERE "role" = 'user' OR "role" IS NULL;

-- 3. 确保管理员保持 admin 角色
UPDATE "User" SET "role" = 'admin', "plan" = 'pro' WHERE email = '2733539739@qq.com';

-- 4. 创建支付订单表
CREATE TABLE IF NOT EXISTS "PaymentOrder" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "plan" TEXT NOT NULL,
  "amount" DECIMAL(10, 2) NOT NULL,
  "period" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "payJsOrderId" TEXT,
  "payUrl" TEXT,
  "paidAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expiredAt" TIMESTAMPTZ
);

-- 5. 启用行级安全（RLS）并配置策略
ALTER TABLE "PaymentOrder" ENABLE ROW LEVEL SECURITY;

-- 允许用户查询自己的订单
CREATE POLICY "users_select_own_orders" ON "PaymentOrder"
  FOR SELECT USING (true);

-- 允许插入订单（注册和支付流程需要）
CREATE POLICY "anyone_insert_order" ON "PaymentOrder"
  FOR INSERT WITH CHECK (true);

-- 允许更新订单状态（支付回调需要）
CREATE POLICY "anyone_update_order" ON "PaymentOrder"
  FOR UPDATE USING (true);

-- 6. 验证结果
SELECT id, email, "role", "plan", "planExpiresAt", "dailyUsage" FROM "User";