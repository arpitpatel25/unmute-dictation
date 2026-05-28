const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const OUTPUT_DIR = path.resolve(__dirname, '../resources/bin')
const OUTPUT_BINARY = path.join(OUTPUT_DIR, 'whisper-cli')
const OUTPUT_SERVER = path.join(OUTPUT_DIR, 'whisper-server')
const OUTPUT_LIB_DIR = path.join(OUTPUT_DIR, '..', 'lib')

// Only on macOS
if (process.platform !== 'darwin') {
  console.log('[whisper] Skipping (not macOS)')
  process.exit(0)
}

// Ensure output directories exist
for (const dir of [OUTPUT_DIR, OUTPUT_LIB_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// Skip if both binaries already exist
if (fs.existsSync(OUTPUT_BINARY) && fs.existsSync(OUTPUT_SERVER)) {
  console.log('[whisper] Binaries already exist, skipping')
  console.log('[whisper] Delete resources/bin/whisper-cli to force re-fetch')
  process.exit(0)
}

console.log('[whisper] Setting up whisper-cli binary...')

/**
 * Copy a dylib from brew, resolving symlinks to get the actual file.
 * Creates both the versioned and unversioned copies.
 */
function copyDylib(srcDir, name) {
  const src = path.join(srcDir, name)
  if (!fs.existsSync(src)) return false

  // Resolve the symlink to get the real file
  const realPath = fs.realpathSync(src)
  const realName = path.basename(realPath)

  // Copy the actual file
  fs.copyFileSync(realPath, path.join(OUTPUT_LIB_DIR, realName))
  console.log('[whisper] Copied:', realName)

  // Create symlink if the name differs
  if (realName !== name) {
    const linkPath = path.join(OUTPUT_LIB_DIR, name)
    try { fs.unlinkSync(linkPath) } catch {}
    fs.symlinkSync(realName, linkPath)
    console.log('[whisper] Linked:', name, '->', realName)
  }

  return true
}

/**
 * Set up whisper-cli from a Homebrew installation.
 * Copies binary + all dylibs, then patches rpath.
 */
function setupFromBrew(brewPrefix) {
  const brewBinary = path.join(brewPrefix, 'bin', 'whisper-cli')
  const brewServer = path.join(brewPrefix, 'bin', 'whisper-server')
  if (!fs.existsSync(brewBinary)) return false

  console.log('[whisper] Found Homebrew whisper-cli:', brewBinary)

  // Copy the CLI binary
  fs.copyFileSync(brewBinary, OUTPUT_BINARY)
  fs.chmodSync(OUTPUT_BINARY, 0o755)

  // Copy the server binary
  if (fs.existsSync(brewServer)) {
    fs.copyFileSync(brewServer, OUTPUT_SERVER)
    fs.chmodSync(OUTPUT_SERVER, 0o755)
    console.log('[whisper] Copied whisper-server:', OUTPUT_SERVER)
  } else {
    console.warn('[whisper] whisper-server not found in Homebrew, will fall back to whisper-cli')
  }

  // Find the actual lib directory (libexec/lib has the real files)
  const libExecDir = path.join(brewPrefix, 'libexec', 'lib')
  const libDir = fs.existsSync(libExecDir) ? libExecDir : path.join(brewPrefix, 'lib')

  // Copy all required dylibs
  const requiredLibs = [
    'libwhisper.1.dylib',
    'libggml.0.dylib',
    'libggml-cpu.0.dylib',
    'libggml-blas.0.dylib',
    'libggml-metal.0.dylib',
    'libggml-base.0.dylib',
  ]

  for (const lib of requiredLibs) {
    copyDylib(libDir, lib)
  }

  // Patch rpath: change @rpath/../lib to @loader_path/../lib
  // The binary already has @loader_path/../lib, so just make sure our lib dir is at the right relative path
  // Binary is at resources/bin/whisper-cli, libs at resources/lib/ — so ../lib is correct!
  console.log('[whisper] rpath is @loader_path/../lib — libs are at resources/lib/ (correct)')

  return true
}

// Strategy 1: Check if whisper-cpp is installed via Homebrew
try {
  const brewPrefix = execSync('brew --prefix whisper-cpp 2>/dev/null', { encoding: 'utf-8' }).trim()
  if (setupFromBrew(brewPrefix)) {
    console.log('[whisper] Setup successful (from Homebrew):', OUTPUT_BINARY)
    process.exit(0)
  }
} catch {
  // Homebrew not available or whisper-cpp not installed
}

// Strategy 2: Install via Homebrew
try {
  console.log('[whisper] Installing whisper-cpp via Homebrew...')
  execSync('brew install whisper-cpp', { stdio: 'inherit', timeout: 300000 })

  const brewPrefix = execSync('brew --prefix whisper-cpp', { encoding: 'utf-8' }).trim()
  if (setupFromBrew(brewPrefix)) {
    console.log('[whisper] Setup successful (installed via Homebrew):', OUTPUT_BINARY)
    process.exit(0)
  }
} catch (err) {
  console.error('[whisper] Homebrew install failed:', err.message)
}

console.error('')
console.error('[whisper] Could not set up whisper-cli. Try manually:')
console.error('  brew install whisper-cpp')
console.error('  Then re-run: npm run compile:whisper')
process.exit(1)
