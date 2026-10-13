// The common event format every adapter emits. The match engine only ever sees these.
//
//   { type: 'prompt',  at, text }                      the user's instruction (first one is the task)
//   { type: 'say',     at, text }                      the agent talking (plain text, not reasoning)
//   { type: 'think',   at }                            reasoning happened (content is never shown)
//   { type: 'alive',   at }                            some sign of life without a visible action
//   { type: 'call',    at, id, tool }                  the agent started a tool call
//   { type: 'result',  at, id, output, error }         the tool call finished
//   { type: 'model',   at, model }                     the model that is playing
//   { type: 'meta',    at, cwd }                       the project directory the agent works in
//   { type: 'role',    at, parent, role, tag, name }    subagent identity; parent is the adapter's parent session ID
//   { type: 'compact', at, count? }                    recorded context compaction; count is cumulative, or omitted for one boundary
//   { type: 'waiting', at, text? }                     explicitly recorded user question or approval wait
//   { type: 'usage',   at, costUsd }                   cumulative cost so far, when the agent records it
//   { type: 'end',     at, text }                      the agent finished its turn (text: its closing report)
//
// `at` is epoch milliseconds. `tool` is { kind, name, command?, path?, content?, added?, removed?, pattern? } where kind is
// one of shell, read, write, edit, search, plan, delegate, other. `content` is a whole file being written; `added` and
// `removed` are the text an edit puts in and takes out, when the agent records them. `output` is plain text; `error` is a boolean.

export const TOOL_KINDS = ['shell', 'read', 'write', 'edit', 'search', 'plan', 'delegate', 'other'];

// Text in and out of a list of {old, new} replacements, e.g. edits.map(e => [e.old_string, e.new_string]).
export const replacements = (list, oldKey, newKey) => {
  const items = Array.isArray(list) ? list : [];
  return { added: items.map(e => String(e?.[newKey] ?? '')).join('\n'), removed: items.map(e => String(e?.[oldKey] ?? '')).join('\n') };
};
// Lines a unified-diff style patch body adds and removes ("+" and "-" lines, not the file headers).
export const diffLines = patch => {
  const lines = String(patch ?? '').split('\n');
  return {
    added: lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1)).join('\n'),
    removed: lines.filter(l => l.startsWith('-') && !l.startsWith('---')).map(l => l.slice(1)).join('\n'),
  };
};

export const textOf = c => {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(b => (typeof b === 'string' ? b : b?.type === 'text' || b?.type === 'output_text' || b?.type === 'input_text' ? b.text : '')).join('\n');
  if (typeof c === 'object' && typeof c.text === 'string') return c.text;
  return JSON.stringify(c);
};
