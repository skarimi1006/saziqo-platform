/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testEnvironment: 'node',
  testTimeout: 30_000,
  // uuid v11 ships dual ESM/CJS — keep this in case jest stumbles on its ESM build.
  transformIgnorePatterns: ['/node_modules/(?!(uuid)/)'],
};
