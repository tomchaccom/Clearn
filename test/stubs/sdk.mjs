/**
 * Claude Agent SDK 스텁.
 * 프롬프트를 보고 어떤 호출인지 판별해 결정론적 응답을 돌려준다.
 * 실제 모델을 호출하지 않으므로 테스트가 빠르고 비용이 없다.
 */
export const __calls = [];
export function __reset() {
  __calls.length = 0;
}

export async function* query({ prompt, options }) {
  __calls.push({ prompt, options });

  const sid = options?.resume ?? 'sdk-session-1';
  yield { type: 'system', subtype: 'init', session_id: sid };

  const p = String(prompt);
  const sys = options?.systemPrompt ?? '';
  let text;

  if (/JSON generator/i.test(sys)) {
    if (/인출 연습/.test(p)) {
      text =
        '```json\n' +
        JSON.stringify([
          { front: '마이크로태스크 큐는 언제 비워지나요?', back: '각 매크로태스크 사이에 완전히', concept: 'microtask', kind: 'core' },
          { front: '전이 문제입니다', back: '요점', concept: 'microtask', kind: 'transfer' },
        ]) +
        '\n```';
    } else if (/인출 퀴즈 채점/.test(p)) {
      text = '{"grade":4,"feedback":"핵심은 짚었어요.","missing":["우선순위 근거"]}';
    } else {
      text = JSON.stringify({
        score: 72,
        verdict: '방향은 맞아요.',
        findings: [
          { kind: 'correct', quote: '큐', note: '정확해요', fix: '' },
          { kind: 'gap', quote: '', note: '우선순위 근거 누락', fix: '왜 먼저일까요?' },
        ],
        concepts: ['microtask'],
      });
    }
  } else if (/__MULTIQ__/.test(p)) {
    // "한 턴에 질문 하나" 규칙을 어긴 응답. 삼항연산자는 오탐 대상이 아님을 함께 검증.
    text =
      '맨 처음 호출은 어떻게 생겼을까요? 그리고 `root->right = insert(...)` 는 덮어쓰는 걸까요?\n' +
      '```cpp\nint m = a > b ? a : b;\n```\n마지막으로 data가 같으면 어떻게 되나요?';
  } else if (/코치/.test(sys)) {
    text = '정답 공개 비율이 높아요.';
  } else if (/한 단어로만/.test(sys)) {
    text = 'ok';
  } else {
    text = '그렇다면 setTimeout(fn,0)은 어디에 놓일까요?';
  }

  if (options?.includePartialMessages) {
    for (const chunk of text.match(/[\s\S]{1,12}/g) ?? []) {
      yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: chunk } } };
    }
  }
  yield { type: 'assistant', session_id: sid, message: { content: [{ type: 'text', text }] } };
  yield { type: 'result', subtype: 'success', session_id: sid };
}

export const tool = () => {};
export const createSdkMcpServer = () => {};
