// ─── User-Facing Error Simplification ───
// Maps raw backend/API errors to simple, non-technical messages.
// Raw errors are still logged to console and Developer error log.

export function simplifyError(rawError: string): string {
  const lower = rawError.toLowerCase()

  // Auth / token errors
  if (lower.includes('not authenticated') || lower.includes('auth') || lower.includes('token') || lower.includes('unauthorized') || lower.includes('401')) {
    return 'Session expired. Please sign in again.'
  }

  // Rate limit / usage limit
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('limit reached') || lower.includes('usage limit') || lower.includes('daily limit')) {
    return 'Usage limit reached. Try again later.'
  }

  // Transcription / audio issues
  if (lower.includes('transcription failed') || lower.includes('whisper') || lower.includes('no audio')) {
    return "Couldn't process audio. Try again."
  }

  // Network / connection errors
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('econnrefused') || lower.includes('timeout') || lower.includes('enotfound') || lower.includes('socket')) {
    return 'Connection error. Check your internet.'
  }

  // API / server errors
  if (lower.includes('api error') || lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('internal server error') || lower.includes('service unavailable')) {
    return 'Service temporarily unavailable. Try again.'
  }

  // Configuration errors
  if (lower.includes('not configured') || lower.includes('url not configured') || lower.includes('no api key')) {
    return 'Service not configured. Check settings.'
  }

  // Mic errors
  if (lower.includes('mic') || lower.includes('microphone') || lower.includes('notallowederror') || lower.includes('permission')) {
    return 'Mic error. Check system permissions.'
  }

  // Default fallback
  return 'Something went wrong. Try again.'
}
