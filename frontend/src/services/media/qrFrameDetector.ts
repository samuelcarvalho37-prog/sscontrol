export interface QrFrameDetector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>
}

interface NativeQrConstructor {
  new(options: { formats: string[] }): QrFrameDetector
  getSupportedFormats?: () => Promise<string[]>
}

export async function createQrFrameDetector(
  Native: NativeQrConstructor | undefined = (globalThis as typeof globalThis & { BarcodeDetector?: NativeQrConstructor }).BarcodeDetector,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): Promise<QrFrameDetector> {
  if (Native) {
    try {
      const formats = await Native.getSupportedFormats?.()
      if (!formats || formats.includes('qr_code')) return new Native({ formats: ['qr_code'] })
    } catch {
      // Some browsers expose the constructor without a usable QR implementation.
    }
  }
  const { BrowserQRCodeReader } = await import('@zxing/browser')
  const reader = new BrowserQRCodeReader()
  const canvas = createCanvas()
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Não foi possível preparar o leitor de QR. Use a consulta por código.')
  return {
    async detect(video) {
      if (!video.videoWidth || !video.videoHeight) return []
      const scale = Math.min(1, 960 / video.videoWidth)
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      try {
        return [{ rawValue: reader.decodeFromCanvas(canvas).getText() }]
      } catch (error) {
        if (error instanceof Error && ['NotFoundException', 'ChecksumException', 'FormatException'].includes(error.constructor.name)) return []
        throw error
      }
    },
  }
}
