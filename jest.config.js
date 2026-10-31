/** @type {import('jest').Config} */
module.exports = {
  // Use ts-jest to transform TypeScript files without a separate build step
  preset: 'ts-jest',

  // Node environment (not jsdom — this is a backend service)
  testEnvironment: 'node',

  // Where to find tests
  testMatch: ['**/tests/**/*.test.ts'],

  // Map the @/ path alias so Jest resolves imports identically to tsc
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // Run tests serially (--runInBand) to avoid database race conditions
  // This is set via the CLI flag in package.json scripts

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',     // Entry point — no logic to cover
    '!src/types/**',      // Type declarations
    '!src/config/env.ts', // Validated at startup, not unit-testable in isolation
  ],

  coverageReporters: ['text', 'lcov', 'html'],

  coverageDirectory: 'coverage',

  // Runs before each test file's imports, so the app config sees the test database
  setupFiles: ['./tests/setup/env.ts'],

  // Global setup: runs once before the entire test suite
  // Used to apply DB migrations on the test database
  globalSetup: './tests/setup/globalSetup.ts',

  // Global teardown: runs once after all tests complete
  globalTeardown: './tests/setup/globalTeardown.ts',

  // Increase timeout for integration tests that hit a real DB
  testTimeout: 30_000,

  // ts-jest configuration
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          rootDir: '.',
          // Relax some strict checks that are counterproductive in test files
          noUnusedLocals: false,
          noUnusedParameters: false,
          exactOptionalPropertyTypes: false,
          noUncheckedIndexedAccess: false,
          noPropertyAccessFromIndexSignature: false,
        },
      },
    ],
  },
};
