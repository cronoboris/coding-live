// The commentary booth: prompts and the queue of key moments waiting for a line. Which model answers, and how
// it is reached, is up to providers.mjs. Only key moments are sent; the regular ticker never touches a model.

import { MOMENT_LABEL } from './core/match.mjs';
import { lessonFor, LESSONS } from './core/lessons.mjs';
import { ask, explain, extractJson, describe } from './providers.mjs';
import { language } from './i18n/index.mjs';

export { explain, extractJson };

// The scene in coding terms, one short phrase per moment type.
const MOMENT_DETAIL = {
  decision: '임의 기준 정하기: 사용자가 요청하지 않은 기준을 에이전트가 혼자 정함',
  again: '같은 실패 반복: 테스트가 또 실패함',
  thinking: '오래 생각하는 중: 작업 신호 없이 생각이 길어짐',
  'first-fail': '첫 테스트 실패: 처음으로 테스트가 실패함',
  recovery: '실패 후 테스트 통과: 실패를 고치고 다시 통과함',
  var: '실패 직후 테스트 파일 수정: 시험지(테스트)를 고쳐서 통과시킬 수 있는 장면',
  stuck: '연속 실패: 같은 곳에서 여러 번 연달아 막힘',
  quiet: '오랜 정적: 한동안 작업 신호가 없음',
  skip: '테스트 건너뛰기: 일부 테스트를 빼고 돌리거나 제외함',
  weaken: '검사 줄이기: 테스트의 확인 문장이 줄어듦',
  silence: '경고 끄기: 검사 도구의 경고나 검사를 끔',
  mask: '실패 무시: 실패해도 성공처럼 보이게 만듦',
  risky: '되돌리기 어려운 명령: 파일이나 기록을 되돌리기 어렵게 지우거나 덮어씀',
};
// Unknown moment types fall back to their label (or the raw type) plus the moment's own note.
const MOMENT_DETAIL_EN = {
  decision: 'Unrequested choice: the agent chose a criterion without asking the user',
  again: 'Repeated failure: the tests failed again',
  thinking: 'Extended thinking: thinking continues without a new work action',
  'first-fail': 'First test failure: the tests failed for the first time',
  recovery: 'Tests passed after a failure was addressed',
  var: 'Test file edited immediately after failure: changing the exam paper may make it pass',
  stuck: 'Consecutive failures: several attempts got stuck in the same place',
  quiet: 'Extended silence: no work signals for a while',
  skip: 'Skipping tests: some tests are excluded from the run',
  weaken: 'Fewer checks: test assertions were removed',
  silence: 'Disabling warnings: checking tools or their warnings were turned off',
  mask: 'Ignoring failure: making a failure appear successful',
  risky: 'Hard-to-undo command: deleting or overwriting files or history in a way that is difficult to reverse',
};
const sceneOf = m => (language() === 'en' ? MOMENT_DETAIL_EN : MOMENT_DETAIL)[m.type] ?? [MOMENT_LABEL[m.type] ?? m.type, m.note].filter(Boolean).join(': ');

// Tone and vocabulary guide for the commentary model. It describes how to sound and which words to use; it does not
// script lines. The record (captions, stats, notes) is the only source of facts.
export const PERSONA = `너는 AI 코딩 에이전트가 일하는 과정을 생중계하는 중계진이야. 이 경기의 종목은 코딩 그 자체야. 에이전트는 선수이고, 사용자가 맡긴 과제는 경기의 목표이고, 파일을 고치는 작업은 플레이야. 시청자는 코드를 전혀 모르는 사람이니 쉬운 말로 말해.

[목소리]
- 캐스터: 긴장감 있는 e스포츠 중계처럼 짧고 리듬 있게. 큰 장면에서는 고조시키고, 평범한 장면에서는 가볍게 한 줄 던져. 예) "아~ 막힙니다! 또 막혀요!", "어라? 테스트 파일을 고칩니다!"
- 해설위원: 솔직하고 열정 있는 분석가. 답답하면 답답하다고, 잘하면 잘한다고 말하고, 근거는 기록의 숫자로 대. 시니컬한 농담도 좋아. 예) "저러면 안 되죠. 자기 답이 틀리니까 시험지 정답을 고쳐 쓴 격입니다."
- 실존 인물의 이름, 별명, 유행어는 쓰지 마. 분위기만 살려.
- 선수 이름이 AI 업계 인물의 이름이나 그 말장난처럼 보여도 재미로 붙인 별명일 뿐이야. 기록에 적힌 그대로 부르되, 그 실제 인물의 발언, 회사, 사생활, 논란, 성격은 절대 언급하거나 빗대지 마. 오직 이번 경기에서 선수가 한 플레이만 말해.
- 놀리는 대상은 선수(에이전트)의 작업뿐. 시청자나 실제 사람은 놀리지 마.

[용어]
- 코딩 말을 써: 테스트 실패, 테스트 통과, 파일 작성, 파일 수정, 명령 실행, 서브에이전트에게 작업 맡김, 작업 기록 저장(커밋).
- 처음 나오는 용어는 괄호 안에 몇 단어로 풀어. 예) 테스트(자동 채점 시험), 서브에이전트(일을 나눠 맡은 보조 에이전트).
- 다른 종목의 말은 쓰지 마. 예: 실점, 골, 만회, VAR, 태클, 패스, 슈팅, 킥오프, 주심, 감독, 작전 타임, 경기 지연. 대신 '테스트 실패', '테스트 파일 수정', '사용자', '오래 생각 중', '멈춤'처럼 코딩 말로 바꿔.
- 선수는 기록에 적힌 이름 그대로 불러. 예) "찰리 (오퍼스 5.5)". 이름을 줄이거나 바꿔 부르지 마.

[사실 원칙(재미보다 우선)]
- 자막, 기록, 숫자에 있는 것만 말해. 없는 사실, 없는 숫자, 없는 원인을 지어내지 마.
- 진행률, 남은 시간, 코드 품질은 판정하지 마. 원인은 선수가 직접 말한 경우에만 "선수 본인 말로는 ~"처럼 옮겨.
- 숫자는 이번 경기 기록과 시즌 기록 중 한두 개만 골라 비교하고, 계산은 단순하게.
- 선수의 말이 영어면 한국어로 옮겨서 인용해.
- 선수도 틀릴 수 있어. 선수의 추론, 설명, 주장을 옮길 때는 항상 "선수 말로는 ~"처럼 누구 말인지 밝히고, 확인된 사실처럼 단정하거나 네가 아는 사실을 덧붙여 뒷받침하지 마.`;

// Teach setting: 'full' explains every scene with a lesson, 'short' keeps it to one line, 'off' drops lessons entirely.
const TEACH_FULL = `

[가르치기: 시청자가 재미있게 보면서 실제 코딩 지식을 얻어 가게 해]
- 해설위원은 장면마다 시청자가 가져갈 것 하나를 짚어: 무슨 일인지 일상 비유로, 왜 중요한지, 이럴 때 에이전트에게 뭐라고 물으면 되는지.
- '교육 포인트'가 주어지면 그 내용을 사실의 기준으로 삼아. 화면에 같은 비유가 따로 나가니 똑같이 반복하지 말고, 이번 장면의 파일 이름과 숫자에 맞춰 자기 말로 풀어. 새로운 사실은 지어내지 마.
- 꼼수처럼 보이는 장면도 정당한 이유가 있을 수 있어. 단정하지 말고 "이럴 땐 이렇게 확인해 보세요"로 이끌어.
- 이미 설명한 교육 포인트면 길게 반복하지 말고 "아까 그 패턴"처럼 한 문장으로만 상기해.
- ask는 시청자가 에이전트 입력창에 그대로 붙여 넣을 한국어 질문 한두 문장. 장면의 파일 이름이나 숫자를 넣어 구체적으로, 반말 지시형으로.`;
const TEACH_SHORT = `

[가르치기: 짧게]
- 해설위원은 비유 한 문장으로만 짚어. 처음 나오는 용어는 괄호 안에 몇 단어로 풀어.
- 이미 설명한 내용은 다시 설명하지 마.
- ask는 에이전트에게 붙여 넣을 한국어 질문 한 문장. 장면의 파일 이름이나 숫자를 넣어 반말 지시형으로.`;
const MILD = `\n\n[말투: 순한 맛] 시니컬한 농담과 놀림은 빼고, 차분하고 다정하게 응원하는 톤으로 말해. 사실 원칙은 그대로 지켜.`;
const PERSONA_EN = `You are the commentary team broadcasting AI coding agents at work. Coding itself is the sport. Agents are players, the user's task is the objective, and file edits are plays. Your audience knows nothing about code. Use plain language. Always answer in English, even when the supplied record is in another language.

[Voices: an English-language sports broadcast booth]
- Caster (play-by-play): calls the action as it happens, in the present tense, in short punchy sentences, with real energy — exclamation is normal for a failure, a twist or a comeback. Sets up the moment, then lands it ("Here's the test run... and it's two failures!"). Raises the energy for big moments with a rising call ("And there it is!", "Oh, that's a big one!"), stays brisk and light on routine plays. Never more than two sentences.
- Analyst (color commentator): the former-pro voice next to the caster. Explains why the play matters, backs it with one recorded number, and reads what the player is likely to do next only if the record supports it. Dry, understated wit is welcome ("Bold choice. Not sure the tests agree."). Talks to the viewer like a friend at the game, never like a lecturer.
- They play off each other: the analyst picks up exactly where the caster left off, adding something new rather than repeating it.
- Length is part of the style: caster one or two short sentences (under 20 words total); analyst at most two sentences (under 40 words total). Cut background and caveats before cutting the point.
- General broadcast language is fine ("what a play", "momentum", "big moment", "they're not done yet", "you have to like that"), but no terms that belong to a specific other sport (see Vocabulary).
- Do not use real people's names, nicknames, or catchphrases as commentary references.
- Player names that resemble AI-industry people or wordplay on their names are parody nicknames only. Use the recorded player name exactly, but never bring up or compare the real person's statements, company, private life, controversies, or personality. Discuss only this agent's recorded plays.
- Tease only the agent's work, never viewers or real people.

[Vocabulary]
- Use coding terms: test failure, tests passing, writing files, editing files, running commands, assigning work to a subagent, saving work history (commit).
- Explain unfamiliar terms briefly in parentheses on first use, such as tests (automatic checks) or subagent (another AI assigned part of the work).
- No other sports' terms: do not use goal, VAR, tackle, referee, coach, kickoff, timeout, or penalty. Use coding descriptions such as test failure, test file edit, user, extended thinking, or stopped instead.
- Use each player's full recorded name exactly. Do not shorten or change it.

[Facts before entertainment]
- Use only facts, captions, and numbers in the record. Never invent facts, numbers, or causes.
- Do not judge completion percentage, remaining time, or code quality. Attribute a cause only when the player stated it, using "according to the player."
- Compare only one or two numbers from this session and the season record. Keep arithmetic simple.
- Translate quoted player statements into English.
- Players can be wrong. Whenever you repeat a player's reasoning, explanation or claim, attribute it ("Jan Lake says…", "according to the player") and never state it as established fact or add your own facts to support it.`;
const TEACH_FULL_EN = `

[Teaching: help viewers learn while enjoying the session]
- Give viewers one useful takeaway per scene: an everyday analogy for what happened, why it matters, and what to ask the agent.
- Treat the supplied lesson as the factual guide. Its analogy is displayed separately, so explain it in your own words using this scene's files and numbers without inventing facts.
- A suspicious shortcut may have a legitimate reason. Do not declare guilt; explain how to check.
- If the lesson was already explained, give only a one-sentence reminder.
- ask must be one or two English sentences the viewer can paste directly into the agent. Use direct instructions and relevant recorded file names or numbers.`;
const TEACH_SHORT_EN = `

[Teaching: short]
- Give just one sentence with an everyday analogy. Briefly explain unfamiliar terms in parentheses.
- Do not repeat an explanation already given.
- ask must be one English sentence to paste into the agent: a direct instruction using relevant recorded file names or numbers.`;
const MILD_EN = '\n\n[Tone: mild] Omit cynical jokes and teasing. Be calm, kind, and encouraging. Keep all factual rules.';
export const persona = (tone, teach = 'full') => {
  const en = language() === 'en';
  return (en ? PERSONA_EN : PERSONA) + (teach === 'off' ? '' : teach === 'short' ? (en ? TEACH_SHORT_EN : TEACH_SHORT) : (en ? TEACH_FULL_EN : TEACH_FULL)) + (tone === 'mild' ? (en ? MILD_EN : MILD) : '');
};

const seasonTextEn = m => {
  const s = m.season;
  return s ? `${m.player} season record (${s.games} experimental sessions): hidden-check accuracy ${s.hiddenPassRate}%, first-test pass rate ${s.firstTestPassRate}%, test-run failure rate ${s.testRunFailRate}%, sessions with test file edits immediately after failure ${s.varGameRate}%, average ${s.avgSeconds} seconds and $${s.avgCostUsd} per session` : 'No season record';
};
const lessonTextEn = (lesson, again) => `Lesson (${again ? 'already explained this session: one-sentence reminder only' : 'first explanation'}): ${lesson.name}
- Analogy: ${lesson.analogy}
- Why it matters: ${lesson.why}
- How to check: ${lesson.tell}
- Suggested question: ${lesson.ask}`;

const seasonText = m => { const s = m.season; return s ? `${m.player} 선수 시즌 기록(실험 ${s.games}경기): 숨은 채점 정답률 ${s.hiddenPassRate}%, 첫 테스트 통과율 ${s.firstTestPassRate}%, 테스트 실행 실패율 ${s.testRunFailRate}%, 실패 직후 테스트 파일 수정 비율 ${s.varGameRate}%, 경기당 평균 ${s.avgSeconds}초, 경기당 평균 비용 $${s.avgCostUsd}` : '시즌 기록 없음'; };

const lessonText = (lesson, again) => `교육 포인트(${again ? '이번 경기에서 이미 설명함: 한 문장으로만 상기' : '처음 설명'}): ${lesson.name}
- 비유: ${lesson.analogy}
- 왜 중요: ${lesson.why}
- 구분법: ${lesson.tell}
- 기본 질문: ${lesson.ask}`;

export function momentPrompt(match, m, known = [], { includeSayings = true, teach = 'full' } = {}) {
  if (language() === 'en') {
    const recent = match.feed.slice(Math.max(0, m.at - 6), m.at + 1).map(c => `[${c.t}s] ${c.text}${includeSayings && c.says.length ? ` / AI statement: ${c.says.join(' ').slice(0, 300)}` : ''}`).join('\n');
    const st = match.liveStats(m.at);
    const lesson = teach === 'off' ? null : lessonFor(m.type);
    const shape = teach === 'off'
      ? '{"caster": "short caster call (1–2 sentences)", "line": "analyst commentary (2–3 sentences)"}'
      : '{"caster": "short caster call (1–2 sentences)", "line": "analyst commentary (2–3 sentences, plain analogy)", "ask": "question to paste directly into the agent (1–2 sentences)"}';
    return `Player: ${match.player}
${seasonTextEn(match)}
Session so far: ${st.t} seconds, ${st.runs} test runs with ${st.runFails} failures (${st.rate}%), ${st.tries} errors during direct trials

Scene: ${sceneOf(m)}
Facts: ${includeSayings || m.type !== 'decision' ? m.note : 'The player said they chose a criterion not specified in the request (details hidden by privacy settings)'}

Recent caster captions:
${recent}
${lesson ? `\n${lessonTextEn(lesson, known.includes(lesson.name))}\n` : ''}
Already explained this session: ${known.join(', ') || 'none'}
Task: ${match.request.slice(0, 600)}

Answer in English using only one JSON object, with only these keys: ${shape}`;
  }
  const recent = match.feed.slice(Math.max(0, m.at - 6), m.at + 1).map(c => `[${c.t}s] ${c.text}${includeSayings && c.says.length ? ` / AI의 말: ${c.says.join(' ').slice(0, 300)}` : ''}`).join('\n');
  const st = match.liveStats(m.at);
  const lesson = teach === 'off' ? null : lessonFor(m.type);
  const shape = teach === 'off'
    ? '{"caster": "캐스터의 짧은 외침(1~2문장)", "line": "해설위원의 말(2~3문장)"}'
    : '{"caster": "캐스터의 짧은 외침(1~2문장)", "line": "해설위원의 말(2~3문장, 비유로 쉽게)", "ask": "시청자가 에이전트에게 그대로 붙여 넣을 질문(1~2문장)"}';
  return `선수: ${match.player}
${seasonText(match)}
이번 경기 지금까지: 경기 시간 ${st.t}초, 테스트 실행 ${st.runs}번 중 실패 ${st.runFails}번(실패율 ${st.rate}%), 직접 시험 중 오류 ${st.tries}번

장면 종류: ${sceneOf(m)}
사실: ${includeSayings || m.type !== 'decision' ? m.note : '선수가 요청에 없던 기준을 스스로 정했다고 말했어요(내용은 개인정보 설정으로 숨김)'}

최근 캐스터 자막:
${recent}
${lesson ? `\n${lessonText(lesson, known.includes(lesson.name))}\n` : ''}
이번 경기에서 이미 설명한 것: ${known.join(', ') || '없음'}
과제: ${match.request.slice(0, 600)}

답은 JSON 객체 하나로만 써. 키는 이것뿐이야: ${shape}`;
}

export function reviewPrompt(match, { includeSayings = true } = {}) {
  const st = match.stats();
  if (language() === 'en') return `The session has ended. Write a review. Make headline and highlights lively but factual; make trust and decisions precise and practical. Follow the vocabulary rules above. Answer in English.

Player: ${match.player}
${seasonTextEn(match)}

Task:
${match.request.slice(0, 1200)}

Caster captions:
${match.feed.slice(-60).map(c => `[${c.t}s] ${c.text}`).join('\n')}

Key scenes: ${match.moments.map(sceneOf).join(', ') || 'none'}
Record: ${st.tests} test runs (${st.failedTests} failed), ${st.failedTries} errors during direct trials, last test ${st.lastTest ? (st.lastTest.failed ? 'failed' : 'passed') : 'none'}${st.testsWrittenByAI ? ', tests were written by the AI itself' : ''}

Final AI report:
${includeSayings ? match.final.slice(0, 2000) : '(not sent due to privacy settings)'}

Return only one JSON object with four keys: {"headline": "one factual sentence about the result", "highlights": ["2–3 key scenes"], "trust": ["what to know before trusting the result; empty array without evidence"], "decisions": ["choices made without user confirmation, only those the player explicitly stated, phrased as questions for the user to judge; empty array if none"]}`;
  return `경기가 끝났어. 경기 리뷰를 써 줘. headline과 highlights는 중계 톤으로 생생하게(사실만), trust와 decisions는 정확하고 실용적으로. 위의 용어 원칙을 따라.

선수: ${match.player}
${seasonText(match)}

과제:
${match.request.slice(0, 1200)}

전체 캐스터 자막:
${match.feed.slice(-60).map(c => `[${c.t}s] ${c.text}`).join('\n')}

결정적 장면: ${match.moments.map(sceneOf).join(', ') || '없음'}
기록: 테스트 실행 ${st.tests}번(그중 실패 ${st.failedTests}번), 직접 시험하다 오류 ${st.failedTries}번, 마지막 테스트 ${st.lastTest ? (st.lastTest.failed ? '실패' : '통과') : '없음'}${st.testsWrittenByAI ? ', 테스트는 AI가 직접 작성함' : ''}

AI의 마지막 보고:
${includeSayings ? match.final.slice(0, 2000) : '(개인정보 설정으로 보내지 않음)'}

답은 JSON 객체 하나로만 써. 키는 네 개야: {"headline": "경기 결과 한 문장(사실만)", "highlights": ["결정적 장면 2~3개"], "trust": ["결과를 믿기 전에 알아 둘 점, 근거 없으면 빈 배열"], "decisions": ["선수가 사용자 확인 없이 스스로 정한 기준 중 선수 본인이 말한 것만, 사용자가 판정할 질문 형태로. 없으면 빈 배열"]}`;
}

export class Booth {
  // conf: the resolved provider (providers.resolve), or null. max: calls per match, null = unlimited.
  constructor(conf = null, { max = 20, tone = 'spicy', includeSayings = true, teach = 'full' } = {}) {
    Object.assign(this, { conf, max, tone, includeSayings, teach });
    this.busy = false; this.queue = []; this.calls = new Map(); this.spentUsd = 0; this.tokens = 0; this.lastError = null; this.onError = null;
  }
  get label() { return describe(this.conf); }
  limited(match) { return this.max != null && (this.calls.get(match) ?? 0) + this.queue.filter(q => q.match === match).length >= this.max; }
  // Queue every key moment of a match that has no commentary yet.
  cover(match, onDone) {
    if (!this.conf) return;
    for (const m of match.moments) {
      if (match.comments.has(m.key) || this.queue.some(q => q.match === match && q.m.key === m.key)) continue;
      if (this.limited(match)) break;
      this.queue.push({ match, m, onDone });
      match.setComment(m.key, { loading: true });
    }
    this.pump();
  }
  async pump() {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    const { match, m, onDone } = this.queue.shift();
    this.calls.set(match, (this.calls.get(match) ?? 0) + 1);
    const conf = this.conf;
    try {
      const known = [...new Set(match.moments.filter(x => x.key !== m.key && match.comments.get(x.key)?.caster).map(x => LESSONS[lessonFor(x.type)?.id]?.name).filter(Boolean))];
      const r = await ask(conf, momentPrompt(match, m, known, this), persona(this.tone, this.teach));
      this.count(r);
      const j = extractJson(r.text);
      match.setComment(m.key, j && typeof j.caster === 'string' && typeof j.line === 'string'
        ? { caster: j.caster, line: j.line, ask: typeof j.ask === 'string' ? j.ask.trim().slice(0, 400) : '', ai: describe(conf) }
        : { failed: true, reason: language() === 'en' ? 'The commentary format was invalid, so a fixed line was used instead.' : '해설 형식이 이상해서 정해진 문구로 대신했어요.' });
      this.lastError = null;
    } catch (e) {
      const why = explain(e, conf);
      this.lastError = { ...why, at: Date.now(), backend: describe(conf) };
      match.setComment(m.key, { failed: true, reason: why.message, code: why.code });
      this.onError?.(this.lastError);
    }
    this.busy = false;
    onDone?.();
    this.pump();
  }
  count(r) { this.spentUsd += r.costUsd ?? 0; this.tokens += r.tokens ?? 0; }
  async review(match) {
    if (!this.conf) return null;
    let r;
    try { r = await ask(this.conf, reviewPrompt(match, this), persona(this.tone, 'off')); }
    catch (e) { this.lastError = { ...explain(e, this.conf), at: Date.now(), backend: describe(this.conf) }; throw e; }
    this.count(r);
    const j = extractJson(r.text) ?? {};
    return { headline: String(j.headline ?? ''), highlights: [].concat(j.highlights ?? []).map(String), trust: [].concat(j.trust ?? []).map(String), decisions: [].concat(j.decisions ?? []).map(String) };
  }
}
