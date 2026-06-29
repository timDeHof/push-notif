import { readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', 'migrations')

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('ERROR: Set DATABASE_URL to your Postgres connection string (Neon direct, not Hyperdrive).')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString })

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        applied_at  TIMESTAMPTZ DEFAULT now()
      )
    `)

    const { rows: applied } = await client.query('SELECT name FROM _migrations ORDER BY name')
    const appliedSet = new Set(applied.map((r) => r.name))

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  SKIP ${file} (already applied)`)
        continue
      }
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
      console.log(`  APPLY ${file}`)
      await client.query(sql)
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file])
      console.log(`  DONE  ${file}`)
    }

    await client.query('COMMIT')
    console.log('\nMigration complete.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Migration failed:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()
