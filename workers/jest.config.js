/** Unit tests for the pure logic the workers carry — no broker, no database. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
};
