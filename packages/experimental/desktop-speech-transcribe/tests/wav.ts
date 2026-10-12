/** PCM WAV fixtures shared by the desktop-speech-transcribe specs. */

/** One chunk of a synthetic RIFF/WAVE container. */
export interface WaveChunk {
  /** Four-character chunk id. */
  readonly id: string
  /** Raw chunk body; the container builder pads an odd body. */
  readonly body: Buffer
}

/**
 * Build a PCM16 WAV of the given duration and format fields.
 * @param seconds - audio duration in seconds.
 * @param options - sample rate and channel overrides; defaults are the canonical 16 kHz mono.
 * @returns complete WAV bytes.
 */
export function wave(seconds: number, options: { sampleRate?: number; channels?: number } = {}): Buffer {
  const sampleRate = options.sampleRate ?? 16_000
  const channels = options.channels ?? 1
  const blockAlign = channels * 2
  const dataBytes = Math.round(seconds * sampleRate) * blockAlign
  return riffWave([
    { id: 'fmt ', body: pcmFmtBody(false, { sampleRate, channels }) },
    { id: 'data', body: Buffer.alloc(dataBytes) },
  ])
}

/**
 * Assemble one RIFF/WAVE container from explicit chunks.
 * @param chunks - chunk list in file order; odd bodies gain their pad byte.
 * @returns complete container bytes.
 */
export function riffWave(chunks: readonly WaveChunk[]): Buffer {
  const bodies = chunks.map(({ body }) => Buffer.concat([body, Buffer.alloc(body.byteLength % 2)]))
  const size = 4 + bodies.reduce((total, body) => total + 8 + body.byteLength, 0)
  const head = Buffer.alloc(12)
  head.write('RIFF', 0, 'ascii')
  head.writeUInt32LE(size, 4)
  head.write('WAVE', 8, 'ascii')
  const parts = chunks.flatMap((chunk, index) => {
    const header = Buffer.alloc(8)
    header.write(chunk.id, 0, 'ascii')
    header.writeUInt32LE(chunk.body.byteLength, 4)
    return [header, bodies[index] as Buffer]
  })
  return Buffer.concat([head, ...parts])
}

/**
 * Build a `fmt ` chunk body for 16 kHz mono PCM16: the canonical 16-byte PCM
 * layout, or the 40-byte WAVE_FORMAT_EXTENSIBLE layout real `afconvert`
 * builds.
 * @param extensible - emit the extensible header whose sub-format GUID selects PCM.
 * @param options - sample rate and channel overrides; defaults are 16 kHz mono.
 * @returns the `fmt ` chunk body.
 */
export function pcmFmtBody(
  extensible: boolean,
  options: { sampleRate?: number; channels?: number } = {},
): Buffer {
  const sampleRate = options.sampleRate ?? 16_000
  const channels = options.channels ?? 1
  const blockAlign = channels * 2
  const body = Buffer.alloc(extensible ? 40 : 16)
  body.writeUInt16LE(extensible ? 0xfffe : 0x0001, 0)
  body.writeUInt16LE(channels, 2)
  body.writeUInt32LE(sampleRate, 4)
  body.writeUInt32LE(sampleRate * blockAlign, 8)
  body.writeUInt16LE(blockAlign, 12)
  body.writeUInt16LE(16, 14)
  if (extensible) {
    body.writeUInt16LE(22, 16)
    body.writeUInt16LE(16, 18)
    body.writeUInt32LE(0, 20)
    // KSDATAFORMAT_SUBTYPE_PCM: Data1 1, Data2 0, Data3 0x0010, then the base UUID tail.
    body.writeUInt32LE(0x0001, 24)
    body.writeUInt16LE(0, 28)
    body.writeUInt16LE(0x0010, 30)
    body.set([0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], 32)
  }
  return body
}

/** Bytes that are not a canonical WAV, standing in for m4a/mp3 input. */
export function compressedAudio(): Buffer {
  return Buffer.concat([Buffer.from('ftypM4A '), Buffer.alloc(64, 7)])
}
