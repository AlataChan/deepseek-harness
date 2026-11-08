import * as fs from 'node:fs'
import { createHash } from 'node:crypto'
import { RUNTIME_LOCK_ID,RUNTIME_MANIFEST_DIGEST } from '../src/runtime-lock.ts'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  INSTALLATION_RECORD_SCHEMA_VERSION,
  type InstallationRecord,
  readInstallationRecord,
  validateInstallationRecord,
  writeInstallationRecordAtomic,
} from '../src/installation-record.ts'

describe('Installation Record Persistence', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-reach-record-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('atomically writes and reads an installation record', () => {
    const recordFile = path.join(tempDir, 'release', 'installation-record.json')
    const sampleRecord: InstallationRecord = {
      schemaVersion: INSTALLATION_RECORD_SCHEMA_VERSION,
      lockId: RUNTIME_LOCK_ID,
      manifestDigest:RUNTIME_MANIFEST_DIGEST,
      upstreamRevision: 'c70ae6da5d39bc90e09ad2ae0575ccc89f31e284',
      installedAt: new Date().toISOString(),
      releaseRoot: path.join(tempDir, 'release'),
      coreVenvPath: path.join(tempDir, 'release', 'core'),
      toolVenvPath: path.join(tempDir, 'release', 'tools'),
      tools: {
        'agent-reach': { version:'1.6.1',digest:createHash('sha256').update('core-fixture').digest('hex'),
          executablePath:path.join(tempDir,'release','core',process.platform === 'win32' ? 'Scripts' : 'bin',process.platform === 'win32' ? 'agent-reach.exe' : 'agent-reach'),installedAt:new Date().toISOString() },
        'bili-cli': {
          version: '0.6.2',
          digest:createHash('sha256').update('fixture').digest('hex'),
          executablePath: path.join(tempDir, 'release', 'tools', 'bin', 'bili-cli'),
          installedAt: new Date().toISOString(),
        },
      },
    }

    fs.mkdirSync(sampleRecord.coreVenvPath, { recursive:true })
    fs.mkdirSync(sampleRecord.toolVenvPath!, { recursive:true })
    fs.mkdirSync(path.dirname(sampleRecord.tools['bili-cli']!.executablePath), { recursive:true })
    fs.writeFileSync(sampleRecord.tools['bili-cli']!.executablePath,'fixture')
    fs.mkdirSync(path.dirname(sampleRecord.tools['agent-reach']!.executablePath),{ recursive:true })
    fs.writeFileSync(sampleRecord.tools['agent-reach']!.executablePath,'core-fixture')
    writeInstallationRecordAtomic(recordFile, sampleRecord)
    expect(fs.existsSync(recordFile)).toBe(true)

    // Verify file permissions on POSIX
    if (process.platform !== 'win32') {
      const stat = fs.statSync(recordFile)
      expect(stat.mode & 0o777).toBe(0o600)
    }

    const read = readInstallationRecord(recordFile)
    expect(read).not.toBeNull()
    expect(read?.schemaVersion).toBe(INSTALLATION_RECORD_SCHEMA_VERSION)
    expect(read?.lockId).toBe(RUNTIME_LOCK_ID)
    expect(read?.tools['bili-cli']?.version).toBe('0.6.2')
    const core = sampleRecord.tools['agent-reach']!
    fs.writeFileSync(core.executablePath,'tampered')
    expect(readInstallationRecord(recordFile)).toBeNull()
    fs.writeFileSync(core.executablePath,'core-fixture')
    writeInstallationRecordAtomic(recordFile,{ ...sampleRecord,tools:{} })
    expect(readInstallationRecord(recordFile)).toBeNull()
    writeInstallationRecordAtomic(recordFile,sampleRecord)
    fs.writeFileSync(recordFile,JSON.stringify({ ...sampleRecord,releaseRoot:tempDir }))
    expect(readInstallationRecord(recordFile)).toBeNull()
    fs.writeFileSync(recordFile,'{broken')
    expect(readInstallationRecord(recordFile)).toBeNull()
  })

  it('rejects corrupt or unsupported schema versions', () => {
    expect(() =>
      validateInstallationRecord({
        schemaVersion: 999,
        lockId: 'abc',
        upstreamRevision: 'rev',
        releaseRoot: '/tmp',
        coreVenvPath: '/tmp/core',
      }),
    ).toThrow(/Unsupported installation record schema version/)

    expect(() =>
      validateInstallationRecord({
        schemaVersion: INSTALLATION_RECORD_SCHEMA_VERSION,
        lockId: 'abc',
        // missing upstreamRevision
      }),
    ).toThrow(/missing required path or identification strings/)
  })

  it('returns null when reading non-existent file', () => {
    const read = readInstallationRecord(path.join(tempDir, 'missing.json'))
    expect(read).toBeNull()
  })
})

it('rejects malformed durable identity, timestamps, tools and escaping paths',()=>{
  const root=path.resolve(os.tmpdir(),'reach-record-validation')
  const base={ schemaVersion:1,manifestDigest:RUNTIME_MANIFEST_DIGEST,lockId:RUNTIME_LOCK_ID,
    upstreamRevision:'c70ae6da5d39bc90e09ad2ae0575ccc89f31e284',installedAt:'2026-11-07T00:00:00.000Z',releaseRoot:root,
    coreVenvPath:path.join(root,'core'),tools:{} }
  const tool={ version:'1',executablePath:path.join(root,'core/bin/tool'),digest:'0'.repeat(64),installedAt:base.installedAt }
  for(const raw of [null,[],12,
    { ...base,upstreamRevision:'bad' }, { ...base,manifestDigest:'0'.repeat(64) }, { ...base,installedAt:'yesterday' },
    { ...base,coreVenvPath:'relative' }, { ...base,coreVenvPath:root }, { ...base,coreVenvPath:path.resolve(root,'../outside') },
    { ...base,toolVenvPath:'relative' }, { ...base,tools:[] }, { ...base,tools:{ bad:null } },
    { ...base,tools:{ bad:[] } }, { ...base,tools:{ bad:{ ...tool,version:'' } } },
    { ...base,tools:{ bad:{ ...tool,digest:'unverified' } } }, { ...base,tools:{ bad:{ ...tool,installedAt:'bad' } } },
    { ...base,tools:{ bad:{ ...tool,executablePath:'relative' } } },
  ]) expect(()=>validateInstallationRecord(raw)).toThrow()
  expect(validateInstallationRecord(base).coreVenvPath).toBe(base.coreVenvPath)
})
it.skipIf(process.platform==='win32')('rejects an owned-looking executable that resolves outside its runtime',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reach-record-link-'))
  try{
    const release=path.join(root,'release')
    const core=path.join(release,'core')
    const executable=path.join(core,'bin/agent-reach')
    fs.mkdirSync(path.dirname(executable),{ recursive:true })
    const external=path.join(root,'external')
    fs.writeFileSync(external,'fixture')
    fs.symlinkSync(external,executable)
    const record:InstallationRecord={ schemaVersion:1,manifestDigest:RUNTIME_MANIFEST_DIGEST,lockId:RUNTIME_LOCK_ID,
      upstreamRevision:'c70ae6da5d39bc90e09ad2ae0575ccc89f31e284',installedAt:'2026-11-07T00:00:00.000Z',releaseRoot:release,coreVenvPath:core,
      tools:{ 'agent-reach':{ version:'1.6.1',executablePath:executable,digest:createHash('sha256').update('fixture').digest('hex'),installedAt:'2026-11-07T00:00:00.000Z' } } }
    const file=path.join(release,'installation-record.json')
    writeInstallationRecordAtomic(file,record)
    expect(readInstallationRecord(file)).toBeNull()
    expect(fs.readFileSync(external,'utf8')).toBe('fixture')
  }finally{fs.rmSync(root,{ recursive:true,force:true })}
})

it('creates the record directory atomically without treating incomplete paths as a usable runtime',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reach-record-new-'))
  try{
    const release=path.join(root,'release')
    const file=path.join(release,'installation-record.json')
    writeInstallationRecordAtomic(file,{ schemaVersion:1,manifestDigest:RUNTIME_MANIFEST_DIGEST,lockId:RUNTIME_LOCK_ID,
      upstreamRevision:'c70ae6da5d39bc90e09ad2ae0575ccc89f31e284',installedAt:'2026-11-07T00:00:00.000Z',releaseRoot:release,coreVenvPath:path.join(release,'core'),tools:{} })
    expect(fs.existsSync(file)).toBe(true)
    expect(readInstallationRecord(file)).toBeNull()
  }finally{fs.rmSync(root,{ recursive:true,force:true })}
})
it.skipIf(process.platform==='win32')('refuses a runtime directory symlinked outside its owner',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reach-record-dirlink-'))
  try{
    const release=path.join(root,'release')
    const outside=path.join(root,'outside')
    const core=path.join(release,'core')
    fs.mkdirSync(release);fs.mkdirSync(outside)
    fs.symlinkSync(outside,core,'dir')
    const file=path.join(release,'installation-record.json')
    writeInstallationRecordAtomic(file,{ schemaVersion:1,manifestDigest:RUNTIME_MANIFEST_DIGEST,lockId:RUNTIME_LOCK_ID,
      upstreamRevision:'c70ae6da5d39bc90e09ad2ae0575ccc89f31e284',installedAt:'2026-11-07T00:00:00.000Z',releaseRoot:release,coreVenvPath:core,tools:{} })
    expect(readInstallationRecord(file)).toBeNull()
    expect(fs.existsSync(outside)).toBe(true)
  }finally{fs.rmSync(root,{ recursive:true,force:true })}
})
it('recognizes the Windows-named launcher in a durable record without qualifying Windows execution',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reach-record-winlayout-'))
  const descriptor=Object.getOwnPropertyDescriptor(process,'platform')
  if(!descriptor)throw new Error('No platform descriptor')
  try{
    const core=path.join(root,'core')
    const executable=path.join(core,'Scripts/agent-reach.exe')
    fs.mkdirSync(path.dirname(executable),{ recursive:true });fs.writeFileSync(executable,'fixture')
    const file=path.join(root,'installation-record.json')
    writeInstallationRecordAtomic(file,{ schemaVersion:1,manifestDigest:RUNTIME_MANIFEST_DIGEST,lockId:RUNTIME_LOCK_ID,
      upstreamRevision:'c70ae6da5d39bc90e09ad2ae0575ccc89f31e284',installedAt:'2026-11-07T00:00:00.000Z',releaseRoot:root,coreVenvPath:core,
      tools:{ 'agent-reach':{ version:'1.6.1',executablePath:executable,digest:createHash('sha256').update('fixture').digest('hex'),installedAt:'2026-11-07T00:00:00.000Z' } } })
    Object.defineProperty(process,'platform',{ ...descriptor,value:'win32' })
    expect(readInstallationRecord(file)?.coreVenvPath).toBe(core)
  }finally{Object.defineProperty(process,'platform',descriptor);fs.rmSync(root,{ recursive:true,force:true })}
})
