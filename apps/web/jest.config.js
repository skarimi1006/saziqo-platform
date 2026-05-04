const nextJest = require('next/jest');
const base = require('@saziqo/config/jest-react');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
module.exports = createJestConfig({
  ...base,
  testEnvironment: 'jsdom',
  // Only match *.spec.{ts,tsx} under src/ — vitest owns *.test.* and e2e/ is Playwright.
  testMatch: ['<rootDir>/src/**/*.spec.{ts,tsx}'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
});
