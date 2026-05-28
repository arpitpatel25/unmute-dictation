const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const OUTPUT_DIR = path.resolve(__dirname, '../resources/bin')
const OUTPUT_BINARY = path.join(OUTPUT_DIR, 'llama-server')
const OUTPUT_LIB_DIR = path.join(OUTPUT_DIR, '..', 'lib')

// Only on macOS
if (process.platform !== 'darwin') {
  console.log('[llama] Skipping (not macOS)')
  process.exit(0)
}

// Ensure output directories exist
for (const dir of [OUTPUT_DIR, OUTPUT_LIB_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// Skip if binary already exists
if (fs.existsSync(OUTPUT_BINARY)) {
  console.log('[llama] Binary already exists, skipping')
  console.log('[llama] Delete resources/bin/llama-server to force re-fetch')
  process.exit(0)
}

console.log('[llama] Setting up llama-server binary...')

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

  // Remove existing file first (may be read-only from previous brew version)
  const destPath = path.join(OUTPUT_LIB_DIR, realName)
  try { fs.unlinkSync(destPath) } catch {}
  fs.copyFileSync(realPath, destPath)
  console.log('[llama] Copied:', realName)

  // Create symlink if the name differs
  if (realName !== name) {
    const linkPath = path.join(OUTPUT_LIB_DIR, name)
    try { fs.unlinkSync(linkPath) } catch {}
    fs.symlinkSync(realName, linkPath)
    console.log('[llama] Linked:', name, '->', realName)
  }

  return true
}

/**
 * Set up llama-server from a Homebrew installation.
 * Copies binary + all dylibs.
 */
function setupFromBrew(brewPrefix) {
  const brewBinary = path.join(brewPrefix, 'bin', 'llama-server')
  if (!fs.existsSync(brewBinary)) return false

  console.log('[llama] Found Homebrew llama-server:', brewBinary)

  // Copy the server binary
  fs.copyFileSync(brewBinary, OUTPUT_BINARY)
  fs.chmodSync(OUTPUT_BINARY, 0o755)

  // Find the actual lib directory
  const libExecDir = path.join(brewPrefix, 'libexec', 'lib')
  const libDir = fs.existsSync(libExecDir) ? libExecDir : path.join(brewPrefix, 'lib')

  // Copy all required dylibs
  const requiredLibs = [
    'libllama.dylib',
    'libmtmd.0.dylib',
    'libggml.0.dylib',
    'libggml-cpu.0.dylib',
    'libggml-metal.0.dylib',
    'libggml-base.0.dylib',
  ]

  for (const lib of requiredLibs) {
    copyDylib(libDir, lib)
  }

  // Also copy all dylib variants (versioned, soname, etc.) for completeness
  if (fs.existsSync(libDir)) {
    const allFiles = fs.readdirSync(libDir)
    const prefixes = ['libggml', 'libllama', 'libmtmd']
    for (const file of allFiles) {
      if (file.endsWith('.dylib') && prefixes.some(p => file.startsWith(p)) && !requiredLibs.includes(file)) {
        copyDylib(libDir, file)
      }
    }
  }

  console.log('[llama] rpath is @loader_path/../lib — libs are at resources/lib/ (correct)')
  return true
}

// Strategy 1: Check if llama.cpp is installed via Homebrew
try {
  const brewPrefix = execSync('brew --prefix llama.cpp 2>/dev/null', { encoding: 'utf-8' }).trim()
  if (setupFromBrew(brewPrefix)) {
    console.log('[llama] Setup successful (from Homebrew):', OUTPUT_BINARY)
    process.exit(0)
  }
} catch {
  // Homebrew not available or llama.cpp not installed
}

// Strategy 2: Install via Homebrew
try {
  console.log('[llama] Installing llama.cpp via Homebrew...')
  execSync('brew install llama.cpp', { stdio: 'inherit', timeout: 600000 })

  const brewPrefix = execSync('brew --prefix llama.cpp', { encoding: 'utf-8' }).trim()
  if (setupFromBrew(brewPrefix)) {
    console.log('[llama] Setup successful (installed via Homebrew):', OUTPUT_BINARY)
    process.exit(0)
  }
} catch (err) {
  console.error('[llama] Homebrew install failed:', err.message)
}

console.error('')
console.error('[llama] Could not set up llama-server. Try manually:')
console.error('  brew install llama.cpp')
console.error('  Then re-run: npm run compile:llama')
process.exit(1)
