// Player names when the agent records none. Style (settings general.nameStyle):
//   'pun'   wordplay on well-known AI people (the default; used anywhere public: app, README, demo, promo)
//   'meme'  the real names, as parody — opt-in only; commentary is told never to bring up the real person
//   'plain' everyday names
// For 'pun' and 'meme' the name comes from the model's company (Claude → Anthropic people, GPT → OpenAI, …);
// a model of an unknown company picks from people not tied to one lab.
import { language } from '../i18n/index.mjs';
export const NAMES = '찰리 루나 모모 하루 나나 로이 레오 리오 유나 소라 미오 노아 루비 보리 토리 코코 라라 도도 마루 다온 아리 여름 가을 겨울 봄 하늘 바다 별 달 해 솔 산 강 빛 새롬 가람 나래 다솜 라온 이든 해솔 초롱'.split(' ');

// [real name, pun] per company.
const PEOPLE = {
  anthropic: [['다리오 아모데이', '다리오 아무데이'], ['다니엘라 아모데이', '다니엘라 아무데이'], ['잭 클라크', '잭 클락션'], ['크리스 올라', '크리스 올라올라'],
    ['마이크 크리거', '마이크 크리스피'], ['재러드 캐플런', '재러드 캐플런B'], ['톰 브라운', '톰 브라우니'], ['얀 레이케', '얀 레이크'], ['아만다 애스켈', '아만다 애스크'], ['샘 매캔들리시', '샘 매캔디']],
  openai: [['샘 알트만', '샘 알트탭'], ['그렉 브록먼', '그렉 브로콜리먼'], ['마크 첸', '마크 첸치'], ['야쿱 파초츠키', '야쿱 파초코칩'],
    ['브래드 라이트캡', '브래드 라이트캡슐'], ['케빈 와일', '케빈 와이파이'], ['피지 시모', '피지 시모네'], ['닉 털리', '닉 털털'], ['노엄 브라운', '노엄 브라우니'], ['사라 프라이어', '사라 프라이팬']],
  google: [['데미스 허사비스', '데미스 하사비스킷'], ['순다르 피차이', '순다르 피자이'], ['제프 딘', '제프 딘딘'], ['노암 셰이저', '노암 셰이크'],
    ['오리올 비냘스', '오리올 비닐랩'], ['코레이 카부쿠올루', '코레이 카부쿠키'], ['셰인 레그', '셰인 레고'], ['데이비드 실버', '데이비드 실버타운'], ['조시 우드워드', '조시 우드워드락'], ['세르게이 브린', '세르게이 브린치']],
  xai: [['일론 머스크', '일롱 머스크멜론'], ['이고르 바부시킨', '이고르 바부시킨쵸'], ['지미 바', '지미 바바'], ['그렉 양', '그렉 양념'], ['광동 장', '광동 짱']],
  meta: [['마크 저커버그', '마크 저커피'], ['얀 르쿤', '얀 르쿵'], ['알렉산더 왕', '알렉산더 왕만두'], ['냇 프리드먼', '냇 프리드라이스'], ['조엘 피노', '조엘 피노키오'], ['셩지아 자오', '셩지아 자오자오']],
  mistral: [['아서 멘시', '아서 멘션'], ['티모테 라크루아', '티모테 라크로와상'], ['기욤 랑플', '기욤 랑플러그']],
  deepseek: [['량원펑', '량원펑펑']],
  alibaba: [['린 쥔양', '린 쥔양갱'], ['에디 우', '에디 우유']],
  moonshot: [['양즈린', '양즈린스']],
  common: [['제프리 힌턴', '제프리 힌트언'], ['요슈아 벤지오', '요슈아 벤치오'], ['페이페이 리', '페이페이 리셋'], ['앤드루 응', '앤드루 응답'],
    ['앤드레이 카파시', '앤드레이 카파시티'], ['일리야 수츠케버', '일리야 수츠케이크'], ['무스타파 술레이만', '무스타파 술술레이만'], ['젠슨 황', '젠슨 황금'],
    ['리사 수', '리사 수학'], ['사티아 나델라', '사티아 나델라웨어'], ['리처드 서튼', '리처드 서툰'], ['스튜어트 러셀', '스튜어트 러시아워'],
    ['이안 굿펠로우', '이안 굿필로우'], ['아이단 고메즈', '아이단 고메즈라'], ['클레망 들랑그', '클레망 들랑그랑'], ['아라빈드 스리니바스', '아라빈드 스리닝'],
    ['마이클 트루엘', '마이클 트루엘븐'], ['리드 호프먼', '리드 호프먼트'], ['미라 무라티', '미라 무라티라미수'], ['존 슐먼', '존 슐루프']],
};
const PEOPLE_EN = {
  anthropic: [['Dario Amodei', 'Dario Anyday'], ['Daniela Amodei', 'Daniela Anyday'], ['Jack Clark', 'Jack Clack'], ['Chris Olah', 'Chris Olala'],
    ['Mike Krieger', 'Mike Krispy'], ['Jared Kaplan', 'Jared Kaplan-B'], ['Tom Brown', 'Tom Brownie'], ['Jan Leike', 'Jan Lake'], ['Amanda Askell', 'Amanda Ask'], ['Sam McCandlish', 'Sam McCandy']],
  openai: [['Sam Altman', 'Sam Alt-Tab'], ['Greg Brockman', 'Greg Broccoliman'], ['Mark Chen', 'Mark Chen-Chen'], ['Jakub Pachocki', 'Jakub Pachocolate'],
    ['Brad Lightcap', 'Brad Lightcapsule'], ['Kevin Weil', 'Kevin Wi-Fi'], ['Fidji Simo', 'Fidji Simonade'], ['Nick Turley', 'Nick Turtley'], ['Noam Brown', 'Noam Brownie'], ['Sarah Friar', 'Sarah Fryer']],
  google: [['Demis Hassabis', 'Demis Hassabiscuit'], ['Sundar Pichai', 'Sundar Pizzai'], ['Jeff Dean', 'Jeff Dean-Dean'], ['Noam Shazeer', 'Noam Shaker'],
    ['Oriol Vinyals', 'Oriol Vinyl'], ['Koray Kavukcuoglu', 'Koray Kavucookie'], ['Shane Legg', 'Shane Lego'], ['David Silver', 'David Silverware'], ['Josh Woodward', 'Josh Woodwardrobe'], ['Sergey Brin', 'Sergey Brine']],
  xai: [['Elon Musk', 'Elon Muskmelon'], ['Igor Babuschkin', 'Igor Babushka'], ['Jimmy Ba', 'Jimmy Baba'], ['Greg Yang', 'Greg Yang-Yang'], ['Guodong Zhang', 'Guodong Zang']],
  meta: [['Mark Zuckerberg', 'Mark Zuckerburger'], ['Yann LeCun', 'Yann LeCoon'], ['Alexandr Wang', 'Alexandr Wonton'], ['Nat Friedman', 'Nat Friedrice'], ['Joelle Pineau', 'Joelle Pinocchio'], ['Shengjia Zhao', 'Shengjia Zhaozhao']],
  mistral: [['Arthur Mensch', 'Arthur Mention'], ['Timothée Lacroix', 'Timothée Lacroissant'], ['Guillaume Lample', 'Guillaume Lampshade']],
  deepseek: [['Liang Wenfeng', 'Liang Wenfun']],
  alibaba: [['Lin Junyang', 'Lin Junyang-Yang'], ['Eddie Wu', 'Eddie Moo']],
  moonshot: [['Yang Zhilin', 'Yang Zhilinks']],
  common: [['Geoffrey Hinton', 'Geoffrey Hintern'], ['Yoshua Bengio', 'Yoshua Bench-io'], ['Fei-Fei Li', 'Fei-Fei Reset'], ['Andrew Ng', 'Andrew Nginx'],
    ['Andrej Karpathy', 'Andrej Carpool'], ['Ilya Sutskever', 'Ilya Sutskeverything'], ['Mustafa Suleyman', 'Mustafa Suleymanly'], ['Jensen Huang', 'Jensen Hwang-Gold'],
    ['Lisa Su', 'Lisa Sue-shi'], ['Satya Nadella', 'Satya Nadellama'], ['Richard Sutton', 'Richard Sutton-Button'], ['Stuart Russell', 'Stuart Russel-Sprout'],
    ['Ian Goodfellow', 'Ian Goodpillow'], ['Aidan Gomez', 'Aidan Gomezz'], ['Clement Delangue', 'Clem Delounge'], ['Aravind Srinivas', 'Aravind Srinivasta'],
    ['Michael Truell', 'Michael Trueloop'], ['Reid Hoffman', 'Reid Hoffmansion'], ['Mira Murati', 'Mira Muratea'], ['John Schulman', 'John Schoolman']],
};
const NAMES_EN = 'Charlie Luna Momo Haru Nana Roy Leo Rio Yuna Sora Mio Noah Ruby Bori Tori Coco Lara Dodo Maru Daon Ari Summer Autumn Winter Spring Sky Ocean Star Moon Sun Sol San River Light Saerom Garam Narae Dasom Raon Eden Haesol Chorong'.split(' ');
const COMPANY = [
  [/claude|opus|sonnet|haiku|fable/i, 'anthropic'], [/gpt|codex|chatgpt|(^|\/)o\d/i, 'openai'], [/gemini|gemma/i, 'google'],
  [/grok/i, 'xai'], [/llama/i, 'meta'], [/mistral|codestral|devstral|magistral|ministral/i, 'mistral'],
  [/deepseek/i, 'deepseek'], [/qwen/i, 'alibaba'], [/kimi|moonshot/i, 'moonshot'],
];
export const companyOf = model => COMPANY.find(([re]) => re.test(String(model ?? '')))?.[1] ?? 'common';

export const NAME_STYLES = ['pun', 'meme', 'plain'];
let style = 'pun';
export const setNameStyle = s => { style = NAME_STYLES.includes(s) ? s : 'pun'; };
export const nameStyle = () => style;
export const nameList = (model, s = style) => (s === 'plain' ? (language() === 'en' ? NAMES_EN : NAMES) : (language() === 'en' ? PEOPLE_EN : PEOPLE)[companyOf(model)].map(([real, pun]) => (s === 'meme' ? real : pun)));

export function sessionName(id, used = new Set(), model = '') {
  const list = nameList(model);
  let hash = 2166136261;
  for (const ch of String(id ?? '')) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619) >>> 0;
  for (let i = 0; ; i++) {
    const name = list[(hash + i) % list.length] + (i >= list.length ? ` ${Math.floor(i / list.length) + 1}` : '');
    if (!used.has(name)) return name;
  }
}
