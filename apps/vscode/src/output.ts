/** Redacted extension Output channel adapter. */

const MAX_LOG_CHARS = 8_192

/** Minimal VS Code OutputChannel surface. */
export interface OutputChannelLike {
  /** Append one complete line. */
  appendLine(value: string): void
  /** Reveal the channel. */
  show(preserveFocus?: boolean): void
  /** Release the channel. */
  dispose(): void
}

/** Redact credential-shaped values and bound one emitted line. */
export function redactRuntimeLog(value: string): string {
  const redacted = value
    .replaceAll('\r', '')
    .replaceAll('\0', '')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\b((?:[A-Z][A-Z0-9_]*_)?(?:KEY|TOKEN|SECRET|PASSWORD)=)[^\s]+/g, '$1[REDACTED]')
    .replace(/\b(Bearer\s+)[a-z0-9._~+/=-]+/gi, '$1[REDACTED]')
  return redacted.length <= MAX_LOG_CHARS ? redacted : `${redacted.slice(0, MAX_LOG_CHARS)}…`
}

/** Extension-owned redacted log with no protocol or context payload logging API. */
export class RuntimeOutput {
  /** @param channel - VS Code OutputChannel created during lazy activation. */
  constructor(private readonly channel: OutputChannelLike) {}

  /** Append redacted process output one line at a time. */
  appendProcessChunk(source: 'stdout' | 'stderr', chunk: string): void {
    for (const line of chunk.split('\n')) {
      if (line === '') continue
      this.channel.appendLine(`[${source}] ${redactRuntimeLog(line)}`)
    }
  }

  /** Append an extension-owned lifecycle diagnostic. */
  appendDiagnostic(message: string): void {
    this.channel.appendLine(`[extension] ${redactRuntimeLog(message)}`)
  }

  /** Reveal the redacted channel without stealing editor focus. */
  show(): void { this.channel.show(true) }

  /** Release the channel. */
  dispose(): void { this.channel.dispose() }
}
