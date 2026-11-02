import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { QRCodeWriter, BarcodeFormat } from '@zxing/library'

const vite = await createServer({ configFile: false, root: import.meta.dirname, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } })
test.after(() => vite.close())
const { createQrFrameDetector } = await vite.ssrLoadModule('/src/services/media/qrFrameDetector.ts')

test('usa o leitor nativo quando QR e suportado', async () => {
  class Native {
    static async getSupportedFormats() { return ['qr_code'] }
    constructor(options) { assert.deepEqual(options.formats, ['qr_code']) }
    async detect() { return [{ rawValue: 'EQ-BOM-001' }] }
  }
  const detector = await createQrFrameDetector(Native, () => { throw Error('Nao deve criar canvas') })
  assert.equal((await detector.detect({}))[0].rawValue, 'EQ-BOM-001')
})

function canvasFor(text) {
  const size = 240
  const matrix = text ? new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, new Map()) : null
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const value = matrix?.get(x, y) ? 0 : 255
    const i = (y * size + x) * 4
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value
  }
  return { width: size, height: size, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }
}

test('decodifica QR real sem BarcodeDetector, como alternativa para Safari', async () => {
  const detector = await createQrFrameDetector(undefined, () => canvasFor('EQ-ENV-01'))
  assert.equal((await detector.detect({ videoWidth: 240, videoHeight: 240 }))[0].rawValue, 'EQ-ENV-01')
})

test('API nativa sem suporte a QR usa alternativa e quadro vazio nao e erro', async () => {
  class Unsupported { static async getSupportedFormats() { return ['ean_13'] } }
  const detector = await createQrFrameDetector(Unsupported, () => canvasFor(null))
  assert.deepEqual(await detector.detect({ videoWidth: 240, videoHeight: 240 }), [])
  assert.deepEqual(await detector.detect({ videoWidth: 0, videoHeight: 0 }), [])
})
