#!/usr/bin/env node
/**
 * Quick check that a local OpenAI-compatible server (default: Ollama) answers POST /v1/chat/completions.
 *
 * Usage:
 *   node scripts/ollama-smoke.mjs
 *   node scripts/ollama-smoke.mjs llama3.2:3b
 *   OLLAMA_BASE=http://127.0.0.1:1234/v1 node scripts/ollama-smoke.mjs  # LM Studio, etc.
 */

const baseRaw = (process.env.OLLAMA_BASE ?? 'http://127.0.0.1:11434').replace(/\/+$/, '')
const model = process.argv[2] ?? process.env.OLLAMA_MODEL ?? 'llama3.1:8b'
const url = `${baseRaw}/v1/chat/completions`

const body = {
  model,
  messages: [{ role: 'user', content: 'Reply with exactly the word: ok' }],
  temperature: 0,
  stream: false,
}

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const text = await res.text()
if (!res.ok) {
  console.error(`HTTP ${res.status} from ${url}`)
  console.error(text.slice(0, 600))
  process.exit(1)
}

let msg = ''
try {
  const data = JSON.parse(text)
  const c0 = data?.choices?.[0]?.message?.content
  msg = typeof c0 === 'string' ? c0.trim() : ''
} catch {
  console.error('Non-JSON response:', text.slice(0, 400))
  process.exit(1)
}

console.log(`OK — ${url} model=${model}`)
console.log(`Assistant excerpt: ${msg.slice(0, 120)}${msg.length > 120 ? '…' : ''}`)
