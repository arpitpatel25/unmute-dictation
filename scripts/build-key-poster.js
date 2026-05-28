const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const SWIFT_SOURCE = path.resolve(__dirname, '../native/macos/key-poster.swift')
const OUTPUT_DIR = path.resolve(__dirname, '../resources/bin')
const OUTPUT_BINARY = path.join(OUTPUT_DIR, 'key-poster')

// Only compile on macOS
if (process.platform !== 'darwin') {
  console.log('[key-poster] Skipping compilation (not macOS)')
  process.exit(0)
}

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

// Skip if binary already exists and source hasn't changed
if (fs.existsSync(OUTPUT_BINARY)) {
  const srcStat = fs.statSync(SWIFT_SOURCE)
  const binStat = fs.statSync(OUTPUT_BINARY)
  if (binStat.mtime > srcStat.mtime) {
    console.log('[key-poster] Binary is up to date, skipping compilation')
    process.exit(0)
  }
}

console.log('[key-poster] Compiling Swift binary...')

try {
  execSync(
    `swiftc -O -o "${OUTPUT_BINARY}" "${SWIFT_SOURCE}" -framework CoreGraphics -framework Foundation`,
    { stdio: 'inherit' }
  )
  // Make executable
  fs.chmodSync(OUTPUT_BINARY, 0o755)
  console.log('[key-poster] Compilation successful:', OUTPUT_BINARY)
} catch (error) {
  console.error('[key-poster] Compilation failed:', error.message)
  console.error('[key-poster] Make sure Xcode Command Line Tools are installed: xcode-select --install')
  process.exit(1)
}
