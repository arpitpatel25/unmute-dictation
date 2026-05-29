// ─── Groq usage tracking (local cost estimate) ───
// Every Groq call funnels through groq.ts; after a successful response it reports
// the exact usage here. We persist raw units (audio seconds, token counts) per
// day+model in SQLite and compute an estimated dollar figure on read from the
// hardcoded price table. Recording is best-effort: a failure here must never
// break transcription, so everything is wrapped in try/catch.

import { GROQ_PRICING } from './config'
import { addUsage, getUsageRows, clearUsage, type UsageRow } from './db'

/** Local calendar date as YYYY-MM-DD (used to bucket usage by day). */
function localDateStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Record a Whisper transcription. `seconds` is the audio duration Groq billed. */
export function recordSttUsage(model: string, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return
  try {
    addUsage(localDateStr(), model, { sttSeconds: seconds })
  } catch (err) {
    console.warn('[usage] failed to record STT usage:', err instanceof Error ? err.message : err)
  }
}

/** Record an LLM chat completion from its `usage` token counts. */
export function recordLlmUsage(model: string, inputTokens: number, outputTokens: number): void {
  const input = Number.isFinite(inputTokens) ? inputTokens : 0
  const output = Number.isFinite(outputTokens) ? outputTokens : 0
  if (input <= 0 && output <= 0) return
  try {
    addUsage(localDateStr(), model, { inputTokens: input, outputTokens: output })
  } catch (err) {
    console.warn('[usage] failed to record LLM usage:', err instanceof Error ? err.message : err)
  }
}

/** Estimated USD for a single usage row, priced from GROQ_PRICING. */
function rowCost(row: UsageRow): number {
  const price = GROQ_PRICING[row.model]
  if (!price) return 0
  let cost = 0
  if (price.perAudioHour) cost += (row.stt_seconds / 3600) * price.perAudioHour
  if (price.perMInputTokens) cost += (row.input_tokens / 1_000_000) * price.perMInputTokens
  if (price.perMOutputTokens) cost += (row.output_tokens / 1_000_000) * price.perMOutputTokens
  return cost
}

/** Estimated cost plus the raw units behind it, for one time window. */
export interface UsageWindow {
  /** Estimated USD spent in this window. */
  cost: number
  inputTokens: number
  outputTokens: number
  /** Seconds of audio transcribed. */
  sttSeconds: number
}

export interface UsageSummary {
  today: UsageWindow
  month: UsageWindow
  allTime: UsageWindow
}

function emptyWindow(): UsageWindow {
  return { cost: 0, inputTokens: 0, outputTokens: 0, sttSeconds: 0 }
}

function addRow(w: UsageWindow, row: UsageRow, cost: number): void {
  w.cost += cost
  w.inputTokens += row.input_tokens
  w.outputTokens += row.output_tokens
  w.sttSeconds += row.stt_seconds
}

/** Per-window estimated cost + raw usage across today / this month / all-time. */
export function getUsageSummary(): UsageSummary {
  const today = emptyWindow()
  const month = emptyWindow()
  const allTime = emptyWindow()
  try {
    const todayStr = localDateStr()
    const monthStr = todayStr.slice(0, 7) // YYYY-MM
    for (const row of getUsageRows()) {
      const cost = rowCost(row)
      addRow(allTime, row, cost)
      if (row.date.startsWith(monthStr)) addRow(month, row, cost)
      if (row.date === todayStr) addRow(today, row, cost)
    }
  } catch (err) {
    console.warn('[usage] failed to summarize usage:', err instanceof Error ? err.message : err)
  }
  return { today, month, allTime }
}

/** Wipe all recorded usage (the Settings "Reset" button). */
export function resetUsage(): void {
  try {
    clearUsage()
  } catch (err) {
    console.warn('[usage] failed to reset usage:', err instanceof Error ? err.message : err)
  }
}
