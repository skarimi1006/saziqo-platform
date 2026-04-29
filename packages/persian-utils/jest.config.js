module.exports = {
  moduleFileExtensions: ['js', 'ts'],
  rootDir: '.',
  testRegex: '\\.(spec|test)\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  testEnvironment: 'node',
};
