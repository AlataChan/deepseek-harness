/** Configure and verify microphone usage metadata on a built macOS application. */
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Ensure the application declares microphone use before macOS authorizes capture.
 * @param {string} app - built application directory.
 * @param {boolean} apply - whether to add the declaration when absent.
 * @returns {void}
 */
export function checkDesktopMicrophone(app, apply = false) {
  const plist = join(resolve(app), 'Contents', 'Info.plist')
  const key = 'NSMicrophoneUsageDescription'
  let description = ''
  try {
    description = execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-expect', 'string', '-o', '-', plist], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    // An absent declaration is repaired only by the explicit assembly operation.
    if (!apply) throw new Error(`${key} is missing or is not a string: ${plist}`, { cause: error })
  }
  if (!description && apply) {
    const value = '小绿鲸需要使用麦克风进行语音输入，仅在你主动开始录音时采集声音。'
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (_error) {
      // Set refuses an absent key; Add still reports malformed or unwritable plists.
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist], { stdio: 'pipe' })
    }
    description = execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-expect', 'string', '-o', '-', plist], { encoding: 'utf8' }).trim()
  }
  if (!description) throw new Error(`${key} must not be empty: ${plist}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, app] = process.argv.slice(2)
    if (!app || !['--check', '--apply'].includes(mode)) throw new Error('Usage: node scripts/desktop-microphone.mjs --check|--apply application.app')
    checkDesktopMicrophone(app, mode === '--apply')
    console.log('Desktop microphone usage declaration verified')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
