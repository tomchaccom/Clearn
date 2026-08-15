/**
 * 테스트 부트스트랩. `node --import ./test/setup.mjs test/integration.mjs`
 *
 * 'electron' 과 '@anthropic-ai/claude-agent-sdk' 를 test/stubs/ 로 리다이렉트한다.
 * ESM(import)과 CJS(require) 양쪽을 모두 가로채야 한다 —
 * main.js/agent.js 는 ESM, preload.cjs 는 CJS 이기 때문.
 */
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUBS = path.join(HERE, 'stubs');

const ESM_MAP = {
  electron: path.join(STUBS, 'electron.mjs'),
  '@anthropic-ai/claude-agent-sdk': path.join(STUBS, 'sdk.mjs'),
};
const CJS_MAP = {
  electron: path.join(STUBS, 'electron.cjs'),
};

/* CJS require 가로채기 */
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (CJS_MAP[request]) return CJS_MAP[request];
  return origResolve.call(this, request, ...rest);
};

/* ESM import 가로채기 */
Module.register(pathToFileURL(path.join(HERE, 'resolver.mjs')).href, {
  parentURL: import.meta.url,
  data: Object.fromEntries(Object.entries(ESM_MAP).map(([k, v]) => [k, pathToFileURL(v).href])),
});

/* 격리된 userData 디렉터리 */
const dir = path.join(HERE, '.tmp-userdata');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
process.env.TEST_USERDATA = dir;
