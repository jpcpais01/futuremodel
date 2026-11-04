// One door to Claude: streaming, structured JSON, prompt caching, refusal fallback, cost metering, and a demo mode.
'use strict';
const { MODELS, WEB_SEARCH_PER_CALL } = require('./config');

let client = null, KEY = null;
/* The key is pasted in the app for one meeting and held only in memory (or ANTHROPIC_API_KEY on the command line). It is never written anywhere. */
function setKey(k) { KEY = k || null; client = null; }
const keyOf = () => KEY || (typeof process !== 'undefined' && process.env && process.env.ANTHROPIC_API_KEY) || null;
function getClient() {
  if (client) return client;
  const apiKey = keyOf();
  if (!apiKey) throw Object.assign(new Error('No Anthropic key. Paste it when you convene the council.'), { code: 'NO_KEY' });
  const Anthropic = require('@anthropic-ai/sdk');
  client = new Anthropic({ apiKey, maxRetries: 4, timeout: 20 * 60e3, dangerouslyAllowBrowser: true });   // the phone's web view counts as a browser; the key never leaves the device except to Anthropic
  return client;
}
const hasKey = () => !!keyOf();

function cost(model, u, searches = 0) {
  const p = MODELS[model] || MODELS[Object.keys(MODELS).find((k) => model && model.startsWith(k))] || MODELS['claude-opus-5-5'];
  const M = 1e6;
  return ((u.input_tokens || 0) * p.in + (u.cache_creation_input_tokens || 0) * p.cacheWrite + (u.cache_read_input_tokens || 0) * p.cacheRead + (u.output_tokens || 0) * p.out) / M + searches * WEB_SEARCH_PER_CALL;
}

/* Reads a string field out of JSON that is still streaming in, so a statement can be shown as it is written. */
function partialField(text, field) {
  const k = text.indexOf(`"${field}"`);
  if (k < 0) return '';
  const q = text.indexOf('"', text.indexOf(':', k) + 1);
  if (q < 0) return '';
  let out = '', i = q + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') break;
    if (c === '\\') {
      const n = text[i + 1];
      if (n === undefined) break;
      if (n === 'u') { const h = text.slice(i + 2, i + 6); if (h.length < 4) break; out += String.fromCharCode(parseInt(h, 16)); i += 6; continue; }
      out += { n: '\n', t: '\t', r: '', b: '', f: '' }[n] ?? n; i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

/* Demo mode: no API calls. The caller supplies plausible output; this streams it like the real thing. */
let MOCK = false, SPEED = 1;
const TOOL_BLOCK = /server_tool_use|_tool_result$/;
/* speed: 1 streams at a readable pace; tests use a large number. */
function setMock(v, speed = 1) { MOCK = !!v; SPEED = speed; }
async function mockCall({ mock, onText, onThinking, signal, schema }) {
  const speed = SPEED;
  const data = mock();
  delete data._think;
  const json = schema ? JSON.stringify(data) : data.digest || '';
  const st = schema ? data.statement || '' : json;
  const think = 'Weighing the evidence in the market book against my mandate…';
  for (let i = 0; i < think.length; i += 12) { if (signal?.aborted) throw new Error('cancelled'); onThinking?.(think.slice(i, i + 12)); await new Promise((r) => setTimeout(r, 18 / speed)); }
  const esc = schema ? JSON.stringify(st).slice(1, -1) : st, at = Math.max(0, json.indexOf(esc));
  for (let i = 0; i <= esc.length; i += 6) { if (signal?.aborted) throw new Error('cancelled'); onText?.(json.slice(0, at + i)); await new Promise((r) => setTimeout(r, 22 / speed)); }
  onText?.(json);
  return { data: schema ? data : null, text: json, model: 'demo', usage: {}, cost: 0, ms: 0 };
}

/**
 * call({ model, effort, system, messages, schema, maxTokens, tools, onText, onThinking, signal, mock })
 * system: array of text blocks; put cache_control on the last shared block.
 * Returns { data, text, usage, cost, model, ms }.
 */
async function call(o) {
  if (MOCK) return mockCall(o);
  const c = getClient(), t0 = Date.now();
  const isHaiku = /haiku/.test(o.model);
  let messages = o.messages.slice(), text = '', answer = '', searches = 0, searchOk = 0, searchFailed = 0, usedTools = false,
    total = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, final, servedBy = o.model;
  // A tool-using answer can pause many times while the server runs searches; keep going until it finishes.
  for (let turn = 0; turn < 16; turn++) {
    const params = {
      model: o.model,
      max_tokens: o.maxTokens || 32000,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: o.effort || 'medium', ...(o.schema ? { format: { type: 'json_schema', schema: o.schema } } : {}) },
      system: o.system,
      messages,
      ...(o.tools ? { tools: o.tools } : {}),
    };
    // Server-side fallback re-runs a declined request on Anthropic's recommended model instead of failing.
    if (!isHaiku) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
    const stream = c.beta.messages.stream(params, { signal: o.signal });
    let turnText = '';
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') { turnText += ev.delta.text; answer += ev.delta.text; o.onText?.(o.tools ? answer : text + turnText); }
        else if (ev.delta.type === 'thinking_delta') o.onThinking?.(ev.delta.thinking);
      } else if (ev.type === 'content_block_start') {
        const t = ev.content_block.type;
        if (t === 'text') { if (turnText) turnText += '\n'; if (answer) answer += '\n'; }
        else if (TOOL_BLOCK.test(t)) { usedTools = true; answer = ''; }   // words written before a search are the model thinking aloud, not the answer
      }
    }
    final = await stream.finalMessage();
    servedBy = final.model || servedBy;
    for (const k of Object.keys(total)) total[k] += final.usage?.[k] || 0;
    searches += final.usage?.server_tool_use?.web_search_requests || 0;
    for (const b of final.content) if (b.type === 'web_search_tool_result') { if (Array.isArray(b.content)) searchOk++; else searchFailed++; }
    text += final.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (final.stop_reason === 'pause_turn') { messages = [...messages, { role: 'assistant', content: final.content }]; continue; }
    break;
  }
  if (usedTools && answer.trim()) text = answer.trim();
  if (final.stop_reason === 'pause_turn') throw Object.assign(new Error('The web research did not finish in time.'), { cost: cost(servedBy, total, searches), usage: total });
  const spent = cost(servedBy, total, searches);
  if (final.stop_reason === 'refusal') throw Object.assign(new Error('The model declined this request.'), { cost: spent, usage: total });
  const data = o.schema ? parseJSON(text) : null;
  if (o.schema && !data) throw Object.assign(new Error(final.stop_reason === 'max_tokens' ? 'The answer was cut off (max tokens).' : 'The answer was not valid JSON.'), { cost: spent, usage: total });
  return { data, text, usage: { ...total, web_search_requests: searches, web_search_ok: searchOk, web_search_failed: searchFailed }, cost: spent, model: servedBy, ms: Date.now() - t0 };
}

module.exports = { call, cost, partialField, parseJSON, setMock, hasKey, setKey, isMock: () => MOCK };
