import { Tray, Menu, nativeImage, NativeImage, app } from 'electron'
import { showMainWindow } from './windowManager'

let tray: Tray | null = null
let animTimer: ReturnType<typeof setInterval> | null = null
let animFrame = 0

// Pre-generated animation frames
let idleIcon: NativeImage | null = null
let dictationFrames: NativeImage[] = []
let instructionFrames: NativeImage[] = []

const ICON_SIZE = 18
const FRAME_COUNT = 8

/** Generate a circular icon with optional outer ring */
function generateIcon(
  coreR: number, coreG: number, coreB: number,
  ringOpacity: number, ringR: number, ringG: number, ringB: number
): NativeImage {
  const size = ICON_SIZE
  const buf = Buffer.alloc(size * size * 4)
  const center = size / 2
  const coreRadius = 4
  const ringRadius = 7

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center + 0.5
      const dy = y - center + 0.5
      const dist = Math.sqrt(dx * dx + dy * dy)
      const i = (y * size + x) * 4

      if (dist < coreRadius) {
        // Core dot
        buf[i] = coreR
        buf[i + 1] = coreG
        buf[i + 2] = coreB
        buf[i + 3] = 255
      } else if (dist < ringRadius && ringOpacity > 0) {
        // Outer ring with soft edge
        const edgeFade = Math.max(0, 1 - (dist - coreRadius - 1) / 2)
        const alpha = Math.round(ringOpacity * edgeFade * 255)
        buf[i] = ringR
        buf[i + 1] = ringG
        buf[i + 2] = ringB
        buf[i + 3] = alpha
      } else {
        buf[i + 3] = 0 // transparent
      }
    }
  }

  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

/** Generate pulse animation frames — ring opacity cycles sinusoidally */
function generatePulseFrames(
  coreR: number, coreG: number, coreB: number,
  ringR: number, ringG: number, ringB: number
): NativeImage[] {
  const frames: NativeImage[] = []
  for (let f = 0; f < FRAME_COUNT; f++) {
    const t = f / FRAME_COUNT
    const ringOpacity = 0.2 + 0.5 * Math.sin(t * Math.PI * 2) // 0.2 to 0.7
    frames.push(generateIcon(coreR, coreG, coreB, Math.max(0, ringOpacity), ringR, ringG, ringB))
  }
  return frames
}

export function createTray(): void {
  // Generate static idle icon (white dot, no ring) — monochrome design
  idleIcon = generateIcon(0xFF, 0xFF, 0xFF, 0, 0, 0, 0)

  // Generate animation frames — all monochrome
  // Dictation: white core, white ring pulse (softer)
  dictationFrames = generatePulseFrames(0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF)
  // Instruction: white core, white ring pulse (brighter)
  instructionFrames = generatePulseFrames(0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF)

  tray = new Tray(idleIcon)
  tray.setToolTip('unmute')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open unmute', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => showMainWindow())
}

/** Start pulsing animation on the tray icon */
export function setTrayRecording(mode: 'dictation' | 'instruction'): void {
  if (!tray) return

  stopTrayAnimation()

  const frames = mode === 'dictation' ? dictationFrames : instructionFrames
  animFrame = 0

  animTimer = setInterval(() => {
    if (!tray || frames.length === 0) return
    tray.setImage(frames[animFrame % frames.length])
    animFrame++
  }, 120) // ~8fps pulse
}

/** Stop animation and return to idle icon */
export function setTrayIdle(): void {
  stopTrayAnimation()
  if (tray && idleIcon) {
    tray.setImage(idleIcon)
  }
}

function stopTrayAnimation(): void {
  if (animTimer) {
    clearInterval(animTimer)
    animTimer = null
  }
  animFrame = 0
}

export function getTray(): Tray | null {
  return tray
}
