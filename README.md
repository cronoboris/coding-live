# coding live

English · [한국어](README.ko.md)

**Watch your AI coding agents like a live sports broadcast.**

Don't read the code. Just watch.

https://github.com/user-attachments/assets/a854f761-205a-4ae5-a62a-ba38854bee2e

coding live treats coding as a sport of its own and covers the coding agents running on your computer, live.\
Agents working in the same project folder (say, Claude Code and Codex side by side) become players in one match and are covered together.

The goal: even if you can't read code, you can tell how far the work has gotten, whether it's stuck, and whether there's a decision only you can make.

### See it

- **File map**\
  Your project's files spread out as a treemap, with every file name shown.\
  The file a player is on right now is the largest, and recently touched files shrink back slowly.\
  Player chips move to the file they're working on and show their current stage (Reading, Writing, Testing, Fixing a failure, Passing).\
  Files edited by two players are flagged.

- **Multiple players, helper players**\
  Subagents join as helper players under the player who sent them, like "engine ↳ helping Dario Anyday · heavy-worker".

- **Widget**\
  A small window that stays on top of everything else.\
  Park it next to your terminal and it follows the match that's live.

### Understand it

- **Caster lines**\
  The agent's activity log, turned into plain sentences by fixed rules.\
  No AI model is involved, so nothing gets made up.

- **More**\
  On every feed line, a step-by-step, plain-language explanation of what each tool or command the agent used actually does.

- **AI commentary (optional)**\
  At key moments only, a small model runs a two-person booth: a play-by-play caster and an analyst.\
  The commentary sticks to facts, and attributes the player's (agent's) claims, as in "according to the player…".

### Catch it

- **37 key moments**\
  Rules catch a first test failure, tests rewritten right after a failure, repeated failures, assumptions the player made on its own, skipped tests, weakened checks, hidden failures (`|| true`), hard-to-undo commands and more.\
  Each moment can be turned on or off.

- **Lesson cards**\
  What happened, in an everyday comparison; why it matters; and how to tell a fair move from a shortcut.\
  Each card comes with a question you can paste straight into your agent (with a copy button).\
  Lesson cards work without any AI.

- **Notifications and match report**\
  Even with the window closed, you're told about the moments that matter.\
  When the match ends, you get a rating from a public formula and one thing to check yourself.

Players get pun names based on well-known AI people from the model's company (for example Dario Anyday or Sam Alt-Tab).\
They're parodies for fun and have nothing to do with the real people.\
You can switch to plain names in Settings.

## Install

coding live is a desktop app; no terminal needed.\
Download the file for your computer from [Releases](https://github.com/cronoboris/coding-live/releases) and install it.

| Computer | File to download |
|---|---|
| Mac (Apple silicon, M1–M4 and later) | `coding-live-…-mac-arm64.dmg` |
| Mac (Intel) | `coding-live-…-mac-x64.dmg` |
| Windows | `coding-live-…-win-x64.exe` |
| Linux (Ubuntu, Debian) | `coding-live-…-linux-amd64.deb` (double-click to install with the app center) |
| Linux (others) | `coding-live-…-linux-x86_64.AppImage` (allow it to run as a program in the file's properties) |

The app isn't signed with a paid certificate yet, so you'll see one confirmation the first time you open it.

- **Mac**\
  Open the dmg, drag the app into Applications, and launch it.\
  If you see an "unidentified developer" warning, go to **System Settings → Privacy & Security** and click **Open Anyway** at the bottom.

- **Windows**\
  If "Windows protected your PC" appears, click **More info → Run anyway**.

When it starts, you get the main window and a small **widget**.\
The widget stays on top of other windows, so it fits nicely next to the terminal where your agent runs.\
It follows whichever session is live (or a match you pick), and ⤢ opens that match in the big window.\
It remembers where you put it.

Closing the window keeps coding live in the menu bar (on Windows, the tray at the right of the taskbar), so notifications keep coming.\
Use **Show widget** in the tray menu to show or hide the widget.\
Turn on **Open at login** to have it start with your computer.\
To quit completely, choose **Quit coding live** from the tray menu.

### Running from source

```sh
npm install
npm run app                 # desktop app
node bin/coding-live.mjs    # watch in your browser (--port, --mic auto|anthropic|openai|google|ollama|compatible|off, --no-open)
```

Building installers: push a tag like `v0.1.0` and GitHub Actions builds the Mac, Windows and Linux installers and uploads them to Releases.

## Supported agents

coding live never changes your agents. It reads the session history each agent saves on disk.\
A small adapter per agent turns that history into common events (`src/core/events.mjs`), and a single engine (`src/core/match.mjs`) covers the match.

| Agent | Where the history lives | Status |
|---|---|---|
| Claude Code | `~/.claude/projects/*/*.jsonl` (`CLAUDE_CONFIG_DIR`) | Supported |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (`CODEX_HOME`) | Supported |
| Gemini CLI | `~/.gemini/tmp/<project>/chats/session-*.jsonl` (`GEMINI_CLI_HOME`) | Supported |
| Pi | `~/.pi/agent/sessions/*/*.jsonl` (`PI_CODING_AGENT_DIR`) | Supported |
| omp (oh-my-pi) | `~/.omp/agent/sessions/*/*.jsonl` (`PI_CONFIG_DIR`, XDG, profiles) | Supported |
| mixdog | `~/.mixdog/data/sessions/*.json` plus checkpoints of the turn in progress (`MIXDOG_HOME`, `MIXDOG_DATA_DIR`) | Supported |

The Codex, Gemini, Pi, omp and mixdog adapters follow the history formats in each agent's public source (Codex rust-v0.162, Gemini CLI 0.63, Pi 1.1, omp 18.10, mixdog 1.1).\
Their tests run on synthetic histories in those formats.\
If real histories look different anywhere, please open an issue.

Subagents (helper players) are shown for Claude Code, Codex, omp and mixdog.

## Settings

Open them with the gear at the top left (⌘, / Ctrl+,).\
Changes are saved right away.

- **General**\
  Language (System, 한국어, English; System picks Korean only when your computer is set to Korean), theme (System, Dark, Light), player names (Puns, Plain), open at login, start hidden

- **Agents**\
  Turn each agent on or off, set its history folder, see how many matches were found

- **Commentary**\
  Provider with each provider's connection method, model, API key and test button; turn on for new matches; tone (Spicy, Mild); tool and command explanations; beginner tips (Detailed, Short, Off); commentary limit per match (10 to 100, or no limit); what you've spent

- **Moments**\
  Choose which key moments to catch, one by one or by group (Tests, Worth checking, Subagents, Files and commands, Progress, User input).

- **Notifications**\
  Keeps watching from the tray even with the window closed, and tells you about assumptions to check, suspected shortcuts, repeated failures, long silences and finished work.\
  Each kind can be turned on or off.

- **Widget**\
  Show, always on top, match to follow (Auto or Choose), opacity, reset position

- **Privacy**\
  Whether to include what the agent says when asking the AI for commentary

## Setting up the commentary mic

In **Settings → Commentary**, pick a provider, then open its card to choose how to connect and which model to use.\
Every card has a **Test** button so you can make a real call before committing.\
If it fails, it tells you why (not installed, not signed in, bad key, wrong model name, out of credits, Ollama not running, and so on).

| Provider | How to connect | Models |
|---|---|---|
| Anthropic | Claude Code sign-in, or an API key (`ANTHROPIC_API_KEY`) | Haiku 5.5 (recommended), Sonnet 5.5, Opus 5.5, Fable 5.1, or enter one |
| Google | Gemini CLI sign-in, or an API key (`GEMINI_API_KEY`) | Gemini 2.5 Flash (recommended, has a free tier), Flash-Lite, Pro, or enter one |
| OpenAI | Codex sign-in, or an API key (`OPENAI_API_KEY`) | Codex default model, GPT-5 mini, nano, GPT-5, or enter one |
| Cursor | Cursor CLI sign-in (`agent login`), or the `CURSOR_API_KEY` environment variable | CLI default model, or enter one |
| GitHub Copilot | Copilot CLI sign-in (`/login` in `copilot`) | claude-haiku-4.5 (recommended), or enter one |
| Qwen | Qwen Code sign-in (run `qwen` once) | qwen3-coder-plus (recommended), or enter one |
| opencode | opencode sign-in (`opencode auth login`) | CLI default model, or enter one (`provider/model`) |
| Amp | Amp CLI sign-in (run `amp` once; execute mode uses paid credits) | CLI default model |
| Grok | Grok CLI sign-in (`grok login`) | CLI default model, or enter one |
| Ollama | Your own computer (default `http://127.0.0.1:11434`), free, no credits | Any installed model (for example `ollama pull gemma3`) |
| OpenAI-compatible server | Server address plus an optional API key (LM Studio `http://127.0.0.1:1234/v1`, OpenRouter and others) | The server's model name |
| OpenCode Go | API key (`OPENCODE_API_KEY`), `https://opencode.ai/zen/go/v1` | glm-5.2 (recommended), or enter one; claude models use Messages, gpt models use Responses, the rest use Chat Completions |
| OpenRouter | API key (`OPENROUTER_API_KEY`), `https://openrouter.ai/api/v1` | openrouter/auto (recommended), or enter one |
| DeepSeek | API key (`DEEPSEEK_API_KEY`), `https://api.deepseek.com` | deepseek-v4-pro (recommended), or enter one |
| xAI | API key (`XAI_API_KEY`), `https://api.x.ai/v1` | grok-4.5 (recommended), or enter one |

- The Cursor, GitHub Copilot, Qwen, opencode, Amp and Grok connections are still **experimental**.\
  If one doesn't work, please open an issue.

- **Auto** uses the first provider that's ready, in this order: Anthropic → Google → OpenAI → Ollama → compatible server → OpenCode Go → OpenRouter → DeepSeek → xAI.

- API keys saved in the desktop app are encrypted with your system keychain (macOS Keychain, Windows DPAPI, the Linux secret store) and stored separately.\
  Only the last four characters are ever shown.\
  On Linux without a keychain, and in browser mode, use environment variables instead.\
  The app also picks up keys set in your shell profile (`~/.zshrc` and so on).

- Click the **AI commentary** button at the top of a match to start commentary from its next key moment.\
  If you don't want to click it every time, turn on **Turn on for new matches**.

- The **commentary limit per match** can be 10, 20, 50, 100 or no limit.\
  Past the limit, or if the connection fails, commentary falls back to built-in lines; lesson cards and everything else keep working.

Through a Claude Code login (Haiku), each moment takes 20–40 seconds and about $0.03–0.07 by Claude Code's own cost report (the first call costs more).\
Claude Code sends its own instructions along, so it is heavier than calling the API with a key.\
Ollama is free.

## Privacy

- The desktop app opens no web server.\
  The screen and the engine talk directly inside the app.

- In browser mode (`node bin/coding-live.mjs`), the server listens on `127.0.0.1` only.\
  It turns away requests for other host names and write requests from other origins.

- Session history never leaves your computer.\
  The one exception: with the commentary mic on, a summary of each key moment (recent feed lines and a bit of what the player said) goes to the provider you chose.\
  With Ollama, everything stays on your computer.

- API keys saved in the app are encrypted with your system keychain, kept separately in `secrets.json`, and never sent to the screen.

## Development

```sh
npm install
npm test
```

## License

[MIT](LICENSE)

Claude, Codex, Gemini and other names in this document are trademarks of their respective owners; this project is not affiliated with them.\
Player names are parodies for fun.
