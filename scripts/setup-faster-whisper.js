#!/usr/bin/env node
/**
 * Setup script for faster-whisper Python environment.
 *
 * Creates a Python virtual environment in resources/faster-whisper/venv/
 * and installs the faster-whisper package.
 *
 * Usage: node scripts/setup-faster-whisper.js
 * Or:    npm run setup:faster-whisper
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const VENV_DIR = path.resolve(__dirname, '..', 'resources', 'faster-whisper', 'venv')
const PYTHON_VENV = path.join(VENV_DIR, 'bin', 'python3')

function run(cmd, opts = {}) {
  console.log(`[faster-whisper-setup] Running: ${cmd}`)
  execSync(cmd, { stdio: 'inherit', timeout: 600_000, ...opts })
}

function main() {
  console.log('[faster-whisper-setup] Setting up faster-whisper...')
  console.log('[faster-whisper-setup] Venv dir:', VENV_DIR)

  // Step 1: Check system Python
  try {
    const version = execSync('python3 --version', { encoding: 'utf-8' }).trim()
    console.log('[faster-whisper-setup] System Python:', version)
  } catch {
    console.error('[faster-whisper-setup] ERROR: python3 not found. Please install Python 3.8+')
    process.exit(1)
  }

  // Step 2: Create venv if it doesn't exist
  if (!fs.existsSync(PYTHON_VENV)) {
    console.log('[faster-whisper-setup] Creating virtual environment...')
    run(`python3 -m venv "${VENV_DIR}"`)
  } else {
    console.log('[faster-whisper-setup] Venv already exists')
  }

  // Step 3: Check if faster-whisper is already installed
  try {
    execSync(`"${PYTHON_VENV}" -c "import faster_whisper; print(faster_whisper.__version__)"`, {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: 'pipe',
    })
    console.log('[faster-whisper-setup] faster-whisper already installed, skipping pip install')
  } catch {
    // Step 4: Install faster-whisper
    console.log('[faster-whisper-setup] Installing faster-whisper (this may take a minute)...')
    run(`"${PYTHON_VENV}" -m pip install --upgrade pip`, { stdio: 'pipe' })
    run(`"${PYTHON_VENV}" -m pip install faster-whisper`)
  }

  // Step 5: Verify installation
  try {
    const output = execSync(
      `"${PYTHON_VENV}" -c "from faster_whisper import WhisperModel; print('OK')"`,
      { encoding: 'utf-8', timeout: 15_000, stdio: 'pipe' }
    ).trim()

    if (output.includes('OK')) {
      console.log('[faster-whisper-setup] Installation verified successfully!')
    } else {
      throw new Error('Unexpected output: ' + output)
    }
  } catch (err) {
    console.error('[faster-whisper-setup] ERROR: Verification failed:', err.message)
    process.exit(1)
  }

  console.log('[faster-whisper-setup] Done!')
}

main()
