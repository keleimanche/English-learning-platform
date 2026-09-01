/**
 * 英语学习平台 - 后端服务器
 * 使用 Supabase REST API (PostgREST) 操作数据库
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const REST_BASE = `${SUPABASE_URL}/rest/v1`;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const PORT = process.env.PORT || 3000;

function genId() {
  return crypto.randomBytes(16).toString('hex');
}

// ============================================
// Supabase REST API 封装
// ============================================
function sbHeaders(extra = {}) {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function sbGet(table, queryParams = '', extraHeaders = {}) {
  const url = `${REST_BASE}/${table}?${queryParams}`;
  const res = await fetch(url, { headers: sbHeaders(extraHeaders) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase GET ${table} ${res.status}: ${text}`);
  }
  return res.json();
}

async function sbPost(table, body, prefer = 'return=representation') {
  const res = await fetch(`${REST_BASE}/${table}`, {
    method: 'POST',
    headers: sbHeaders({ Prefer: prefer }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase POST ${table} ${res.status}: ${text}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

async function sbPatch(table, queryParams, body) {
  const url = `${REST_BASE}/${table}?${queryParams}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: sbHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase PATCH ${table} ${res.status}: ${text}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

async function sbDelete(table, queryParams) {
  const url = `${REST_BASE}/${table}?${queryParams}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: sbHeaders({ Prefer: 'return=representation' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase DELETE ${table} ${res.status}: ${text}`);
  }
  return res.json();
}

async function sbCount(table, queryParams = '') {
  const url = `${REST_BASE}/${table}?select=count${queryParams ? '&' + queryParams : ''}`;
  const res = await fetch(url, {
    headers: sbHeaders({ Prefer: 'count=exact' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase COUNT ${table} ${res.status}: ${text}`);
  }
  const range = res.headers.get('content-range');
  if (range) {
    const total = range.split('/')[1];
    return parseInt(total) || 0;
  }
  const data = await res.json();
  return data.length;
}

// ============================================
// 中间件：JWT 认证
// ============================================
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录或token缺失' });
  }
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'token无效或已过期' });
  }
}

// ============================================
// 中间件：管理员权限检查
// ============================================
async function requireAdmin(req, res, next) {
  try {
    const users = await sbGet('User', `select=id,email,name,role&id=eq.${req.userId}`);
    if (users.length === 0) return res.status(404).json({ error: '用户不存在' });
    if (users[0].role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
    req.adminUser = users[0];
    next();
  } catch (err) {
    res.status(500).json({ error: '权限检查失败: ' + err.message });
  }
}

// ============================================
// 中间件：Pro功能权限检查（tester/pro/admin 可用，free 受限）
// ============================================
async function requireProAccess(req, res, next) {
  try {
    const users = await sbGet('User', `select=id,role&id=eq.${req.userId}`);
    if (users.length === 0) return res.status(404).json({ error: '用户不存在' });
    const role = users[0].role || 'free';
    if (['tester', 'pro', 'admin'].includes(role)) return next();
    return res.status(403).json({ error: '该功能需要升级权限，请联系管理员', upgradeRequired: true, currentRole: role });
  } catch (err) {
    res.status(500).json({ error: '权限检查失败: ' + err.message });
  }
}

// ============================================
// 会员体系：套餐配置与额度管理
// ============================================
const PLAN_CONFIG = {
  free: {
    name: '免费版',
    writingDailyLimit: 3,
    exerciseDailyLimit: 1,
    wrongWordsLimit: 50,
    features: ['dictation', 'writingHistory', 'basicStats'],
  },
  pro: {
    name: '专业版',
    writingDailyLimit: Infinity,
    exerciseDailyLimit: Infinity,
    wrongWordsLimit: Infinity,
    features: ['all'],
  },
  tester: {
    name: '测试员',
    writingDailyLimit: Infinity,
    exerciseDailyLimit: Infinity,
    wrongWordsLimit: Infinity,
    features: ['all'],
  },
  admin: {
    name: '管理员',
    writingDailyLimit: Infinity,
    exerciseDailyLimit: Infinity,
    wrongWordsLimit: Infinity,
    features: ['all'],
  },
};

const PLAN_PRICES = {
  pro_monthly: { plan: 'pro', period: 'monthly', amount: 29.9, name: '专业版月付' },
  pro_yearly: { plan: 'pro', period: 'yearly', amount: 199, name: '专业版年付' },
  family_yearly: { plan: 'pro', period: 'family_yearly', amount: 399, name: '家庭版年付(5人)' },
};

// 获取用户有效套餐（考虑过期）
async function getUserPlan(userId) {
  const users = await sbGet('User', `select=id,role,plan,"planExpiresAt","dailyUsage"&id=eq.${userId}`);
  if (users.length === 0) return null;
  const user = users[0];
  let plan = user.plan || 'free';
  const role = user.role || 'free';
  if (['tester', 'admin'].includes(role)) plan = role;
  if (plan === 'pro' && user.planExpiresAt) {
    const expiresAt = new Date(user.planExpiresAt);
    if (expiresAt < new Date()) {
      plan = 'free';
      await sbPatch('User', `id=eq.${userId}`, { plan: 'free' });
    }
  }
  let dailyUsage = { writing: 0, exercise: 0, lastResetDate: '' };
  if (user.dailyUsage) {
    dailyUsage = typeof user.dailyUsage === 'string' ? JSON.parse(user.dailyUsage) : user.dailyUsage;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (dailyUsage.lastResetDate !== today) {
    dailyUsage = { writing: 0, exercise: 0, lastResetDate: today };
    await sbPatch('User', `id=eq.${userId}`, { dailyUsage });
  }
  return { plan, role, dailyUsage, raw: user };
}

// 中间件：检查AI功能额度（feature: 'writing' | 'exercise'）
function checkQuota(feature) {
  return async (req, res, next) => {
    try {
      const userPlan = await getUserPlan(req.userId);
      if (!userPlan) return res.status(404).json({ error: '用户不存在' });
      req.userPlan = userPlan;
      const config = PLAN_CONFIG[userPlan.plan] || PLAN_CONFIG.free;
      const limit = feature === 'writing' ? config.writingDailyLimit : config.exerciseDailyLimit;
      const used = feature === 'writing' ? userPlan.dailyUsage.writing : userPlan.dailyUsage.exercise;
      if (used >= limit) {
        return res.status(403).json({
          error: userPlan.plan === 'free' ? `免费额度已用完（今日${feature === 'writing' ? 'AI写作批改' : '智能出题'} ${limit} 次），升级专业版可无限使用` : '额度已用完',
          upgradeRequired: true,
          currentPlan: userPlan.plan,
          feature,
          used,
          limit,
        });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: '额度检查失败: ' + err.message });
    }
  };
}

// 扣减额度（AI调用成功后执行）
async function consumeQuota(userId, feature) {
  try {
    const userPlan = await getUserPlan(userId);
    if (!userPlan) return;
    const config = PLAN_CONFIG[userPlan.plan] || PLAN_CONFIG.free;
    const limit = feature === 'writing' ? config.writingDailyLimit : config.exerciseDailyLimit;
    if (limit === Infinity) return;
    const today = new Date().toISOString().slice(0, 10);
    let dailyUsage = userPlan.dailyUsage;
    if (dailyUsage.lastResetDate !== today) {
      dailyUsage = { writing: 0, exercise: 0, lastResetDate: today };
    }
    if (feature === 'writing') dailyUsage.writing = (dailyUsage.writing || 0) + 1;
    else dailyUsage.exercise = (dailyUsage.exercise || 0) + 1;
    await sbPatch('User', `id=eq.${userId}`, { dailyUsage });
  } catch (err) {
    console.error('扣减额度失败:', err.message);
  }
}

// ============================================
// AI 调用（兼容 OpenAI 接口）
// ============================================
async function callAI(messages, temperature = 0.7) {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL || 'https://api.deepseek.com/v1';
  const model = process.env.AI_MODEL || 'deepseek-chat';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: 2000 }),
  });

  if (!response.ok) {
    throw new Error(`AI 接口错误 ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

// ============================================
// 词典查询（有道词典API）
// ============================================
async function fetchWordMeaning(word) {
  try {
    const response = await fetch(
      `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`
    );

    if (!response.ok) {
      return { meaning: '（API请求失败）', phonetic: '' };
    }

    const data = await response.json();

    let meaning = '（未找到释义）';
    let phonetic = '';

    // 有道API结构：data.ec.word['0'].trs[].tr[].l.i
    const wordEntry = data.ec?.word?.['0'] || data.ec?.word?.[0];
    if (wordEntry?.trs) {
      const translations = wordEntry.trs
        .flatMap(t => t.tr || [])
        .flatMap(tr => {
          const i = tr?.l?.i;
          if (Array.isArray(i)) return i;
          if (typeof i === 'string') return [i];
          return [];
        })
        .filter(Boolean);
      if (translations.length > 0) {
        meaning = translations.join('；');
      }
    }

    // 音标
    phonetic = wordEntry?.usphone || data.simple?.word?.[0]?.usphone || '';

    return { meaning, phonetic };
  } catch (error) {
    console.error('词典查询失败:', error.message);
    return { meaning: '（查询失败，可手动编辑）', phonetic: '' };
  }
}


// ============================================
// 更新学习统计
// ============================================
async function updateStats(userId) {
  const wordCount = await sbCount('WrongWord', `"userId"=eq.${userId}`);
  const writingCount = await sbCount('Writing', `"userId"=eq.${userId}`);

  const writings = await sbGet('Writing', `select=score&"userId"=eq.${userId}&score=not.is.null`);
  const avgScore = writings.length > 0
    ? writings.reduce((sum, w) => sum + (w.score || 0), 0) / writings.length
    : 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existingArr = await sbGet('LearningStats', `select=streak,"lastStudyDate"&"userId"=eq.${userId}`);
  const existing = existingArr[0];
  let streak = 1;
  if (existing?.lastStudyDate) {
    const last = new Date(existing.lastStudyDate);
    last.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today - last) / 86400000);
    if (diffDays === 1) streak = (existing.streak || 0) + 1;
    else if (diffDays === 0) streak = existing.streak || 1;
  }

  const statsArr = await sbGet('LearningStats', `select=id&"userId"=eq.${userId}`);
  const now = new Date().toISOString();
  if (statsArr.length > 0) {
    await sbPatch('LearningStats', `"userId"=eq.${userId}`, {
      totalWords: wordCount,
      totalWritings: writingCount,
      avgScore: parseFloat(avgScore.toFixed(2)),
      streak,
      lastStudyDate: now,
      updatedAt: now,
    });
  } else {
    await sbPost('LearningStats', {
      id: genId(),
      userId,
      totalWords: wordCount,
      totalWritings: writingCount,
      avgScore: parseFloat(avgScore.toFixed(2)),
      streak,
      lastStudyDate: now,
      updatedAt: now,
    });
  }
}

// ============================================
// 1. 认证路由
// ============================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: '邮箱、密码、姓名均为必填' });

    const existing = await sbGet('User', `select=id&email=eq.${encodeURIComponent(email)}`);
    if (existing.length > 0) return res.status(409).json({ error: '该邮箱已注册' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const id = genId();
    const today = new Date().toISOString().slice(0, 10);
    const user = await sbPost('User', {
      id, email, password: hashedPassword, name,
      role: 'free', plan: 'free',
      dailyUsage: { writing: 0, exercise: 0, lastResetDate: today },
      createdAt: now, updatedAt: now,
    });

    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.status(201).json({ token, user: { id, email, name, role: 'free', plan: 'free' } });
  } catch (err) {
    res.status(500).json({ error: '注册失败: ' + err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: '邮箱和密码为必填' });

    const users = await sbGet('User', `select=id,email,password,name,role,plan,"planExpiresAt"&email=eq.${encodeURIComponent(email)}`);
    const user = users[0];
    if (!user) return res.status(401).json({ error: '邮箱或密码错误' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: '邮箱或密码错误' });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({
      token,
      user: {
        id: user.id, email: user.email, name: user.name,
        role: user.role || 'free', plan: user.plan || 'free',
        planExpiresAt: user.planExpiresAt || null,
      }
    });
  } catch (err) {
    res.status(500).json({ error: '登录失败: ' + err.message });
  }
});

// ============================================
// 2. 错词管理
// ============================================
app.get('/api/wrong-words', authenticate, async (req, res) => {
  try {
    const words = await sbGet('WrongWord',
      `select=id,word,meaning,phonetic,frequency,"lastErrorAt","userId"&"userId"=eq.${req.userId}&order="lastErrorAt".desc`
    );
    res.json(words);
  } catch (err) {
    res.status(500).json({ error: '获取错词失败: ' + err.message });
  }
});

app.post('/api/wrong-words', authenticate, async (req, res) => {
  try {
    const { word } = req.body;
    if (!word?.trim()) return res.status(400).json({ error: '单词不能为空' });
    const trimmedWord = word.trim().toLowerCase();

    const existing = await sbGet('WrongWord',
      `select=id,frequency&"userId"=eq.${req.userId}&word=eq.${encodeURIComponent(trimmedWord)}`
    );
    if (existing.length > 0) {
      const updated = await sbPatch('WrongWord', `id=eq.${existing[0].id}`, {
        frequency: existing[0].frequency + 1,
        lastErrorAt: new Date().toISOString(),
      });
      await updateStats(req.userId);
      return res.json(updated);
    }

    const userPlan = await getUserPlan(req.userId);
    if (userPlan) {
      const config = PLAN_CONFIG[userPlan.plan] || PLAN_CONFIG.free;
      if (config.wrongWordsLimit !== Infinity) {
        const countResult = await sbCount('WrongWord', `"userId"=eq.${req.userId}`);
        if (countResult >= config.wrongWordsLimit) {
          return res.status(403).json({
            error: `免费版错词本最多存储 ${config.wrongWordsLimit} 个单词，升级专业版可无限存储`,
            upgradeRequired: true,
            currentPlan: userPlan.plan,
            feature: 'wrongWords',
            used: countResult,
            limit: config.wrongWordsLimit,
          });
        }
      }
    }

    const meaningData = await fetchWordMeaning(trimmedWord);
    const newWord = await sbPost('WrongWord', {
      id: genId(),
      word: trimmedWord,
      meaning: meaningData?.meaning || '（请手动补充词义）',
      phonetic: meaningData?.phonetic || '',
      frequency: 1,
      lastErrorAt: new Date().toISOString(),
      userId: req.userId,
    });
    await updateStats(req.userId);
    res.status(201).json(newWord);
  } catch (err) {
    res.status(500).json({ error: '添加错词失败: ' + err.message });
  }
});

app.put('/api/wrong-words/:id', authenticate, async (req, res) => {
  try {
    const { meaning, phonetic } = req.body;
    const words = await sbGet('WrongWord', `select=id&id=eq.${req.params.id}&"userId"=eq.${req.userId}`);
    if (words.length === 0) return res.status(404).json({ error: '错词不存在' });

    const updateBody = {};
    if (meaning !== undefined) updateBody.meaning = meaning;
    if (phonetic !== undefined) updateBody.phonetic = phonetic;

    const updated = await sbPatch('WrongWord', `id=eq.${req.params.id}`, updateBody);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: '更新失败: ' + err.message });
  }
});

app.delete('/api/wrong-words/:id', authenticate, async (req, res) => {
  try {
    const words = await sbGet('WrongWord', `select=id&id=eq.${req.params.id}&"userId"=eq.${req.userId}`);
    if (words.length === 0) return res.status(404).json({ error: '错词不存在' });
    await sbDelete('WrongWord', `id=eq.${req.params.id}`);
    await updateStats(req.userId);
    res.json({ message: '已删除' });
  } catch (err) {
    res.status(500).json({ error: '删除失败: ' + err.message });
  }
});

app.post('/api/wrong-words/batch', authenticate, async (req, res) => {
  try {
    const { words } = req.body;
    if (!Array.isArray(words)) return res.status(400).json({ error: 'words 必须是数组' });

    const results = [];
    const now = new Date().toISOString();
    for (const w of words) {
      const trimmed = w.trim().toLowerCase();
      if (!trimmed) continue;

      const existing = await sbGet('WrongWord',
        `select=id,frequency&"userId"=eq.${req.userId}&word=eq.${encodeURIComponent(trimmed)}`
      );
      if (existing.length > 0) {
        const updated = await sbPatch('WrongWord', `id=eq.${existing[0].id}`, {
          frequency: existing[0].frequency + 1,
          lastErrorAt: now,
        });
        results.push(updated);
      } else {
        const meaningData = await fetchWordMeaning(trimmed);
        const newWord = await sbPost('WrongWord', {
          id: genId(),
          word: trimmed,
          meaning: meaningData?.meaning || '（请手动补充词义）',
          phonetic: meaningData?.phonetic || '',
          frequency: 1,
          lastErrorAt: now,
          userId: req.userId,
        });
        results.push(newWord);
      }
    }
    await updateStats(req.userId);
    res.status(201).json(results);
  } catch (err) {
    res.status(500).json({ error: '批量添加失败: ' + err.message });
  }
});

// ============================================
// 3. 听写测试
// ============================================
app.post('/api/exercises/dictation', authenticate, async (req, res) => {
  try {
    const { count = 10, onlyHighFrequency = false } = req.body;
    let queryStr = `select=id,word,phonetic,meaning&"userId"=eq.${req.userId}`;
    if (onlyHighFrequency) {
      queryStr += '&frequency=gte.2';
    }
    queryStr += `&order=frequency.desc&limit=${Math.min(count, 50)}`;

    const words = await sbGet('WrongWord', queryStr);
    if (words.length === 0) return res.status(400).json({ error: '还没有错词，先记录一些错词吧！' });

    const shuffled = words.sort(() => Math.random() - 0.5);
    const exercise = await sbPost('Exercise', {
      id: genId(),
      type: 'dictation',
      content: JSON.stringify({ words: shuffled }),
      targetWords: shuffled.map(w => w.word),
      difficulty: 1,
      createdAt: new Date().toISOString(),
      userId: req.userId,
    });
    res.json(exercise);
  } catch (err) {
    res.status(500).json({ error: '生成听写失败: ' + err.message });
  }
});

// ============================================
// 4. 阅读理解 / 完型填空（AI 生成）
// ============================================
app.post('/api/exercises/generate', authenticate, checkQuota('exercise'), async (req, res) => {
  try {
    const { type = 'reading', wordCount = 8, difficulty = 3, examType = 'zhongkao' } = req.body;
    const words = await sbGet('WrongWord',
      `select=word&"userId"=eq.${req.userId}&order=frequency.desc&limit=${wordCount}`
    );
    if (words.length < 3) return res.status(400).json({ error: '至少需要 3 个错词才能生成题目' });

    const wordList = words.map(w => w.word).join(', ');
    const examDesc = examType === 'gaokao'
      ? '高考难度（词汇量3500，文章约250词，题目接近高考英语阅读理解风格，选项需仔细辨析）'
      : '中考难度（词汇量1500，文章约150词，题目接近中考英语阅读理解风格，选项区分度明显）';
    const examStandard = examType === 'gaokao'
      ? '符合高考英语全国卷阅读理解题型特点'
      : '符合中考英语阅读理解题型特点';

    let prompt = '';
    if (type === 'reading') {
      prompt = `你是一位资深英语命题专家，专门研究${examType === 'gaokao' ? '高考' : '中考'}英语命题。请根据以下学生常错的单词，编写一篇${examDesc}的英语阅读理解文章，文章中要自然地使用这些单词：${wordList}。

请返回 JSON 格式（不要包含 markdown 代码块标记）：
{"passage":"文章正文","questions":[{"question":"问题（用英文）","options":["A选项","B选项","C选项","D选项"],"answer":"正确选项字母如A","explanation":"中文解析，详细说明为什么选这个答案，其他选项为什么不对"}]}

要求：
1. 生成 4 道选择题，${examStandard}
2. 问题和选项用英文，解析全部用中文
3. 文章主题积极向上，难度${examType === 'gaokao' ? '接近高考' : '接近中考'}
4. 每道题的解析不少于30字，用中文详细解释`;
    } else if (type === 'cloze') {
      prompt = `你是一位资深英语命题专家，专门研究${examType === 'gaokao' ? '高考' : '中考'}英语命题。请根据以下学生常错的单词，编写一篇${examDesc}的英语完型填空文章，挖空处使用这些单词：${wordList}。

请返回 JSON 格式（不要包含 markdown 代码块标记）：
{"passage":"文章正文挖空处用___表示","blanks":[{"index":1,"answer":"正确单词","options":["干扰项1","干扰项2","干扰项3","正确单词"],"explanation":"中文解析，说明为什么填这个单词"}]}

要求：
1. 挖空数量等于提供的单词数，每个空提供 4 个选项
2. 选项和答案用英文，解析全部用中文
3. ${examStandard}，难度${examType === 'gaokao' ? '接近高考' : '接近中考'}
4. 每个空的解析不少于20字，用中文解释`;
    } else {
      return res.status(400).json({ error: '不支持的题目类型: ' + type });
    }

    const aiResponse = await callAI([
      { role: 'system', content: `你是资深英语命题专家，擅长根据${examType === 'gaokao' ? '高考' : '中考'}考试标准设计针对性练习。所有解析必须用中文。只返回纯JSON，不要包含任何markdown标记。` },
      { role: 'user', content: prompt },
    ], 0.7);

    let content;
    try {
      content = JSON.parse(aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
    } catch {
      return res.status(500).json({ error: 'AI 返回格式错误，请重试' });
    }

    const exercise = await sbPost('Exercise', {
      id: genId(),
      type,
      content: JSON.stringify(content),
      targetWords: words.map(w => w.word),
      difficulty,
      createdAt: new Date().toISOString(),
      userId: req.userId,
    });
    await consumeQuota(req.userId, 'exercise');
    res.json(exercise);
  } catch (err) {
    res.status(500).json({ error: '生成题目失败: ' + err.message });
  }
});

app.get('/api/exercises', authenticate, async (req, res) => {
  try {
    const { type, limit = 20 } = req.query;
    let queryStr = `select=id,type,content,"targetWords",difficulty,"createdAt"&"userId"=eq.${req.userId}`;
    if (type) {
      queryStr += `&type=eq.${type}`;
    }
    queryStr += `&order="createdAt".desc&limit=${parseInt(limit)}`;
    const exercises = await sbGet('Exercise', queryStr);
    res.json(exercises);
  } catch (err) {
    res.status(500).json({ error: '获取练习失败: ' + err.message });
  }
});

app.get('/api/exercises/:id', authenticate, async (req, res) => {
  try {
    const exercises = await sbGet('Exercise',
      `select=id,type,content,"targetWords",difficulty,"createdAt"&id=eq.${req.params.id}&"userId"=eq.${req.userId}`
    );
    if (exercises.length === 0) return res.status(404).json({ error: '练习不存在' });
    res.json(exercises[0]);
  } catch (err) {
    res.status(500).json({ error: '获取练习详情失败: ' + err.message });
  }
});

// ============================================
// 5. 写作批改（AI）
// ============================================
app.post('/api/writings/grade', authenticate, checkQuota('writing'), async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: '写作内容不能为空' });

    const wordCount = content.trim().split(/\s+/).length;
    const prompt = `你是一位专业的英语写作老师。请批改以下英语作文，给出详细的反馈。所有评价、分析、建议都必须用中文。

标题：${title || '（无标题）'}
正文：
${content}

请返回 JSON 格式（不要包含 markdown 代码块标记）：
{"score":85,"dimensionScores":{"内容":85,"结构":80,"词汇":75,"语法":70},"errorStats":{"语法错误":2,"词汇错误":3,"拼写错误":1},"overallComment":"中文总体评价","corrections":[{"type":"语法错误","original":"错误片段","corrected":"正确表达","reason":"中文修改原因"}],"strengths":["中文优点1"],"suggestions":["中文建议1"]}

要求：
1. score为总分0-100
2. dimensionScores从"内容""结构""词汇""语法"四个维度分别打分0-100
3. errorStats统计各类错误数量（语法错误/词汇错误/拼写错误/其他）
4. corrections中每项需标注type（错误类型）
5. 所有字段内容必须用中文`;

    const aiResponse = await callAI([
      { role: 'system', content: '你是专业的英语写作老师，擅长批改英语作文并给出建设性反馈。所有反馈内容必须用中文。只返回纯JSON，不要包含任何markdown标记。' },
      { role: 'user', content: prompt },
    ], 0.3);

    let feedback;
    try {
      feedback = JSON.parse(aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
    } catch {
      feedback = { rawResponse: aiResponse, score: null };
    }

    const writing = await sbPost('Writing', {
      id: genId(),
      title: title || null,
      content,
      aiFeedback: JSON.stringify(feedback),
      score: feedback.score || null,
      wordCount,
      createdAt: new Date().toISOString(),
      userId: req.userId,
    });
    await updateStats(req.userId);
    await consumeQuota(req.userId, 'writing');
    res.json(writing);
  } catch (err) {
    res.status(500).json({ error: '写作批改失败: ' + err.message });
  }
});

// ============================================
// 5.5 AI 生成写作提纲
// ============================================
app.post('/api/writings/outline', authenticate, checkQuota('writing'), async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: '请先选择题目或输入标题' });

    const prompt = `你是一位英语写作辅导老师。请根据以下作文题目，生成一个三段式写作提纲（开头-主体-结尾）。所有内容用中文。

题目：${title}
${content ? `学生已写内容：${content.slice(0, 200)}` : ''}

请返回 JSON 格式（不要包含 markdown 代码块标记）：
{"introduction":"开头段写作思路和要点（中文）","body":"主体段写作思路和要点（中文）","conclusion":"结尾段写作思路和要点（中文）"}

要求：每段50-100字，给出具体的写作方向和要点提示。`;

    const aiResponse = await callAI([
      { role: 'system', content: '你是英语写作辅导老师，擅长指导学生构思作文结构。所有内容用中文。只返回纯JSON。' },
      { role: 'user', content: prompt },
    ], 0.7);

    let outline;
    try {
      outline = JSON.parse(aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
    } catch {
      outline = { introduction: aiResponse, body: '', conclusion: '' };
    }
    res.json(outline);
  } catch (err) {
    res.status(500).json({ error: '生成提纲失败: ' + err.message });
  }
});

app.get('/api/writings', authenticate, async (req, res) => {
  try {
    const writings = await sbGet('Writing',
      `select=id,title,content,"aiFeedback",score,"wordCount","createdAt"&"userId"=eq.${req.userId}&order="createdAt".desc`
    );
    res.json(writings);
  } catch (err) {
    res.status(500).json({ error: '获取写作历史失败: ' + err.message });
  }
});

app.get('/api/writings/:id', authenticate, async (req, res) => {
  try {
    const writings = await sbGet('Writing',
      `select=id,title,content,"aiFeedback",score,"wordCount","createdAt"&id=eq.${req.params.id}&"userId"=eq.${req.userId}`
    );
    if (writings.length === 0) return res.status(404).json({ error: '写作不存在' });
    res.json(writings[0]);
  } catch (err) {
    res.status(500).json({ error: '获取写作失败: ' + err.message });
  }
});

app.delete('/api/writings/:id', authenticate, async (req, res) => {
  try {
    const writings = await sbGet('Writing', `select=id&id=eq.${req.params.id}&"userId"=eq.${req.userId}`);
    if (writings.length === 0) return res.status(404).json({ error: '写作不存在' });
    await sbDelete('Writing', `id=eq.${req.params.id}`);
    await updateStats(req.userId);
    res.json({ message: '已删除' });
  } catch (err) {
    res.status(500).json({ error: '删除失败: ' + err.message });
  }
});

// ============================================
// 6. 学习统计
// ============================================
app.get('/api/stats', authenticate, async (req, res) => {
  try {
    let statsArr = await sbGet('LearningStats',
      `select=id,"userId","totalWords","totalWritings","avgScore",streak,"lastStudyDate","updatedAt"&"userId"=eq.${req.userId}`
    );
    let stats = statsArr[0];
    if (!stats) {
      stats = await sbPost('LearningStats', {
        id: genId(),
        userId: req.userId,
        totalWords: 0,
        totalWritings: 0,
        avgScore: 0,
        streak: 0,
        updatedAt: new Date().toISOString(),
      });
    }

    const recentWritings = await sbGet('Writing',
      `select=score,"createdAt",title&"userId"=eq.${req.userId}&score=not.is.null&order="createdAt".desc&limit=10`
    );
    const highFrequencyWords = await sbGet('WrongWord',
      `select=word,meaning,frequency&"userId"=eq.${req.userId}&order=frequency.desc&limit=5`
    );

    res.json({ ...stats, recentWritings, highFrequencyWords });
  } catch (err) {
    res.status(500).json({ error: '获取统计失败: ' + err.message });
  }
});

// ============================================
// 7. 管理后台 API（需要 admin 权限）
// ============================================
app.get('/api/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const userCount = await sbCount('User');
    const wordCount = await sbCount('WrongWord');
    const writingCount = await sbCount('Writing');
    const exerciseCount = await sbCount('Exercise');

    const today = new Date().toISOString().split('T')[0];
    const activeCount = await sbCount('LearningStats', `"lastStudyDate"=gte.${today}`);

    const topWords = await sbGet('WrongWord',
      `select=word,meaning,frequency&order=frequency.desc&limit=10`
    );

    const recentUsers = await sbGet('User',
      `select=id,email,name,"createdAt"&order="createdAt".desc&limit=5`
    );

    res.json({ userCount, wordCount, writingCount, exerciseCount, activeCount, topWords, recentUsers });
  } catch (err) {
    res.status(500).json({ error: '获取管理统计失败: ' + err.message });
  }
});

app.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const selectFields = 'id,email,name,role,"createdAt",LearningStats(totalWords,totalWritings,avgScore,streak)';
    let queryStr = `select=${encodeURIComponent(selectFields)}&order="createdAt".desc&limit=${parseInt(limit)}&offset=${offset}`;
    if (search) {
      queryStr = `select=${encodeURIComponent(selectFields)}&email=ilike.%${encodeURIComponent(search)}%&order="createdAt".desc&limit=${parseInt(limit)}&offset=${offset}`;
    }
    let users = await sbGet('User', queryStr);
    const totalCount = await sbCount('User', search ? `email=ilike.%${encodeURIComponent(search)}%` : '');
    res.json({ users, total: totalCount, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: '获取用户列表失败: ' + err.message });
  }
});

app.get('/api/admin/users/:userId/detail', authenticate, requireAdmin, async (req, res) => {
  try {
    const uid = req.params.userId;
    const [userInfo, wrongWords, writings, exercises, statsArr] = await Promise.all([
      sbGet('User', `select=id,email,name,role,"createdAt"&id=eq.${uid}`),
      sbGet('WrongWord', `select=id,word,meaning,phonetic,frequency,"lastErrorAt"&"userId"=eq.${uid}&order=frequency.desc`),
      sbGet('Writing', `select=id,title,content,score,"wordCount","createdAt"&"userId"=eq.${uid}&order="createdAt".desc`),
      sbGet('Exercise', `select=id,type,difficulty,"createdAt"&"userId"=eq.${uid}&order="createdAt".desc`),
      sbGet('LearningStats', `select=*&"userId"=eq.${uid}`),
    ]);
    if (userInfo.length === 0) return res.status(404).json({ error: '用户不存在' });
    res.json({
      user: userInfo[0],
      wrongWords,
      writings,
      exercises,
      stats: statsArr[0] || null,
    });
  } catch (err) {
    res.status(500).json({ error: '获取用户详情失败: ' + err.message });
  }
});

app.get('/api/admin/users/:userId/wrong-words', authenticate, requireAdmin, async (req, res) => {
  try {
    const words = await sbGet('WrongWord',
      `select=id,word,meaning,phonetic,frequency,"lastErrorAt"&"userId"=eq.${req.params.userId}&order=frequency.desc`
    );
    res.json(words);
  } catch (err) {
    res.status(500).json({ error: '获取用户错词失败: ' + err.message });
  }
});

app.delete('/api/admin/users/:userId/wrong-words/:wordId', authenticate, requireAdmin, async (req, res) => {
  try {
    await sbDelete('WrongWord', `id=eq.${req.params.wordId}&"userId"=eq.${req.params.userId}`);
    res.json({ message: '已删除' });
  } catch (err) {
    res.status(500).json({ error: '删除错词失败: ' + err.message });
  }
});

app.get('/api/admin/users/:userId/writings', authenticate, requireAdmin, async (req, res) => {
  try {
    const writings = await sbGet('Writing',
      `select=id,title,content,"aiFeedback",score,"wordCount","createdAt"&"userId"=eq.${req.params.userId}&order="createdAt".desc`
    );
    res.json(writings);
  } catch (err) {
    res.status(500).json({ error: '获取用户写作失败: ' + err.message });
  }
});

app.get('/api/admin/users/:userId/exercises', authenticate, requireAdmin, async (req, res) => {
  try {
    const exercises = await sbGet('Exercise',
      `select=id,type,content,"targetWords",difficulty,"createdAt"&"userId"=eq.${req.params.userId}&order="createdAt".desc`
    );
    res.json(exercises);
  } catch (err) {
    res.status(500).json({ error: '获取用户练习失败: ' + err.message });
  }
});

app.get('/api/admin/users/:userId/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const statsArr = await sbGet('LearningStats',
      `select=*&"userId"=eq.${req.params.userId}`
    );
    const userInfo = await sbGet('User',
      `select=id,email,name,role,"createdAt"&id=eq.${req.params.userId}`
    );
    res.json({ stats: statsArr[0] || null, user: userInfo[0] || null });
  } catch (err) {
    res.status(500).json({ error: '获取用户统计失败: ' + err.message });
  }
});

app.get('/api/admin/top-words', authenticate, requireAdmin, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const allWords = await sbGet('WrongWord',
      `select=word,meaning,frequency,"userId"&order=frequency.desc&limit=${parseInt(limit)}`
    );
    const aggregated = {};
    for (const item of allWords) {
      if (!aggregated[item.word]) {
        aggregated[item.word] = { word: item.word, meaning: item.meaning, totalFrequency: 0, userCount: 0 };
      }
      aggregated[item.word].totalFrequency += item.frequency;
      aggregated[item.word].userCount += 1;
    }
    const result = Object.values(aggregated).sort((a, b) => b.totalFrequency - a.totalFrequency);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: '获取高频错词失败: ' + err.message });
  }
});

app.get('/api/admin/writing-trends', authenticate, requireAdmin, async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const writings = await sbGet('Writing',
      `select=score,"createdAt","userId"&score=not.is.null&order="createdAt".asc&limit=${parseInt(limit)}`
    );
    res.json(writings);
  } catch (err) {
    res.status(500).json({ error: '获取写作趋势失败: ' + err.message });
  }
});

app.patch('/api/admin/users/:userId/role', authenticate, requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['free', 'tester', 'pro', 'admin'].includes(role)) return res.status(400).json({ error: 'role 必须是 free/tester/pro/admin' });
    const updated = await sbPatch('User', `id=eq.${req.params.userId}`, { role });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: '更新用户角色失败: ' + err.message });
  }
});

// ============================================
// 6. 用户反馈
// ============================================
app.post('/api/feedback', authenticate, async (req, res) => {
  try {
    const { title, content, category = 'other' } = req.body;
    if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: '标题和内容不能为空' });
    const userInfo = await sbGet('User', `select=name,email&id=eq.${req.userId}`);
    const feedback = await sbPost('Feedback', {
      id: genId(),
      userId: req.userId,
      userName: userInfo[0]?.name || '',
      userEmail: userInfo[0]?.email || '',
      title: title.trim(),
      content: content.trim(),
      category,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    res.status(201).json(feedback);
  } catch (err) {
    res.status(500).json({ error: '提交反馈失败: ' + err.message });
  }
});

app.get('/api/feedback', authenticate, async (req, res) => {
  try {
    const feedbacks = await sbGet('Feedback',
      `select=id,title,content,category,status,"adminReply","createdAt","repliedAt"&"userId"=eq.${req.userId}&order="createdAt".desc`
    );
    res.json(feedbacks);
  } catch (err) {
    res.status(500).json({ error: '获取反馈失败: ' + err.message });
  }
});

// ============================================
// 7. 系统公告
// ============================================
app.get('/api/announcements', async (req, res) => {
  try {
    const announcements = await sbGet('Announcement',
      `select=id,title,content,type,"createdAt"&isActive=eq.true&order="createdAt".desc&limit=5`
    );
    res.json(announcements);
  } catch (err) {
    res.status(500).json({ error: '获取公告失败: ' + err.message });
  }
});

// ============================================
// 8. 管理后台 - 反馈管理
// ============================================
app.get('/api/admin/feedbacks', authenticate, requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let queryStr = `select=id,"userId","userName","userEmail",title,content,category,status,"adminReply","createdAt","repliedAt"&order="createdAt".desc`;
    if (status) queryStr += `&status=eq.${status}`;
    const feedbacks = await sbGet('Feedback', queryStr);
    res.json(feedbacks);
  } catch (err) {
    res.status(500).json({ error: '获取反馈列表失败: ' + err.message });
  }
});

app.patch('/api/admin/feedbacks/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { adminReply, status = 'resolved' } = req.body;
    const updated = await sbPatch('Feedback', `id=eq.${req.params.id}`, {
      adminReply,
      status,
      repliedAt: new Date().toISOString(),
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: '回复反馈失败: ' + err.message });
  }
});

// ============================================
// 9. 管理后台 - 公告管理
// ============================================
app.get('/api/admin/announcements', authenticate, requireAdmin, async (req, res) => {
  try {
    const announcements = await sbGet('Announcement',
      `select=id,title,content,type,isActive,"createdBy","createdAt"&order="createdAt".desc`
    );
    res.json(announcements);
  } catch (err) {
    res.status(500).json({ error: '获取公告列表失败: ' + err.message });
  }
});

app.post('/api/admin/announcements', authenticate, requireAdmin, async (req, res) => {
  try {
    const { title, content, type = 'info' } = req.body;
    if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: '标题和内容不能为空' });
    const announcement = await sbPost('Announcement', {
      id: genId(),
      title: title.trim(),
      content: content.trim(),
      type,
      isActive: true,
      createdBy: req.userId,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json(announcement);
  } catch (err) {
    res.status(500).json({ error: '发布公告失败: ' + err.message });
  }
});

app.patch('/api/admin/announcements/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const updates = {};
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.content !== undefined) updates.content = req.body.content;
    if (req.body.type !== undefined) updates.type = req.body.type;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
    const updated = await sbPatch('Announcement', `id=eq.${req.params.id}`, updates);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: '更新公告失败: ' + err.message });
  }
});

// ============================================
// 10. 会员体系 - 查询套餐和额度
// ============================================
app.get('/api/user/usage', authenticate, async (req, res) => {
  try {
    const userPlan = await getUserPlan(req.userId);
    if (!userPlan) return res.status(404).json({ error: '用户不存在' });
    const config = PLAN_CONFIG[userPlan.plan] || PLAN_CONFIG.free;
    const wrongWordsCount = await sbCount('WrongWord', `"userId"=eq.${req.userId}`);
    res.json({
      plan: userPlan.plan,
      role: userPlan.role,
      planExpiresAt: userPlan.raw.planExpiresAt || null,
      dailyUsage: userPlan.dailyUsage,
      limits: {
        writingDailyLimit: config.writingDailyLimit,
        exerciseDailyLimit: config.exerciseDailyLimit,
        wrongWordsLimit: config.wrongWordsLimit,
      },
      used: {
        writingToday: userPlan.dailyUsage.writing || 0,
        exerciseToday: userPlan.dailyUsage.exercise || 0,
        wrongWords: wrongWordsCount,
      },
      remaining: {
        writing: config.writingDailyLimit === Infinity ? Infinity : Math.max(0, config.writingDailyLimit - (userPlan.dailyUsage.writing || 0)),
        exercise: config.exerciseDailyLimit === Infinity ? Infinity : Math.max(0, config.exerciseDailyLimit - (userPlan.dailyUsage.exercise || 0)),
        wrongWords: config.wrongWordsLimit === Infinity ? Infinity : Math.max(0, config.wrongWordsLimit - wrongWordsCount),
      },
    });
  } catch (err) {
    res.status(500).json({ error: '查询额度失败: ' + err.message });
  }
});

// 获取套餐价格列表
app.get('/api/plans', (req, res) => {
  res.json({
    plans: [
      {
        id: 'free', name: '免费版', price: 0, period: 'forever',
        features: [
          'AI写作批改：每日3次',
          '错词本：最多50个单词',
          '智能出题：每日1次',
          '听写练习',
          '写作历史',
          '基础统计',
        ],
      },
      {
        id: 'pro_monthly', name: '专业版月付', price: 29.9, period: 'monthly',
        features: [
          'AI写作批改：无限次',
          '错词本：无限存储',
          '智能出题：无限次+全部题库',
          '高分范文库+万能句型库',
          '写作历史导出(PDF/Word)',
          '优先客服响应',
        ],
        popular: true,
      },
      {
        id: 'pro_yearly', name: '专业版年付', price: 199, period: 'yearly', originalPrice: 358.8,
        features: [
          '包含专业版月付全部权益',
          '年付立省159.8元',
          '专属年度学习报告',
        ],
      },
      {
        id: 'family_yearly', name: '家庭版年付', price: 399, period: 'family_yearly',
        features: [
          '5个独立账号',
          '共享Pro权益',
          '共享错词本',
          '共享写作题目库',
          '便于协作学习',
        ],
      },
    ],
  });
});

// ============================================
// 11. 支付接口（PayJS）
// ============================================
// 创建支付订单
app.post('/api/pay/order', authenticate, async (req, res) => {
  try {
    const { planId } = req.body;
    const priceConfig = PLAN_PRICES[planId];
    if (!priceConfig) return res.status(400).json({ error: '无效的套餐ID' });

    const orderId = genId();
    const now = new Date();
    const expiredAt = new Date(now.getTime() + 30 * 60 * 1000);

    const order = await sbPost('PaymentOrder', {
      id: orderId,
      userId: req.userId,
      plan: priceConfig.plan,
      amount: priceConfig.amount,
      period: priceConfig.period,
      status: 'pending',
      createdAt: now.toISOString(),
      expiredAt: expiredAt.toISOString(),
    });

    let payUrl = null;
    let payJsOrderId = null;
    if (process.env.PAYJS_MCHID && process.env.PAYJS_KEY) {
      const payJsParams = {
        mchid: process.env.PAYJS_MCHID,
        out_trade_no: orderId,
        total_fee: Math.round(priceConfig.amount * 100),
        body: priceConfig.name,
        notify_url: `${process.env.BACKEND_URL || 'https://english-learning-platform-yj04.onrender.com'}/api/pay/callback`,
      };
      const sortedKeys = Object.keys(payJsParams).sort();
      const signStr = sortedKeys.map(k => `${k}=${payJsParams[k]}`).join('&') + `&key=${process.env.PAYJS_KEY}`;
      const sign = crypto.createHash('md5').update(signStr).digest('hex');
      const payJsRes = await fetch('https://payjs.cn/api/native', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payJsParams, sign }),
      });
      const payJsData = await payJsRes.json();
      if (payJsData.return_code === 1) {
        payUrl = payJsData.qrcode;
        payJsOrderId = payJsData.payjs_order_id;
        await sbPatch('PaymentOrder', `id=eq.${orderId}`, { payUrl, payJsOrderId });
      }
    }

    res.json({
      orderId,
      plan: priceConfig.plan,
      period: priceConfig.period,
      amount: priceConfig.amount,
      name: priceConfig.name,
      payUrl,
      expiredAt: expiredAt.toISOString(),
      payJsEnabled: !!(process.env.PAYJS_MCHID && process.env.PAYJS_KEY),
    });
  } catch (err) {
    res.status(500).json({ error: '创建订单失败: ' + err.message });
  }
});

// 查询订单状态
app.get('/api/pay/order/:id', authenticate, async (req, res) => {
  try {
    const orders = await sbGet('PaymentOrder',
      `select=id,"userId",plan,amount,period,status,"payUrl","paidAt","createdAt","expiredAt"&id=eq.${req.params.id}&"userId"=eq.${req.userId}`
    );
    if (orders.length === 0) return res.status(404).json({ error: '订单不存在' });
    res.json(orders[0]);
  } catch (err) {
    res.status(500).json({ error: '查询订单失败: ' + err.message });
  }
});

// PayJS 支付回调
app.post('/api/pay/callback', async (req, res) => {
  try {
    const { return_code, out_trade_no, payjs_order_id, total_fee } = req.body;
    if (return_code !== 1) return res.send('fail');

    const orders = await sbGet('PaymentOrder', `select=id,"userId",plan,period,amount,status&id=eq.${out_trade_no}`);
    if (orders.length === 0) return res.send('fail');
    const order = orders[0];
    if (order.status === 'paid') return res.send('success');

    const now = new Date();
    let expiresAt = null;
    if (order.period === 'monthly') {
      expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    } else if (order.period === 'yearly' || order.period === 'family_yearly') {
      expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
    }

    await sbPatch('PaymentOrder', `id=eq.${out_trade_no}`, {
      status: 'paid',
      paidAt: now.toISOString(),
    });
    await sbPatch('User', `id=eq.${order.userId}`, {
      plan: order.plan,
      planExpiresAt: expiresAt,
    });

    res.send('success');
  } catch (err) {
    console.error('支付回调失败:', err.message);
    res.send('fail');
  }
});

// 手动激活套餐（管理员专用，用于测试或线下支付）
app.post('/api/admin/users/:userId/plan', authenticate, requireAdmin, async (req, res) => {
  try {
    const { plan, period = 'monthly' } = req.body;
    if (!['free', 'pro'].includes(plan)) return res.status(400).json({ error: 'plan 必须是 free 或 pro' });
    const now = new Date();
    let expiresAt = null;
    if (plan === 'pro') {
      if (period === 'monthly') expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      else if (period === 'yearly') expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
      else expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
    }
    const updated = await sbPatch('User', `id=eq.${req.params.userId}`, {
      plan,
      planExpiresAt: expiresAt,
    });
    res.json({ message: '套餐更新成功', plan, planExpiresAt: expiresAt });
  } catch (err) {
    res.status(500).json({ error: '更新套餐失败: ' + err.message });
  }
});

// ============================================
// 健康检查
// ============================================
app.get('/', (req, res) => {
  res.json({ service: '英语学习平台API', health: '/api/health', docs: '/api/health' });
});

app.get('/api/health', async (req, res) => {
  try {
    await sbGet('User', 'select=id&limit=1');
    res.json({ status: 'ok', database: 'connected', aiConfigured: !!process.env.AI_API_KEY });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected', message: err.message });
  }
});

// ============================================
// 启动服务器
// ============================================
app.listen(PORT, async () => {
  console.log(`\n🚀 英语学习平台后端运行在 http://localhost:${PORT} - server.js:842`);
  console.log(`📊 健康检查: http://localhost:${PORT}/api/health - server.js:843`);
  console.log(`🤖 AI 已配置: ${process.env.AI_API_KEY ? '是' : '否'} - server.js:844`);
  console.log(`🗄️  数据库: Supabase REST API - server.js:845`);
  try {
    await sbGet('User', 'select=id&limit=1');
    console.log('✅ 数据库连接正常 - server.js:848');
  } catch (err) {
    console.error('❌ 数据库连接失败: - server.js:850', err.message);
  }
  console.log(`\n📌 可用路由: - server.js:852`);
  console.log(`POST /api/auth/register | /api/auth/login - server.js:853`);
  console.log(`GET/POST/PUT/DELETE /api/wrongwords - server.js:854`);
  console.log(`POST /api/exercises/dictation | /api/exercises/generate - server.js:855`);
  console.log(`POST /api/writings/grade | GET /api/writings - server.js:856`);
  console.log(`GET /api/user/usage | /api/plans | /api/pay/order - server.js:857`);
  console.log(`POST /api/pay/callback | /api/admin/users/:id/plan\n - server.js:858`);
});
