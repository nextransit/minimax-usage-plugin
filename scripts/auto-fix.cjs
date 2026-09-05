#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

const AI_API_KEY = process.env.AI_API_KEY;
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const FAILED_LOG = process.env.FAILED_LOG_PATH || 'failed.log';
const RUN_ID = process.env.RUN_ID || 'unknown';
const HEAD_SHA = process.env.HEAD_SHA || '';
const GH_TOKEN = process.env.GH_TOKEN || '';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
function sh0(cmd) {
  try { return sh(cmd); } catch { return ''; }
}

async function chat(messages) {
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({ model: AI_MODEL, messages, temperature: 0.2 }),
  });
  if (!res.ok) throw new Error(`AI API ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.choices[0].message.content;
}

function extractJsonArray(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\[[\s\S]*?\])/);
  if (!m) return [];
  try { return JSON.parse(m[1]); } catch { return []; }
}

function extractDiff(text) {
  const m = text.match(/```(?:diff|patch)\s*([\s\S]*?)```/);
  return m ? m[1].trim() : '';
}

function createIssue(title, log, extra) {
  const body = [
    `CI run ${RUN_ID}（commit ${HEAD_SHA}）失败，自动修复未能生成可应用的 patch。`,
    '',
    '### 失败日志',
    '```',
    (log || '').slice(0, 8000),
    '```',
    '',
    '### AI 输出',
    '```',
    (extra || '').slice(0, 4000),
    '```',
  ].join('\n');
  fs.writeFileSync('/tmp/issue-body.md', body);
  sh0(`gh issue create --title "${title.replace(/"/g, '\\"')}" --body-file /tmp/issue-body.md`);
  console.log('已创建 Issue 提示');
}

(async () => {
  if (!AI_API_KEY) {
    console.error('AI_API_KEY 未设置，跳过自动修复');
    process.exit(2);
  }

  const log = fs.existsSync(FAILED_LOG)
    ? fs.readFileSync(FAILED_LOG, 'utf8').slice(0, 24000)
    : '';
  const files = sh('git ls-files').trim().split('\n').filter(Boolean);

  console.log(`失败日志 ${log.length} 字节，仓库 ${files.length} 文件`);

  const pick = await chat([
    {
      role: 'system',
      content:
        '你是 CI 修复助手。分析失败日志，选出最可能需要修改的源文件路径。只返回 JSON 字符串数组，不要其他文字。',
    },
    {
      role: 'user',
      content: `失败日志:\n${log}\n\n仓库文件列表:\n${files.join('\n')}\n\n返回最多 5 个最相关源文件路径的 JSON 数组。`,
    },
  ]);
  const targets = extractJsonArray(pick)
    .filter((f) => files.includes(f))
    .slice(0, 5);
  console.log('选定文件:', targets);

  if (targets.length === 0) {
    createIssue('AI 自动修复：无法定位相关文件', log, pick);
    process.exit(0);
  }

  const fileContents = targets
    .map((f) => {
      const c = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(0, 16000) : '(文件不存在)';
      return `=== ${f} ===\n${c}`;
    })
    .join('\n\n');

  const diffResp = await chat([
    {
      role: 'system',
      content:
        '你是 CI 修复助手。基于失败日志和相关文件内容，返回最小修复的 unified diff（git apply 格式，含 --- a/path 和 +++ b/path 头）。只返回 diff 代码块，不要解释。若无法修复，返回空 diff。',
    },
    {
      role: 'user',
      content: `失败日志:\n${log}\n\n相关文件:\n${fileContents}\n\n返回用三反引号包围的 diff 代码块。`,
    },
  ]);
  const diff = extractDiff(diffResp);
  if (!diff) {
    console.log('AI 未返回 diff');
    createIssue('AI 自动修复：未生成 diff', log, diffResp);
    process.exit(0);
  }

  fs.writeFileSync('fix.patch', diff + '\n');
  try {
    sh('git apply --3way fix.patch');
  } catch (e) {
    console.log('patch 应用失败:', e.message);
    createIssue('AI 自动修复：patch 应用失败', log, diff);
    process.exit(0);
  }

  const hasChange = sh0('git status --porcelain').trim();
  if (!hasChange) {
    console.log('patch 应用后无实际改动，跳过');
    process.exit(0);
  }

  const branch = `auto-fix/run-${RUN_ID}`;
  const existing = sh0(`git ls-remote origin ${branch}`).trim();
  if (existing) {
    console.log(`分支 ${branch} 已存在，跳过重复创建`);
    process.exit(0);
  }

  sh(`git checkout -b ${branch}`);
  sh('git add -A');
  sh(
    `git commit -m "fix(ci): 自动修复 run ${RUN_ID} 的 CI 失败" -m "由 AI 根据 CI 失败日志生成。对应 commit ${HEAD_SHA}"`
  );
  sh(`git push origin ${branch}`);

  const prBody = [
    '## 自动修复 PR',
    '',
    `针对 CI run ${RUN_ID}（commit ${HEAD_SHA}）的失败自动生成。`,
    '',
    '### 修复 diff',
    '```diff',
    diff,
    '```',
    '',
    '请人工 review 后合并。',
  ].join('\n');
  fs.writeFileSync('/tmp/pr-body.md', prBody);
  sh(
    `gh pr create --title "fix(ci): 自动修复 run ${RUN_ID}" --body-file /tmp/pr-body.md --base master`
  );
  console.log('PR 已创建');
})().catch((e) => {
  console.error('自动修复失败:', e.message);
  process.exit(1);
});
