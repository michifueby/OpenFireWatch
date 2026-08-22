/**
 * Unit tests: the logic that can be checked without infrastructure.
 *
 * Deliberately separate from test/jest-e2e.json, which boots real PostGIS and
 * Redis and takes half a minute. These run in milliseconds, so there is no
 * excuse not to run them on every save — and the rules they cover (which
 * alert level, whether a threshold is crossed, whether the environment is
 * usable) are exactly the ones worth checking at their boundaries rather than
 * once through the whole pipeline.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
};
