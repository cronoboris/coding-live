// Commentary providers. The user picks a provider (Anthropic, OpenAI, Google, a local Ollama, or any
// OpenAI-compatible server), then how to reach it: the agent CLI they are already logged in to, an API key,
// or a local server. Only key moments are ever sent; the regular ticker never touches a model.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t as msg } from './i18n/index.mjs';

// First line of every prompt sent through a CLI that keeps transcripts (Gemini CLI, older Codex), so the hub
// can skip those sessions instead of showing a commentary call as a new match.
export const MARK = '[coding-live 해설 요청]';

const apiProvider = (label, defaultUrl, env, defaultModel) => ({
  label, methods: ['api'], defaultUrl, envKeys: [env], defaultModel,
  models: [{ id: defaultModel, label: defaultModel, get note() { return msg('provider.recommended'); } }],
});
export const PROVIDERS = {
  'opencode-go': apiProvider('OpenCode Go', 'https://opencode.ai/zen/go/v1', 'OPENCODE_API_KEY', 'glm-5.2'),
  openrouter: apiProvider('OpenRouter', 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', 'openrouter/auto'),
  deepseek: apiProvider('DeepSeek', 'https://api.deepseek.com', 'DEEPSEEK_API_KEY', 'deepseek-v4-pro'),
  xai: apiProvider('xAI', 'https://api.x.ai/v1', 'XAI_API_KEY', 'grok-4.5'),
  anthropic: {
    label: 'Anthropic', sub: 'Claude', methods: ['cli', 'api'], cli: { bin: 'claude', label: 'Claude Code' },
    envKeys: ['ANTHROPIC_API_KEY'], keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…',
    models: [
      { id: 'claude-haiku-5-5', alias: 'haiku', label: 'Haiku 5.5', get note() { return msg('provider.fastCheap'); } },
      { id: 'claude-sonnet-5-5', alias: 'sonnet', label: 'Sonnet 5.5', get note() { return msg('provider.smarter'); } },
      { id: 'claude-opus-5-5', alias: 'opus', label: 'Opus 5.5', get note() { return msg('provider.strongest'); } },
      { id: 'claude-fable-5-1', label: 'Fable 5.1' },
    ],
    defaultModel: 'claude-haiku-5-5',
  },
  openai: {
    label: 'OpenAI', sub: 'GPT · Codex', methods: ['cli', 'api'], cli: { bin: 'codex', label: 'Codex' },
    envKeys: ['OPENAI_API_KEY'], keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…',
    models: [
      { id: 'gpt-5-mini', label: 'GPT-5 mini', get note() { return msg('provider.fastCheap'); } },
      { id: 'gpt-5-nano', label: 'GPT-5 nano', get note() { return msg('provider.cheapest'); } },
      { id: 'gpt-5', label: 'GPT-5' },
    ],
    defaultModel: 'gpt-5-mini', cliDefaultModel: '', // Codex picks its own model unless told otherwise
  },
  google: {
    label: 'Google', sub: 'Gemini', methods: ['cli', 'api'], cli: { bin: 'gemini', label: 'Gemini CLI' },
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', get note() { return msg('provider.freeTier'); } },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', get note() { return msg('provider.fastest'); } },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
    defaultModel: 'gemini-2.5-flash',
  },
  cursor: {
    label: 'Cursor', sub: 'Cursor CLI', methods: ['cli'],
    cli: { bin: 'agent', label: 'Cursor CLI', get login() { return msg('provider.cursorLogin'); } },
    envKeys: [], models: [], defaultModel: '', cliDefaultModel: '', // no documented model list: the CLI's own default unless one is typed
    setupUrl: 'https://cursor.com/docs/cli/installation',
  },
  copilot: {
    label: 'GitHub Copilot', sub: 'Copilot CLI', methods: ['cli'],
    cli: { bin: 'copilot', label: 'Copilot CLI', get login() { return msg('provider.copilotLogin'); } },
    envKeys: [], models: [{ id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', get note() { return msg('provider.light'); } }], defaultModel: 'claude-haiku-4.5',
    setupUrl: 'https://docs.github.com/en/copilot/get-started/cli-quickstart',
  },
  qwen: {
    label: 'Qwen', sub: 'Qwen Code', methods: ['cli'],
    cli: { bin: 'qwen', label: 'Qwen Code', get login() { return msg('provider.qwenLogin'); } },
    envKeys: [], models: [{ id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus', get note() { return msg('provider.recommended'); } }], defaultModel: 'qwen3-coder-plus',
    setupUrl: 'https://qwenlm.github.io/qwen-code-docs/en/users/overview/',
  },
  opencode: {
    label: 'opencode', sub: 'opencode CLI', methods: ['cli'],
    cli: { bin: 'opencode', label: 'opencode', get login() { return msg('provider.opencodeLogin'); } },
    envKeys: [], models: [], defaultModel: '', cliDefaultModel: '', // model ids are provider/model; the CLI's own default unless one is typed
    setupUrl: 'https://opencode.ai/docs/',
  },
  amp: {
    label: 'Amp', sub: 'Amp CLI', methods: ['cli'],
    cli: { bin: 'amp', label: 'Amp', get login() { return msg('provider.ampLogin'); } },
    envKeys: [], models: [], defaultModel: '', cliDefaultModel: '', // execute mode has no model flag
    setupUrl: 'https://ampcode.com/manual',
  },
  grok: {
    label: 'Grok', sub: 'Grok CLI', methods: ['cli'],
    cli: { bin: 'grok', label: 'Grok CLI', get login() { return msg('provider.grokLogin'); } },
    envKeys: [], models: [], defaultModel: '', cliDefaultModel: '',
    setupUrl: 'https://docs.x.ai/build/cli/headless-scripting',
  },
  ollama: {
    label: 'Ollama', get sub() { return msg('provider.localFree'); }, methods: ['local'], envKeys: [], models: [], defaultModel: '',
    defaultUrl: 'http://127.0.0.1:11434', setupUrl: 'https://ollama.com/download',
  },
  compatible: {
    get label() { return msg('provider.compatible'); }, get sub() { return msg('provider.compatibleSub'); }, methods: ['api'], envKeys: [], get keyHint() { return msg('provider.optionalKey'); },
    models: [], defaultModel: '', defaultUrl: '',
  },
};
// The order "auto" tries: logged-in CLIs first (no key, no setup), then a local model, then keys.
export const ORDER = ['anthropic', 'google', 'openai', 'cursor', 'copilot', 'qwen', 'opencode', 'amp', 'grok', 'ollama', 'compatible', 'opencode-go', 'openrouter', 'deepseek', 'xai'];
export const METHOD_LABEL = Object.defineProperties({}, Object.fromEntries(['cli', 'api', 'local'].map(via => [via, { enumerable: true, get: () => msg(`provider.${via}`) }])));
// The old single "backend" setting, and the --mic flag, name a CLI.
export const LEGACY = { claude: 'anthropic', gemini: 'google', codex: 'openai' };

const modelLabel = (p, id) => PROVIDERS[p]?.models.find(m => m.id === id)?.label ?? id;
export function describe(conf) {
  if (!conf) return null;
  const p = PROVIDERS[conf.provider];
  const how = conf.via === 'cli' ? msg('provider.loginMethod', { label: p.cli.label }) : conf.via === 'local' ? msg('provider.local') : conf.provider === 'compatible' ? hostOf(conf.url) : msg('provider.api');
  return `${p.label} · ${conf.model ? modelLabel(conf.provider, conf.model) : msg('provider.defaultModel')} (${how})`;
}
const hostOf = u => { try { return new URL(u).host; } catch { return msg('provider.server'); } };

// ---- processes ---------------------------------------------------------------------------------
// Child processes must not look like they run inside another agent session.
const STRIP_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_REMOTE_SESSION_ID', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_CHILD_SESSION'];
// Windows: npm installs CLIs as .cmd shims, which only cmd.exe can run. Quote each argument the way
// cross-spawn does (no argument here ever contains a newline: prompts go through stdin, personas through a file).
const META = /([()\][%!^"`<>&|;, *?])/g;
const winArg = a => `"${String(a).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`.replace(META, '^$1');
export const where = bin => new Promise(r => execFile(process.platform === 'win32' ? 'where' : 'which', [bin], (err, out) => r(err ? null : String(out).split(/\r?\n/).find(Boolean)?.trim() ?? null)));

export async function run(bin, args, input, { timeout = 120_000, env: extra = {} } = {}) {
  const env = { ...process.env, ...extra };
  for (const k of STRIP_ENV) delete env[k];
  let cmd = bin, argv = args;
  const opts = { env, maxBuffer: 8 << 20, timeout };
  if (process.platform === 'win32') {
    const found = await where(bin);
    if (!found) throw Object.assign(new Error(`${bin} not found`), { code: 'ENOENT' });
    if (/\.(cmd|bat)$/i.test(found)) { cmd = process.env.ComSpec || 'cmd.exe'; argv = ['/d', '/s', '/c', `"${[winArg(found), ...args.map(winArg)].join(' ')}"`]; opts.windowsVerbatimArguments = true; }
    else cmd = found;
  }
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, argv, opts, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve(stdout)));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

// The persona goes in as the system prompt where the CLI allows it: under an agent's own system prompt a
// small model deliberates for a minute over a two-line reply. It is passed as a file so no argument has newlines.
const personaFile = async system => {
  const f = join(tmpdir(), `coding-live-persona-${createHash('sha1').update(system).digest('hex').slice(0, 10)}.txt`);
  if (!existsSync(f)) await writeFile(f, system);
  return f;
};

// ---- HTTP ----------------------------------------------------------------------------------------
async function request(url, { method = 'POST', headers = {}, body, timeout = 90_000 } = {}) {
  let res;
  try {
    res = await fetch(url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    const code = e?.cause?.code ?? e?.name;
    throw Object.assign(new Error(e?.name === 'TimeoutError' ? 'timed out' : `connection failed: ${code ?? e?.message}`), { code, killed: e?.name === 'TimeoutError', offline: e?.name !== 'TimeoutError' });
  }
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`), { status: res.status, stdout: text.slice(0, 2000) });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('unexpected response'), { stdout: text.slice(0, 2000) }); }
}
const trimUrl = u => String(u ?? '').trim().replace(/\/+$/, '');

// ---- one call per provider and method ----------------------------------------------------------
const CALLS = {
  async 'anthropic:cli'(c, prompt, system) {
    const alias = PROVIDERS.anthropic.models.find(m => m.id === c.model)?.alias ?? c.model ?? 'haiku';
    // The user's settings, MCP servers and skills are not loaded: a commentary line needs none of them, and loading
    // them multiplies the input (and cost) of every call. Extended thinking is off: even at low effort the model
    // spent about 8,000 thinking tokens and close to a minute on a two-line reply.
    const raw = await run('claude', ['-p', '--model', alias || 'haiku', '--effort', 'low', '--system-prompt-file', await personaFile(system), '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json'], prompt, { env: { MAX_THINKING_TOKENS: '0' } });
    let out; try { out = JSON.parse(raw); } catch { throw Object.assign(new Error('unexpected output'), { stdout: raw }); }
    if (out.is_error || out.subtype?.startsWith?.('error')) throw Object.assign(new Error(String(out.result ?? out.subtype ?? 'error')), { stdout: raw });
    return { text: out.result ?? '', costUsd: out.total_cost_usd ?? 0 };
  },
  async 'anthropic:api'(c, prompt, system) {
    const j = await request(`${trimUrl(c.url) || 'https://api.anthropic.com'}/v1/messages`, {
      headers: { 'x-api-key': c.key, 'anthropic-version': '2023-06-01' },
      body: { model: c.model || PROVIDERS.anthropic.defaultModel, max_tokens: 1024, system, messages: [{ role: 'user', content: prompt }] },
    });
    return { text: (j.content ?? []).filter(b => b.type === 'text').map(b => b.text).join(''), tokens: (j.usage?.input_tokens ?? 0) + (j.usage?.output_tokens ?? 0) };
  },
  async 'openai:cli'(c, prompt, system) {
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', ...(c.model ? ['-m', c.model] : []), '-'];
    const input = `${MARK}\n${system}\n\n${prompt}`;
    try { return { text: await run('codex', args, input) }; }
    catch (e) { // Codex before --ephemeral: run without it (the marker keeps the session out of the match list)
      if (!/unexpected argument '--ephemeral'|unrecognized.*ephemeral/i.test(`${e.stderr ?? ''}${e.message}`)) throw e;
      return { text: await run('codex', args.filter(a => a !== '--ephemeral'), input) };
    }
  },
  async 'openai:api'(c, prompt, system) {
    const model = c.model || PROVIDERS.openai.defaultModel;
    const j = await request(`${trimUrl(c.url) || 'https://api.openai.com/v1'}/chat/completions`, {
      headers: { authorization: `Bearer ${c.key}` },
      // Reasoning models (GPT-5 family, o-series) think at the lowest effort they all accept.
      body: { model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], response_format: { type: 'json_object' }, ...(/^(gpt-5|o\d)/.test(model) ? { reasoning_effort: 'low' } : {}) },
    });
    return { text: j.choices?.[0]?.message?.content ?? '', tokens: j.usage?.total_tokens ?? 0 };
  },
  async 'google:cli'(c, prompt, system) {
    return { text: await run('gemini', [...(c.model ? ['-m', c.model] : []), '-p', '입력으로 받은 지시를 따라 답해.'], `${MARK}\n${system}\n\n${prompt}`) };
  },
  // `agent -p` reads the prompt from stdin; --output-format json returns one object whose `result` is the text.
  async 'cursor:cli'(c, prompt, system) {
    const raw = await hooks.run('agent', ['-p', '--output-format', 'json', ...(c.model ? ['--model', c.model] : [])], `${MARK}\n${system}\n\n${prompt}`);
    let out; try { out = JSON.parse(raw); } catch { throw Object.assign(new Error('unexpected output'), { stdout: String(raw).slice(0, 2000) }); }
    if (out.is_error || (out.subtype && out.subtype !== 'success')) throw Object.assign(new Error(String(out.result ?? out.subtype ?? 'error')), { stdout: String(raw).slice(0, 2000) });
    return { text: out.result ?? '' };
  },
  // `copilot -s` prints only the answer; a piped prompt is documented as the non-interactive input (-p is not used).
  async 'copilot:cli'(c, prompt, system) {
    return { text: await hooks.run('copilot', ['-s', '--no-ask-user', ...(c.model ? ['--model', c.model] : [])], `${MARK}\n${system}\n\n${prompt}`) };
  },
  // `qwen -p` reads stdin and appends the prompt, as documented; text output is the final answer only.
  async 'qwen:cli'(c, prompt, system) {
    return { text: await hooks.run('qwen', [...(c.model ? ['-m', c.model] : []), '-p', '입력으로 받은 지시를 따라 답해.'], `${MARK}\n${system}\n\n${prompt}`) };
  },
  // `opencode run [message]` is the documented non-interactive mode; the full request travels as an attached file (-f).
  async 'opencode:cli'(c, prompt, system) {
    const file = await personaFile(`${MARK}\n${system}\n\n${prompt}`);
    return { text: await hooks.run('opencode', ['run', ...(c.model ? ['-m', c.model] : []), '-f', file, '첨부한 파일의 지시를 따라 답해.']) };
  },
  // `amp -x` (execute mode) reads a piped prompt and prints only the agent's last message; it has no model flag.
  async 'amp:cli'(c, prompt, system) {
    return { text: await hooks.run('amp', ['-x'], `${MARK}\n${system}\n\n${prompt}`) };
  },
  // `grok -p` is xAI's documented headless mode; plain output is the answer text.
  async 'grok:cli'(c, prompt, system) {
    const text = `${MARK}\n${system}\n\n${prompt}`;
    return { text: await hooks.run('grok', ['--no-auto-update', ...(c.model ? ['-m', c.model] : []), '--output-format', 'plain', '-p', process.platform === 'win32' ? text.replace(/\r?\n/g, ' ') : text]) };
  },
  async 'google:api'(c, prompt, system) {
    const model = c.model || PROVIDERS.google.defaultModel;
    const j = await request(`${trimUrl(c.url) || 'https://generativelanguage.googleapis.com/v1beta'}/models/${encodeURIComponent(model)}:generateContent`, {
      headers: { 'x-goog-api-key': c.key },
      body: { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4096 } },
    });
    if (!j.candidates?.length && j.promptFeedback?.blockReason) throw new Error(`blocked: ${j.promptFeedback.blockReason}`);
    return { text: (j.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join(''), tokens: j.usageMetadata?.totalTokenCount ?? 0 };
  },
  async 'ollama:local'(c, prompt, system) {
    if (!c.model) throw Object.assign(new Error('no model'), { code: 'nomodel' });
    const j = await request(`${trimUrl(c.url) || PROVIDERS.ollama.defaultUrl}/api/chat`, {
      body: { model: c.model, stream: false, format: 'json', messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }, timeout: 180_000,
    });
    return { text: j.message?.content ?? '', tokens: (j.prompt_eval_count ?? 0) + (j.eval_count ?? 0) };
  },
  async 'compatible:api'(c, prompt, system) {
    if (!c.url) throw Object.assign(new Error('no url'), { code: 'nourl' });
    if (!c.model) throw Object.assign(new Error('no model'), { code: 'nomodel' });
    // OpenRouter, chosen directly or as a compatible server: two short lines need no deep thinking, so reasoning
    // models think at the lowest effort and the thinking text is not sent back. Other servers get no extra fields.
    const openrouter = c.provider === 'openrouter' || /^https?:\/\/([^/]*\.)?openrouter\.ai(\/|$)/i.test(trimUrl(c.url));
    const j = await request(`${trimUrl(c.url)}/chat/completions`, {
      headers: { ...(c.key ? { authorization: `Bearer ${c.key}` } : {}), ...(openrouter ? { 'HTTP-Referer': 'https://github.com/cronoboris/coding-live', 'X-OpenRouter-Title': 'coding live' } : {}) },
      body: { model: c.model, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], ...(openrouter ? { reasoning: { effort: 'low', exclude: true } } : {}) }, timeout: 180_000,
    });
    return { text: j.choices?.[0]?.message?.content ?? '', tokens: j.usage?.total_tokens ?? 0 };
  },
};

// Test seam: CLI spawns and PATH lookups go through these, so tests can stand in for installed agents.
export const hooks = { run: (...a) => run(...a), where: (...a) => where(...a) };

/** Ask the configured provider. Resolves to { text, costUsd?, tokens? }. */
export function ask(conf, prompt, system) {
  if (['opencode-go', 'openrouter', 'deepseek', 'xai'].includes(conf?.provider)) {
    const p = PROVIDERS[conf.provider];
    const c = { ...conf, model: conf.model || p.defaultModel, url: trimUrl(conf.url || p.defaultUrl) };
    if (c.provider === 'opencode-go' && c.model.startsWith('claude'))
      return CALLS['anthropic:api']({ ...c, url: c.url.replace(/\/v1$/, '') }, prompt, system);
    if (c.provider === 'opencode-go' && c.model.startsWith('gpt'))
      return request(`${c.url}/responses`, {
        headers: { authorization: `Bearer ${c.key}` },
        body: { model: c.model, instructions: system, input: prompt, text: { format: { type: 'json_object' } } },
      }).then(j => ({ text: j.output_text ?? (j.output ?? []).flatMap(o => o.content ?? []).filter(b => b.type === 'output_text').map(b => b.text).join(''), tokens: j.usage?.total_tokens ?? 0 }));
    return CALLS['compatible:api'](c, prompt, system);
  }
  const call = CALLS[`${conf?.provider}:${conf?.via}`];
  if (!call) return Promise.reject(Object.assign(new Error('no provider'), { code: 'ENOENT' }));
  return call(conf, prompt, system);
}

// One readable reason for a failed call, so the app can say what to fix. `conf` tailors the advice.
export function explain(err, conf = null) {
  const text = `${err?.message ?? ''}\n${err?.stderr ?? ''}\n${err?.stdout ?? ''}`;
  const via = conf?.via, p = PROVIDERS[conf?.provider];
  const login = via === 'api' ? msg(conf?.provider === 'compatible' ? 'provider.checkServer' : 'provider.checkKey') : p?.cli?.login ?? msg('provider.login', { bin: p?.cli?.bin ?? 'CLI' });
  if (err?.code === 'nomodel') return { code: 'model', message: msg(via === 'local' ? 'provider.noLocalModel' : 'provider.noModel') };
  if (err?.code === 'nourl') return { code: 'missing', message: msg('provider.noUrl') };
  if (err?.offline) return { code: 'offline', message: via === 'local' ? msg('provider.localOffline') : msg('provider.offline', { code: err.code ?? msg('provider.connectionError') }) };
  if (err?.code === 'ENOENT' || /is not recognized as an internal|command not found/i.test(text)) return { code: 'missing', message: via === 'cli' ? msg('provider.missingCli', { label: p?.cli?.label ?? 'CLI' }) : msg('provider.unavailable') };
  if (err?.status === 404 || /model[^\n]{0,40}(not found|does not exist|not supported)|unknown model|invalid model/i.test(text)) return { code: 'model', message: msg('provider.modelError') };
  if (err?.status === 402 || /credit balance|insufficient|quota|billing|payment|usage limit|limit reached|out of credits/i.test(text)) return { code: 'credits', message: msg('provider.credits') };
  if (err?.status === 401 || err?.status === 403 || /log ?in|logged in|authenticat|unauthori[sz]ed|\b401\b|api key|invalid.*key|oauth|permission denied/i.test(text)) return { code: 'auth', message: msg('provider.auth', { login }) };
  if (err?.status === 429 || err?.status === 529 || err?.status >= 500 || /rate limit|\b429\b|overloaded|\b529\b/i.test(text)) return { code: 'rate', message: msg('provider.rate') };
  if (err?.killed || /timed? ?out|ETIMEDOUT/i.test(text)) return { code: 'timeout', message: msg('provider.timeout') };
  return { code: 'error', message: msg('provider.error', { message: String(err?.message ?? msg('provider.unknownError')).split('\n')[0].slice(0, 160) }) };
}

export function extractJson(text) {
  const s = String(text).trim();
  try { return JSON.parse(s); } catch {}
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  if (fence) try { return JSON.parse(fence[1]); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) try { return JSON.parse(s.slice(a, b + 1)); } catch {}
  return null;
}

// ---- availability ------------------------------------------------------------------------------
export async function ollamaModels(url) {
  try { const j = await request(`${trimUrl(url) || PROVIDERS.ollama.defaultUrl}/api/tags`, { method: 'GET', timeout: 1500 }); return { running: true, models: (j.models ?? []).map(m => m.name ?? m.model).filter(Boolean).sort() }; }
  catch { return { running: false, models: [] }; }
}

// Can this provider answer with this method right now? Returns the call config or a reason it can't.
async function ready(id, via, pc, secrets) {
  const p = PROVIDERS[id];
  const base = { provider: id, via, model: via === 'cli' && !pc.model ? (p.cliDefaultModel ?? p.defaultModel) : pc.model || p.defaultModel, url: pc.url || p.defaultUrl || '' };
  if (via === 'cli') return (await hooks.where(p.cli.bin)) ? { conf: base } : { reason: msg('provider.notInstalled', { label: p.cli.label }) };
  if (via === 'local') {
    const o = await ollamaModels(base.url);
    if (!o.running) return { reason: msg('provider.ollamaOff') };
    const model = pc.model && o.models.includes(pc.model) ? pc.model : pc.model || o.models[0] || '';
    return model ? { conf: { ...base, model } } : { reason: msg('provider.noInstalledModels') };
  }
  const key = secrets?.get(id) || p.envKeys.map(k => process.env[k]).find(Boolean) || null;
  if (id === 'compatible') return base.url && base.model ? { conf: { ...base, key } } : { reason: msg('provider.enterServerModel') };
  return key ? { conf: { ...base, key } } : { reason: msg('provider.noKey') };
}

/**
 * The provider that will answer, from the commentary settings: { provider, providers: { [id]: { via, model, url } } }.
 * "auto" walks ORDER and takes the first one that is ready, trying each provider's chosen method first.
 */
export async function resolve(commentary, secrets) {
  const choice = commentary?.provider ?? 'auto';
  if (choice === 'off') return null;
  const pcs = commentary?.providers ?? {};
  const tryOne = async (id, any) => {
    const p = PROVIDERS[id], pc = pcs[id] ?? {};
    const methods = [pc.via && p.methods.includes(pc.via) ? pc.via : p.methods[0], ...(any ? p.methods : [])];
    for (const via of [...new Set(methods)]) { const r = await ready(id, via, pc, secrets); if (r.conf) return r.conf; }
    return null;
  };
  if (choice !== 'auto') return PROVIDERS[choice] ? tryOne(choice, false) : null;
  for (const id of ORDER) { const conf = await tryOne(id, true); if (conf) return conf; }
  return null;
}

/** Everything the settings screen shows per provider. Keys never leave this process: only whether one exists. */
export async function status(commentary, secrets) {
  const pcs = commentary?.providers ?? {};
  return Promise.all(ORDER.map(async id => {
    const p = PROVIDERS[id], pc = pcs[id] ?? {};
    const via = pc.via && p.methods.includes(pc.via) ? pc.via : p.methods[0];
    const out = { id, label: p.label, sub: p.sub, methods: p.methods, via, model: pc.model ?? '', url: pc.url || p.defaultUrl || '', models: p.models, defaultModel: p.defaultModel, cliDefaultModel: p.cliDefaultModel ?? null, keyUrl: p.keyUrl ?? null, setupUrl: p.setupUrl ?? null, keyHint: p.keyHint ?? '', envKeys: p.envKeys };
    if (p.cli) out.cli = { bin: p.cli.bin, label: p.cli.label, installed: !!(await hooks.where(p.cli.bin)) };
    if (p.methods.includes('api')) out.key = secrets?.describe(id) ?? { has: p.envKeys.some(k => !!process.env[k]), source: p.envKeys.find(k => !!process.env[k]) ? 'env' : null };
    if (id === 'ollama') out.ollama = await ollamaModels(out.url);
    const r = await ready(id, via, pc, secrets);
    out.ready = !!r.conf; out.reason = r.reason ?? null; out.conf = r.conf ? { ...r.conf, key: undefined, label: describe(r.conf) } : null;
    return out;
  }));
}

/** A tiny real call, to tell the user whether commentary will work with this config. */
export async function test(conf) {
  if (!conf) return { ok: false, code: 'missing', message: msg('provider.connectFirst') };
  const t = Date.now();
  try {
    const r = await ask(conf, 'JSON 하나로만 답해: {"ok": true}', '너는 테스트 응답기야. 요청한 JSON만 출력해.');
    return extractJson(r.text)?.ok ? { ok: true, ms: Date.now() - t, costUsd: r.costUsd ?? null, tokens: r.tokens ?? null, label: describe(conf) } : { ok: false, code: 'error', message: msg('provider.badReply') };
  } catch (e) { return { ok: false, ...explain(e, conf) }; }
}
