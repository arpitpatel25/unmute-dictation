/**
 * Feature flags.
 *
 * features.localModels gates the optional offline path (whisper.cpp / local LLM).
 * Defaults to false so the app runs cloud-only (Groq) out of the box; a future
 * setting can flip it on. All guard sites check features.localModels at runtime.
 */

export const features = {
  localModels: false,
}

/**
 * Update feature flags from the server config response.
 * Called after every successful config fetch in refreshServerConfig().
 */
export function updateFeaturesFromConfig(config: { devFeatures?: { localModels: boolean } }): void {
  const prev = features.localModels
  features.localModels = config.devFeatures?.localModels ?? false
  if (features.localModels !== prev) {
    console.log(`[features] localModels: ${prev} → ${features.localModels}`)
  }
}
