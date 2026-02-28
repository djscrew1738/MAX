// Set test environment variables before any module loads
process.env.NODE_ENV = 'test';
process.env.MAX_API_KEY = 'test-api-key';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test_max';
process.env.POSTGRES_PASSWORD = 'test-password';
process.env.ALLOWED_ORIGINS = 'http://localhost:3210,http://localhost:4000';
