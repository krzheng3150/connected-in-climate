// Imported (via test-db.js) BEFORE ./db.js so tests can never touch a non-test database.
// Resolves DATABASE_URL_TEST (falling back to DATABASE_URL) and refuses to run unless
// the database name ends in "_test".
const url = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL
if (!url) {
  throw new Error('Set DATABASE_URL_TEST (e.g. postgres://postgres:postgres@localhost:5432/connected_in_climate_test)')
}
const dbName = new URL(url).pathname.replace(/^\//, '')
if (!dbName.endsWith('_test')) {
  throw new Error(
    `Refusing to run tests against database "${dbName}": name must end in "_test". `
    + 'Set DATABASE_URL_TEST to a dedicated test database.',
  )
}
process.env.DATABASE_URL = url

// clerkMiddleware() throws on every request without keys (CI has none). Dummy values are
// enough: tests authenticate via the x-user-email dev fallback, and Clerk makes no network
// call when there is no session token.
process.env.CLERK_PUBLISHABLE_KEY ||= 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k'
process.env.CLERK_SECRET_KEY ||= 'sk_test_dummy'
