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

  // Run cleanup on init
  cleanupSessions()
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
