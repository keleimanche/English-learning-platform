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
// 查询单词词义（免费词典 API）
// ============================================
// 替换原来的词典查询函数
async function fetchWordMeaning(word) {
  try {
    // 使用有道词典API（免费，无需API Key）
    const response = await fetch(
      `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`
    );
    
    if (!response.ok) {
      throw new Error('词典查询失败');
    }
    
    const data = await response.json();
    
    // 提取中文释义
    let meaning = '未找到释义';
    let phonetic = '';
    
    // 解析有道返回的数据结构
    if (data.ec && data.ec.word && data.ec.word.trs) {
      const trs = data.ec.word.trs;
      if (trs.length > 0) {
        // 提取中文翻译
        const translations = trs.map(t => {
          if (t.tr && t.tr.length > 0) {
            return t.tr.map(tr => tr.l?.i || '').filter(Boolean).join('；');
          }
          return '';
        }).filter(Boolean);
        meaning = translations.join('；') || '未找到释义';
      }
    }
    
    // 提取音标
    if (data.ec && data.ec.word && data.ec.word.phone) {
      phonetic = data.ec.word.phone;
    }
    
    return { meaning, phonetic };
  } catch (error) {
    console.error('词典查询失败: - server.js:209', error.message);
    // 返回默认值
    return {
      meaning: '（查询失败，请手动输入释义）',
      phonetic: ''
    };
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
    const user = await sbPost('User', {
      id, email, password: hashedPassword, name,
      createdAt: now, updatedAt: now,
    });

    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.status(201).json({ token, user: { id, email, name, role: 'user' } });
  } catch (err) {
    res.status(500).json({ error: '注册失败: ' + err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: '邮箱和密码为必填' });

    const users = await sbGet('User', `select=id,email,password,name,role&email=eq.${encodeURIComponent(email)}`);
    const user = users[0];
    if (!user) return res.status(401).json({ error: '邮箱或密码错误' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: '邮箱或密码错误' });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role || 'user' } });
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
app.post('/api/exercises/generate', authenticate, async (req, res) => {
  try {
    const { type = 'reading', wordCount = 8, difficulty = 3 } = req.body;
    const words = await sbGet('WrongWord',
      `select=word&"userId"=eq.${req.userId}&order=frequency.desc&limit=${wordCount}`
    );
    if (words.length < 3) return res.status(400).json({ error: '至少需要 3 个错词才能生成题目' });

    const wordList = words.map(w => w.word).join(', ');
    let prompt = '';
    if (type === 'reading') {
      prompt = `你是一位英语教学专家。请根据以下学生常错的单词，编写一篇约 200 词的英语阅读理解文章，文章中要自然地使用这些单词：${wordList}。

请返回 JSON 格式（不要包含 markdown 代码块标记）：
{"passage":"文章正文","questions":[{"question":"问题","options":["A选项","B选项","C选项","D选项"],"answer":"正确选项字母如A","explanation":"解析"}]}

要求：生成 4 道选择题，难度等级 ${difficulty}，文章主题积极向上。`;
    } else if (type === 'cloze') {
      prompt = `你是一位英语教学专家。请根据以下学生常错的单词，编写一篇约 150 词的英语完型填空文章，挖空处使用这些单词：${wordList}。

请返回 JSON 格式（不要包含 markdown 代码块标记）：
{"passage":"文章正文挖空处用___表示","blanks":[{"index":1,"answer":"正确单词","options":["干扰项1","干扰项2","干扰项3","正确单词"],"explanation":"解析"}]}

要求：挖空数量等于提供的单词数，每个空提供 4 个选项，难度等级 ${difficulty}。`;
    } else {
      return res.status(400).json({ error: '不支持的题目类型: ' + type });
    }

    const aiResponse = await callAI([
      { role: 'system', content: '你是英语教学专家，擅长根据学生的薄弱词汇设计针对性练习。只返回纯JSON，不要包含任何markdown标记。' },
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

// ============================================
// 5. 写作批改（AI）
// ============================================
app.post('/api/writings/grade', authenticate, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: '写作内容不能为空' });

    const wordCount = content.trim().split(/\s+/).length;
    const prompt = `你是一位专业的英语写作老师。请批改以下英语作文，给出详细的反馈。

标题：${title || '（无标题）'}
正文：
${content}

请返回 JSON 格式（不要包含 markdown 代码块标记）：
{"score":85,"overallComment":"总体评价","corrections":[{"original":"错误片段","corrected":"正确表达","reason":"修改原因"}],"strengths":["优点1"],"suggestions":["建议1"],"vocabularyAnalysis":"词汇分析","grammarAnalysis":"语法分析","structureAnalysis":"结构分析"}

评分标准：0-100 分。`;

    const aiResponse = await callAI([
      { role: 'system', content: '你是专业的英语写作老师，擅长批改英语作文并给出建设性反馈。只返回纯JSON，不要包含任何markdown标记。' },
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
    res.json(writing);
  } catch (err) {
    res.status(500).json({ error: '写作批改失败: ' + err.message });
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
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'role 必须是 admin 或 user' });
    const updated = await sbPatch('User', `id=eq.${req.params.userId}`, { role });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: '更新用户角色失败: ' + err.message });
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
  console.log(`GET /api/stats\n - server.js:857`);
});
