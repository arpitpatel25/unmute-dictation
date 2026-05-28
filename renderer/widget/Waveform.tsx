import { useRef, useEffect } from 'react'

interface WaveformProps {
  analyserNode: AnalyserNode | null
  color?: string
  width?: number
  height?: number
}

export default function Waveform({
  analyserNode,
  color = 'rgba(255, 255, 255, 0.75)',
  width = 80,
  height = 20
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const smoothedRef = useRef<Float32Array | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !analyserNode) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    const bufferLength = analyserNode.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    // Compact: fewer bars for small widths
    const barCount = Math.max(12, Math.round(width / 4))
    const barGap = 1.5
    const barWidth = (width - (barCount - 1) * barGap) / barCount
    const minBarHeight = 1.5
    const smoothing = 0.70

    if (!smoothedRef.current || smoothedRef.current.length !== barCount) {
      smoothedRef.current = new Float32Array(barCount).fill(0)
    }

    function draw() {
      animFrameRef.current = requestAnimationFrame(draw)
      analyserNode!.getByteFrequencyData(dataArray)

      ctx!.clearRect(0, 0, width, height)

      for (let i = 0; i < barCount; i++) {
        const binIndex = Math.floor(Math.pow(i / barCount, 1.3) * bufferLength)
        const rawValue = dataArray[binIndex] / 255

        smoothedRef.current![i] = smoothedRef.current![i] * smoothing + rawValue * (1 - smoothing)
        const value = smoothedRef.current![i]

        const barHeight = Math.max(minBarHeight, value * height * 0.9)
        const x = i * (barWidth + barGap)
        const y = (height - barHeight) / 2

        // Center bars brighter, edges dimmer
        const centerFactor = 1 - Math.abs((i / barCount) - 0.5) * 0.6
        const opacity = (0.3 + value * 0.7) * centerFactor
        ctx!.globalAlpha = opacity
        ctx!.fillStyle = color
        ctx!.beginPath()
        ctx!.roundRect(x, y, barWidth, barHeight, barWidth / 2)
        ctx!.fill()
      }
      ctx!.globalAlpha = 1
    }

    draw()

    return () => {
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [analyserNode, color, width, height])

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block' }}
    />
  )
}
