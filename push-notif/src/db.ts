import postgres from 'postgres'

export function getSql(hyperdrive: Hyperdrive) {
  return postgres(hyperdrive.connectionString, { prepare: false })
}
