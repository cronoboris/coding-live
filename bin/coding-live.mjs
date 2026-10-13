#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { startServer } from '../src/server.mjs';

const { values } = parseArgs({ options: {
  port: { type: 'string', default: process.env.CODING_LIVE_PORT ?? '4417' },
  mic: { type: 'string', default: process.env.CODING_LIVE_MIC },
  'no-open': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} });

if (values.help) {
  console.log(`coding-live — 돌고 있는 코딩 에이전트를 스포츠 중계처럼 보여 줘요.

사용법: coding-live [--port 4417] [--mic auto|anthropic|openai|google|ollama|compatible|off] [--no-open]

  --mic   결정적 장면 해설에 쓸 프로바이더(이번 실행에만 적용). auto는 준비된 것 중 먼저 찾은 걸 써요. off면 정해진 문구로 해설해요.
          claude·gemini·codex를 넣으면 그 CLI 로그인으로 불러요.
  --no-open  브라우저를 자동으로 열지 않아요.

세션 기록은 이 컴퓨터 밖으로 나가지 않아요. 서버는 127.0.0.1에서만 열려요.
단, 마이크를 켜면 결정적 장면의 요약이 고른 CLI의 모델로 전달돼요.`);
  process.exit(0);
}

const app = await startServer({ port: Number(values.port), mic: values.mic }).catch(e => {
  console.error(e.code === 'EADDRINUSE' ? `포트 ${values.port}이(가) 이미 쓰이고 있어요. --port로 다른 포트를 고르세요.` : e.message);
  process.exit(1);
});
console.log(`coding-live 중계석이 열렸어요: ${app.url}`);
console.log(`해설 마이크: ${app.backend ?? '없음(정해진 문구로 해설)'}  ·  찾은 세션 ${app.hub.sessions.length}개`);
if (!values['no-open']) {
  const cmd = process.platform === 'darwin' ? ['open', [app.url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', app.url]] : ['xdg-open', [app.url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}
