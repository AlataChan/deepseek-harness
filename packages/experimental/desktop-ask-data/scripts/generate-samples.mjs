import { readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import ExcelJS from 'exceljs'

const dir = dirname(fileURLToPath(import.meta.url))
const samples = join(dir, '..', 'samples')
const csvPath = join(samples, 'sample-sales.csv')
const xlsxPath = join(samples, 'sample-sales.xlsx')
const sqlitePath = join(samples, 'sample-sales.sqlite')

const csv = await readFile(csvPath, 'utf8')
const rows = csv.trim().split('\n').map(line => line.split(','))
const header = rows[0]
const data = rows.slice(1)

const wb = new ExcelJS.Workbook()
const sheet = wb.addWorksheet('销售明细')
sheet.addRow(header)
for (const row of data) sheet.addRow(row)
await writeFile(xlsxPath, Buffer.from(await wb.xlsx.writeBuffer()))

try {
  await unlink(sqlitePath)
} catch (error) {
  // First generation has no sqlite yet; later runs replace it.
  if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') throw error
}

const sql = [
  'PRAGMA journal_mode=DELETE;',
  'CREATE TABLE "销售明细" ("日期" TEXT, "渠道" TEXT, "商品" TEXT, "数量" TEXT, "金额" TEXT);',
  ...data.map(row => `INSERT INTO "销售明细" VALUES (${row.map(v => `'${v.replaceAll("'", "''")}'`).join(', ')});`),
].join('\n')

await new Promise((resolve, reject) => {
  const child = spawn('sqlite3', [sqlitePath], { stdio: ['pipe', 'inherit', 'inherit'] })
  child.on('error', reject)
  child.on('close', code => (code === 0 ? resolve() : reject(new Error(`sqlite3 ${code}`))))
  child.stdin.end(`${sql}\n`)
})

console.log('wrote', xlsxPath, 'and', sqlitePath)
