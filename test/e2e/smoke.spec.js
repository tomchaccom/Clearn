import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HTML = 'file://' + ROOT + '/src/renderer/index.html';

const MOCK_API = `
window.api = {
  settings: { get: async () => ({ onboardingDone: true, level: '학부생', model: 'sonnet' }), set: async () => {} },
  sessions: { list: async () => [], create: async () => ({ id:'t', question:'Q', topic:'T', hypothesis:'H', createdAt: Date.now() }), get: async () => null },
  cards: { due: async () => [], all: async () => [], answer: async () => ({ grade:4, feedback:'ok', card:{ due: Date.now()+86400000 } }) },
  explains: { list: async () => [] },
  dash: { stats: async () => ({ sessions:0, explains:0, cards:0, recalls:0, successRate:0, avgScore:0, concepts:[], recentDays:[] }) },
  health: { check: async () => ({ ok:true, model:'claude-sonnet-4-6' }) },
  onboarding: { complete: async () => {} },
  forgetting: { status: async () => [] },
  obsidian: { check: async () => ({ configured:false }), pick: async () => null, export: async () => null, exportSession: async () => ({ note:'/tmp/t.md', created:true }), buildDag: async () => ({ edges:0 }), buildConceptNote: async () => null, reveal: async () => null },
  data: { info: async () => ({ path:'/tmp', size:0 }), backup: async () => null, reveal: async () => null, notes: async () => [] },
};
`;

test('앱 로드 — 탐구 탭 기본 표시', async ({ page }) => {
  await page.addInitScript(MOCK_API);
  await page.goto(HTML);
  await expect(page.locator('.tab[data-view="inquiry"]')).toBeVisible();
  await expect(page.locator('#gate')).toBeVisible();
});

test('게이트 — 가설 입력 시 시작 버튼 활성화', async ({ page }) => {
  await page.addInitScript(MOCK_API);
  await page.goto(HTML);
  await page.fill('#gateQuestion', 'Node.js 이벤트 루프란?');
  await page.fill('#gateTopic', 'Node');
  await page.click('#gateNext'); // 2-step: 1단계 → 2단계
  await page.fill('#gateHypothesis', '이벤트 루프는 비동기 처리를 담당하는 메커니즘이라고 생각해요.');
  await expect(page.locator('#gateStart')).toBeEnabled();
});

test('탭 전환 — 설명 탭', async ({ page }) => {
  await page.addInitScript(MOCK_API);
  await page.goto(HTML);
  await page.click('.tab[data-view="explain"]');
  await expect(page.locator('#view-explain')).toHaveClass(/active/);
});

test('탭 전환 — 대시보드 탭', async ({ page }) => {
  await page.addInitScript(MOCK_API);
  await page.goto(HTML);
  await page.click('.tab[data-view="dash"]');
  await expect(page.locator('#view-dash')).toHaveClass(/active/);
});

test('설정 모달 — 열기', async ({ page }) => {
  await page.addInitScript(MOCK_API);
  await page.goto(HTML);
  await page.click('#settingsBtn');
  await expect(page.locator('#settingsModal')).not.toHaveAttribute('hidden');
});
