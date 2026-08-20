/**
 * Claude Agent SDK 래퍼.
 *
 * 이 앱은 툴을 전혀 쓰지 않는 순수 대화 모드로 SDK를 사용한다
 * (allowedTools: [], settingSources: [] → CLAUDE.md/프로젝트 설정도 안 읽음).
 * 인증은 로컬 Claude Code 로그인(구독)을 그대로 따라간다.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';

// 패키징 시 SDK 내장 바이너리가 asar 안에 갇혀 ENOTDIR이 발생하므로,
// 사용자가 설치한 claude CLI를 직접 지정한다.
function findClaudeCLI() {
  const candidates = [
    join(homedir(), '.local', 'bin', 'claude'),
    join(homedir(), '.claude', 'local', 'node_modules', '.bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  return candidates.find(existsSync) ?? undefined;
}
const CLAUDE_CLI = findClaudeCLI();

const BASE_OPTIONS = {
  allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
  disallowedTools: ['WebSearch', 'WebFetch'],
  settingSources: [],
  permissionMode: 'dontAsk',
  maxTurns: 15, // 파일 도구 사용 시 여러 턴 필요
  ...(CLAUDE_CLI ? { pathToClaudeCodeExecutable: CLAUDE_CLI } : {}),
};

let currentModel = 'sonnet';
export function setModel(m) {
  if (m) currentModel = m;
}
export function getModel() {
  return currentModel;
}

/** 진행 중인 요청 취소용 */
const inflight = new Map();

export function abort(requestId) {
  const ctl = inflight.get(requestId);
  if (ctl) {
    ctl.abort();
    inflight.delete(requestId);
    return true;
  }
  return false;
}

/**
 * 스트리밍 실행.
 * @param {object} p
 * @param {string} p.prompt
 * @param {string} p.systemPrompt
 * @param {string} [p.resume]      이어갈 SDK 세션 id
 * @param {string} [p.requestId]
 * @param {(chunk:string)=>void} [p.onDelta]
 * @returns {Promise<{text:string, sessionId:string|null}>}
 */
export async function run({ prompt, systemPrompt, resume, requestId, onDelta }) {
  const abortController = new AbortController();
  if (requestId) inflight.set(requestId, abortController);

  const options = {
    ...BASE_OPTIONS,
    model: currentModel,
    systemPrompt: systemPrompt ?? '',
    includePartialMessages: Boolean(onDelta),
    abortController,
  };
  if (resume) options.resume = resume;

  let text = '';
  let sessionId = resume ?? null;
  let sawDelta = false;
  const usage = { input: 0, output: 0 };

  try {
    for await (const msg of query({ prompt, options })) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id ?? sessionId;
        continue;
      }

      if (msg.type === 'stream_event') {
        const ev = msg.event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          sawDelta = true;
          text += ev.delta.text;
          onDelta?.(ev.delta.text);
        }
        continue;
      }

      if (msg.type === 'assistant') {
        sessionId = msg.session_id ?? sessionId;
        const u = msg.message?.usage;
        if (u) { usage.input += u.input_tokens ?? 0; usage.output += u.output_tokens ?? 0; }
        // 델타를 못 받은 경우(스트리밍 미사용/실패)에만 전체 텍스트를 채운다.
        if (!sawDelta) {
          const full = (msg.message?.content ?? [])
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('');
          if (full) {
            text = full;
            onDelta?.(full);
          }
        }
        continue;
      }

      if (msg.type === 'result') {
        sessionId = msg.session_id ?? sessionId;
        if (msg.subtype && msg.subtype !== 'success' && !text) {
          throw new Error(`Claude 응답 실패: ${msg.subtype}`);
        }
      }
    }
  } finally {
    if (requestId) inflight.delete(requestId);
  }

  return { text: text.trim(), sessionId, usage };
}

/** 툴 없이 한 방에 JSON을 받아오는 헬퍼. 실패 시 1회 재시도. */
export async function runJson({ prompt, systemPrompt }) {
  const sys =
    (systemPrompt ? systemPrompt + '\n\n' : '') +
    'You are a strict JSON generator. Output ONLY valid JSON. No markdown fences, no commentary, no preamble.';

  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await run({
      prompt: attempt === 0 ? prompt : prompt + '\n\n(이전 출력이 JSON 파싱에 실패했어요. JSON만 다시 출력하세요.)',
      systemPrompt: sys,
    });
    const parsed = extractJson(text);
    if (parsed !== undefined) return parsed;
  }
  throw new Error('모델이 유효한 JSON을 반환하지 않았어요.');
}

/** ```json 펜스나 앞뒤 잡담이 섞여 있어도 JSON을 뽑아낸다. */
export function extractJson(raw) {
  if (!raw) return undefined;
  let s = raw.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }

  // 첫 { 또는 [ 부터 짝이 맞는 끝까지 스캔
  const start = s.search(/[[{]/);
  if (start === -1) return undefined;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** 앱 시작 시 인증/모델 상태를 가볍게 확인한다. */
export async function healthCheck() {
  try {
    const { text } = await run({
      prompt: 'ok 이라고만 답하세요.',
      systemPrompt: '한 단어로만 답하세요.',
    });
    return { ok: true, model: currentModel, sample: text.slice(0, 40) };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}
