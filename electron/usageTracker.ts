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

export interface UsageSummary {
  /** Estimated USD spent today (local time). */
  today: number
  /** Estimated USD spent this calendar month (local time). */
  month: number
  /** Estimated USD spent all-time. */
  allTime: number
  /** All-time raw usage units behind the estimate. */
  totals: {
    inputTokens: number
    outputTokens: number
    sttSeconds: number
  }
}

/** Combined estimated dollar totals across today / this month / all-time. */
export function getUsageSummary(): UsageSummary {
  let today = 0
  let month = 0
  let allTime = 0
  let inputTokens = 0
  let outputTokens = 0
  let sttSeconds = 0
  try {
    const todayStr = localDateStr()
    const monthStr = todayStr.slice(0, 7) // YYYY-MM
    for (const row of getUsageRows()) {
      const cost = rowCost(row)
      allTime += cost
      if (row.date.startsWith(monthStr)) month += cost
      if (row.date === todayStr) today += cost
      inputTokens += row.input_tokens
      outputTokens += row.output_tokens
      sttSeconds += row.stt_seconds
    }
  } catch (err) {
    console.warn('[usage] failed to summarize usage:', err instanceof Error ? err.message : err)
  }
  return { today, month, allTime, totals: { inputTokens, outputTokens, sttSeconds } }
}

/** Wipe all recorded usage (the Settings "Reset" button). */
export function resetUsage(): void {
  try {
    clearUsage()
  } catch (err) {
    console.warn('[usage] failed to reset usage:', err instanceof Error ? err.message : err)
  }
}
