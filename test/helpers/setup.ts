// Test environment defaults. Integration tests use the real DB at DATABASE_URL
// (defaulting to the local disbursement Postgres instance).
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/disbursement";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-0123456789abcdef0123456789";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-0123456789abcdef0123456789";
process.env.JWT_ACCESS_TTL ??= "15m";
process.env.JWT_REFRESH_TTL ??= "7d";
process.env.LOG_LEVEL = "silent";
