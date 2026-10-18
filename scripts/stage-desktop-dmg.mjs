#!/usr/bin/env node
/** Stage the exact mode-specific DMG shipping tree; refuse stale nonempty destinations. */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const [mode, source, output] = process.argv.slice(2)
if ((mode !== 'internal' && mode !== 'public') || !source || !output) throw new Error('Expected <internal|public> <app> <empty-output>')
const destination = resolve(output)
if (existsSync(destination) && readdirSync(destination).length !== 0) throw new Error('DMG staging destination must be empty')
const payload = join(dirname(fileURLToPath(import.meta.url)), 'dmg-payload')
mkdirSync(destination, { recursive: true })
cpSync(resolve(source), join(destination, 'octopus_DSH.app'), { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
copyFileSync(join(payload, mode === 'public' ? 'public-installation.txt' : '安装说明.txt'), join(destination, '安装说明.txt'))
if (mode === 'internal') copyFileSync(join(payload, '安装并打开.command'), join(destination, '安装并打开.command'))
