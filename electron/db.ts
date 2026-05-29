import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'

let db: Database.Database

export interface DBSession {
  id: string
  created_at: number
  flow_type: string
  dictation_transcript: string | null
  instruction_transcript: string | null
  selected_text: string | null
  selected_text_role: string | null
  output: string | null
  audio_file_path: string | null
  status: string
  error_message: string | null
}

export function initDB(): void {
  const dbPath = path.join(app.getPath('userData'), 'unmute.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      flow_type TEXT NOT NULL,
      dictation_transcript TEXT,
      instruction_transcript TEXT,
      selected_text TEXT,
      selected_text_role TEXT,
      output TEXT,
      audio_file_path TEXT,
      status TEXT DEFAULT 'done',
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
  `)

  // Cumulative Groq usage, one row per local day + model. Deliberately NOT
  // subject to the sessions cleanup below — this is a lifetime running total.
  // Raw units are stored (audio seconds, token counts); dollars are computed at
  // read time from the price table, so changing prices recomputes history.
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_daily (
      date TEXT NOT NULL,
      model TEXT NOT NULL,
      stt_seconds REAL NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, model)
    );
  `)

  // Run cleanup on init
  cleanupSessions()
}

export interface UsageRow {
  date: string
  model: string
  stt_seconds: number
  input_tokens: number
  output_tokens: number
}

/**
 * Add usage to a (date, model) bucket, creating it if needed. Amounts are
 * additive — pass only what this single request consumed.
 */
export function addUsage(date: string, model: string, delta: {
  sttSeconds?: number
  inputTokens?: number
  outputTokens?: number
}): void {
  const stmt = db.prepare(`
    INSERT INTO usage_daily (date, model, stt_seconds, input_tokens, output_tokens)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date, model) DO UPDATE SET
      stt_seconds = stt_seconds + excluded.stt_seconds,
      input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens
  `)
  stmt.run(
    date,
    model,
    delta.sttSeconds || 0,
    delta.inputTokens || 0,
    delta.outputTokens || 0,
  )
}

/** All usage rows. Small (one row per day per model), so reading all is cheap. */
export function getUsageRows(): UsageRow[] {
  return db.prepare('SELECT * FROM usage_daily').all() as UsageRow[]
}

export function clearUsage(): void {
  db.prepare('DELETE FROM usage_daily').run()
  console.log('[db] Usage stats cleared')
}

export function saveSession(session: {
  sessionId: string
  flowType: string
  dictationTranscript: string | null
  instructionTranscript: string | null
  selectedText: string | null
  selectedTextRole: string | null
  output: string | null
  audioFilePath?: string | null
  status: string
  errorMessage: string | null
  createdAt: number
}): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sessions (
      id, created_at, flow_type, dictation_transcript, instruction_transcript,
      selected_text, selected_text_role, output, audio_file_path, status, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    session.sessionId,
    session.createdAt,
    session.flowType,
    session.dictationTranscript,
    session.instructionTranscript,
    session.selectedText,
    session.selectedTextRole,
    session.output,
    session.audioFilePath || null,
    session.status,
    session.errorMessage
  )

  // Cleanup after insert
  cleanupSessions()
}

export function getSessions(limit = 50): Record<string, unknown>[] {
  const rows = db.prepare(
    'SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as DBSession[]

  // Map snake_case DB columns to camelCase for renderer
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    flowType: row.flow_type,
    dictationTranscript: row.dictation_transcript,
    instructionTranscript: row.instruction_transcript,
    selectedText: row.selected_text,
    selectedTextRole: row.selected_text_role,
    output: row.output,
    audioFilePath: row.audio_file_path,
    status: row.status,
    errorMessage: row.error_message
  }))
}

export function getSession(id: string): DBSession | undefined {
  return db.prepare(
    'SELECT * FROM sessions WHERE id = ?'
  ).get(id) as DBSession | undefined
}

export function updateSessionResult(sessionId: string, updates: {
  dictationTranscript: string | null
  output: string | null
  status: string
  errorMessage: string | null
  flowType?: string
}): void {
  const stmt = db.prepare(`
    UPDATE sessions SET
      dictation_transcript = ?,
      output = ?,
      status = ?,
      error_message = ?,
      flow_type = COALESCE(?, flow_type)
    WHERE id = ?
  `)
  stmt.run(
    updates.dictationTranscript,
    updates.output,
    updates.status,
    updates.errorMessage,
    updates.flowType || null,
    sessionId
  )
}

export function deleteSession(id: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

function cleanupSessions(): void {
  // Delete sessions older than 24 hours
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  db.prepare('DELETE FROM sessions WHERE created_at < ?').run(cutoff)

  // Cap at 100 sessions
  const count = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c
  if (count > 100) {
    db.prepare(`
      DELETE FROM sessions WHERE id IN (
        SELECT id FROM sessions ORDER BY created_at ASC LIMIT ?
      )
    `).run(count - 100)
  }
}

export function clearAllSessions(): void {
  db.prepare('DELETE FROM sessions').run()
  console.log('[db] All sessions cleared')
}

export function closeDB(): void {
  if (db) db.close()
}
