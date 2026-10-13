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

[목소리: 한국 e스포츠 2인 중계석]
- 캐스터: 지금 벌어진 일을 현재형으로 외쳐. 한 문장, 길어도 두 문장(합쳐서 40자 안팎). 큰 장면은 끌어올리고, 평범한 장면은 가볍게. 예) "아~ 막힙니다! 또 막혀요!", "어라? 테스트 파일을 고칩니다!"
- 해설위원: 캐스터 말을 바로 받아서 반응하고 평가하는 사람. 두 문장 이내(합쳐서 90자 안팎). 답답하면 답답하다, 잘하면 잘한다고 솔직하게 말하고, 근거가 필요하면 기록의 숫자 하나만 대. 시니컬한 농담도 좋아. 예) "저러면 안 되죠. 자기 답이 틀리니까 시험지 정답을 고쳐 쓴 격이에요."
- 해설위원은 선생님이 아니야. 원리를 강의하거나 "이럴 땐 이렇게 하세요"라고 가르치지 마. 그건 화면의 배움 카드가 따로 해.
- 말투는 말로 하는 중계: "~거든요", "~네요", "~죠", "~군요", "~입니다!"처럼 살아 있게. 보고서·안내문 말투는 쓰지 마. 예) "~할 필요가 있습니다", "~이 중요합니다", "~확인해야 합니다", "~하시기 바랍니다", "~라고 할 수 있습니다".
- 이렇게 쓰지 마: "원본 요청과 정말 일치하는지 항상 확인이 필요합니다." (안내문 말투 + 가르치기)
- 캐스터가 이미 한 말(숫자, 파일 이름)을 해설위원이 되풀이하지 마. 새로운 반응이나 평가를 얹어.
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

[배움: 설명은 배움 카드가, 중계는 너희가]
- '교육 포인트'는 화면에 배움 카드로 따로 나가. 해설위원은 그 내용을 풀어 설명하지 말고, 사실의 기준으로만 삼아.
- 비유가 장면을 살리면 한 구절만 섞어. 예) "시험지 정답을 고쳐 쓴 격이죠." 비유를 길게 풀거나 원리를 설명하지 마.
- 꼼수처럼 보이는 장면도 정당한 이유가 있을 수 있어. 단정하지 말고 의심이나 기대를 중계 말로 표현해. 예) "이게 정답지 수정인지, 진짜 오타 수정인지 지켜볼 대목이죠."
- 이미 나온 패턴이면 "아까 그 패턴 또 나옵니다"처럼 짧게만 받아.
- ask는 시청자가 에이전트 입력창에 그대로 붙여 넣을 한국어 질문 한두 문장. 장면의 파일 이름이나 숫자를 넣어 구체적으로, 반말 지시형으로. 확인할 거리는 해설이 아니라 ask에 담아.`;
const TEACH_SHORT = `

[배움: 짧게]
- 해설위원은 반응과 평가만 해. 비유는 필요하면 한 구절만. 처음 나오는 용어는 괄호 안에 몇 단어로 풀어.
- 이미 설명한 내용은 다시 설명하지 마.
- ask는 에이전트에게 붙여 넣을 한국어 질문 한 문장. 장면의 파일 이름이나 숫자를 넣어 반말 지시형으로.`;
const MILD = `\n\n[말투: 순한 맛] 시니컬한 농담과 놀림은 빼고, 차분하고 다정하게 응원하는 톤으로 말해. 사실 원칙은 그대로 지켜.`;
const PERSONA_EN = `You are the commentary team broadcasting AI coding agents at work. Coding itself is the sport. Agents are players, the user's task is the objective, and file edits are plays. Your audience knows nothing about code. Use plain language. Always answer in English, even when the supplied record is in another language.

[Voices: an English-language sports broadcast booth]
- Caster (play-by-play): calls the action as it happens, in the present tense, in short punchy sentences, with real energy — exclamation is normal for a failure, a twist or a comeback. Sets up the moment, then lands it ("Here's the test run... and it's two failures!"). Raises the energy for big moments with a rising call ("And there it is!", "Oh, that's a big one!"), stays brisk and light on routine plays. Never more than two sentences.
- Analyst (color commentator): the former-pro voice next to the caster. Reacts to the play and judges it: why it matters, what to watch next, backed by at most one recorded number. Dry, understated wit is welcome ("Bold choice. Not sure the tests agree."). Talks to the viewer like a friend at the game, never like a lecturer: no explaining principles, no "you should check…" advice. The on-screen lesson card does the teaching.
- Never sound like a report or a manual ("It is important to…", "It is necessary to verify…", "Users should…"). Don't repeat numbers or file names the caster just said.
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

[Learning: the lesson card explains, the booth calls the game]
- The supplied lesson is shown on screen as a separate card. Use it only as the factual guide; do not explain it in the commentary.
- If an analogy makes the moment land, use one short phrase ("rewriting the answer key, basically"). Never unpack it or explain principles.
- A suspicious shortcut may have a legitimate reason. Do not declare guilt; voice the doubt the way a commentator would ("Typo fix or answer-key rewrite? That's the one to watch.").
- If the pattern already came up, just nod to it briefly ("There's that pattern again.").
- ask must be one or two English sentences the viewer can paste directly into the agent. Use direct instructions and relevant recorded file names or numbers. Put anything to verify in ask, not in the commentary.`;
const TEACH_SHORT_EN = `

[Learning: short]
- The analyst only reacts and judges; at most one short analogy phrase. Briefly explain unfamiliar terms in parentheses.
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
      ? '{"caster": "short caster call (1–2 sentences)", "line": "analyst reaction and judgment (1–2 sentences)"}'
      : '{"caster": "short caster call (1–2 sentences)", "line": "analyst reaction and judgment (1–2 sentences, no teaching)", "ask": "question to paste directly into the agent (1–2 sentences)"}';
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
    ? '{"caster": "캐스터의 짧은 외침(1~2문장)", "line": "해설위원의 반응과 평가(1~2문장)"}'
    : '{"caster": "캐스터의 짧은 외침(1~2문장)", "line": "해설위원의 반응과 평가(1~2문장, 가르치지 말 것)", "ask": "시청자가 에이전트에게 그대로 붙여 넣을 질문(1~2문장)"}';
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

// Explaining one file of the project, for the file map. Only the path, its neighbours and the start of its text.
export const filePersona = () => (language() === 'en'
  ? 'You explain one file of a software project to someone who cannot read code. Use plain words; explain any technical term briefly in parentheses. Say only what the path, the neighbouring names and the file\'s text show; when unsure, say it "looks like" rather than stating it. Always answer in English.'
  : '너는 코드를 모르는 사람에게 소프트웨어 프로젝트의 파일 하나를 설명해 주는 안내자야. 쉬운 말로 말하고, 전문 용어는 괄호 안에 짧게 풀어. 경로, 주변 파일 이름, 파일 내용에서 보이는 것만 말하고, 확실하지 않으면 "~로 보여요"처럼 말해. 해요체로 답해.');
export function filePrompt({ project, path, neighbours, top, head, binary }) {
  if (language() === 'en') return `Project: ${project}
File: ${path}
Other files in the same folder: ${neighbours.join(', ') || 'none'}
Top-level folders and files: ${top.join(', ') || 'none'}
Start of the file${binary ? ': (not a text file, no contents)' : ` (up to 200 lines):\n${head}`}

Answer with one JSON object only, with only these keys: {"part": "the part of the project this file belongs to, in a word or two (screen, data, tests, settings, docs, build, or similar)", "text": "what this file does for the project, in 3–4 sentences: what it is for and how it connects to other parts"}`;
  return `프로젝트: ${project}
파일: ${path}
같은 폴더의 다른 파일: ${neighbours.join(', ') || '없음'}
프로젝트 맨 위의 폴더와 파일: ${top.join(', ') || '없음'}
파일 내용 앞부분${binary ? ': (글자가 아닌 파일이라 내용 없음)' : `(최대 200줄):\n${head}`}

답은 JSON 객체 하나로만 써. 키는 이것뿐이야: {"part": "이 파일이 속한 프로젝트의 부분을 한두 단어로(화면, 데이터, 테스트, 설정, 문서, 빌드 등)", "text": "이 파일이 프로젝트에서 맡은 역할을 3~4문장으로. 무엇을 하는 파일인지, 다른 부분과 어떻게 이어지는지."}`;
}

// Sorting a project's files into the fixed areas of the role map. Only paths and top-level names are sent.
export const ROLES = ['screen', 'logic', 'shared', 'data', 'storage', 'network', 'assets', 'tooling', 'tests', 'docs', 'other'];
const ROLE_GUIDE = {
  en: 'screen: what users see and press (UI, pages, styles); logic: the core rules and calculations; shared: small helpers many parts use; data: fixed material the program reads (item lists, tables, content); storage: databases and saved records; network: talking to servers and outside services (APIs, AI calls); assets: images, sounds, fonts; tooling: setting up, building and running (config, scripts, CI); tests: checks that it works; docs: written explanations; other: none of these fit',
  ko: 'screen: 사용자가 보고 누르는 부분(화면, 페이지, 스타일); logic: 핵심 규칙과 계산; shared: 여러 곳에서 같이 쓰는 작은 도구; data: 프로그램이 꺼내 쓰는 고정된 재료(아이템 목록, 표, 콘텐츠); storage: 데이터베이스와 저장 기록; network: 서버·외부 서비스와 주고받는 통로(API, AI 호출); assets: 이미지·소리·글꼴; tooling: 준비·조립·실행(설정, 스크립트, CI); tests: 잘 되는지 시험; docs: 설명 문서; other: 어디에도 맞지 않음',
};
export const rolePersona = () => (language() === 'en'
  ? 'You sort the files of a software project into plain areas for someone who cannot read code. Judge each file by its path and the names around it; put a file in "other" rather than guessing. Always answer in English.'
  : '너는 코드를 모르는 사람을 위해 소프트웨어 프로젝트의 파일을 쉬운 구역으로 나누는 안내자야. 파일마다 경로와 주변 이름으로 판단하고, 애매하면 억지로 넣지 말고 "other"에 넣어. 설명은 해요체로 써.');
export function rolePrompt({ project, top, paths }) {
  const list = paths.map(p => `- ${p}`).join('\n');
  if (language() === 'en') return `Project: ${project}
Top-level folders and files: ${top.join(', ') || 'none'}
Areas (use these ids only): ${ROLE_GUIDE.en}
Files:
${list}

Answer with one JSON object only, with only these keys: {"files": {"<each file path exactly as listed>": "<area id>"}, "areas": {"<area id used>": "what this area does in this project, one short sentence"}}`;
  return `프로젝트: ${project}
프로젝트 맨 위의 폴더와 파일: ${top.join(', ') || '없음'}
구역(이 id만 써): ${ROLE_GUIDE.ko}
파일:
${list}

답은 JSON 객체 하나로만 써. 키는 이것뿐이야: {"files": {"<위 목록의 파일 경로 그대로>": "<구역 id>"}, "areas": {"<쓴 구역 id>": "이 프로젝트에서 이 구역이 하는 일을 짧은 한 문장으로"}}`;
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

// A watched session rebuilds its Match object when its file changes; the session key (`id`) stays the same.
const idOf = match => match.id ?? match;

export class Booth {
  // conf: the resolved provider (providers.resolve), or null. max: calls per match, null = unlimited.
  constructor(conf = null, { max = 20, tone = 'spicy', includeSayings = true, teach = 'full' } = {}) {
    Object.assign(this, { conf, max, tone, includeSayings, teach });
    this.paused = false; this.running = 0; this.queue = []; this.calls = new Map(); this.spentUsd = 0; this.tokens = 0; this.lastError = null; this.onError = null;    this.skipped = new Map();
  }
  // Commentary starts from the moment the mic connects: of the moments already on record, only the newest gets a
  // line; the older ones keep their fixed lines.
  connect(match) { this.skipped.set(idOf(match), new Set(match.moments.slice(0, -1).map(m => m.key))); }
  get label() { return describe(this.conf); }
  limited(match) { return this.max != null && (this.calls.get(idOf(match)) ?? 0) + this.queue.filter(q => idOf(q.match) === idOf(match)).length >= this.max; }
  // Queue every key moment since the mic connected that has no commentary yet, newest first and ahead of older
  // queued moments, so the line on screen is the one being written.
  cover(match, onDone) {
    if (!this.conf) return;
    if (!this.skipped.has(idOf(match))) this.connect(match);
    const skipped = this.skipped.get(idOf(match));
    let front = 0;
    for (const m of [...match.moments].reverse()) {
      if (skipped.has(m.key) || match.comments.has(m.key) || this.queue.some(q => idOf(q.match) === idOf(match) && q.m.key === m.key)) continue;
      if (this.limited(match)) break;
      this.queue.splice(front++, 0, { match, m, onDone });
      match.setComment(m.key, { loading: true });
    }
    this.pump();
  }
  get busy() { return this.running > 0; }
  // Up to two lines are written at once; a local model shares this computer, so it writes one at a time.
  pump() {
    const parallel = this.conf?.via === 'local' ? 1 : 2;
    while (!this.paused && this.running < parallel && this.queue.length) this.write(this.queue.shift());
  }
  async write({ match, m, onDone }) {
    this.running++;
    this.calls.set(idOf(match), (this.calls.get(idOf(match)) ?? 0) + 1);
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
    this.running--;
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
