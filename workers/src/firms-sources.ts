/**
 * Which satellite products the live cycle watches.
 *
 * Its own module, free of any environment parsing, so the rule can be tested
 * directly — it decides how many separate looks at the ground this system
 * gets, and how soon it hears about a fire.
 */

/**
 * The configured list, plus the legacy singular value if one is still set.
 * Deduplicated, order preserved.
 *
 * The legacy value is MERGED rather than honoured as an override on purpose.
 * `FIRMS_SOURCE` shipped as `VIIRS_SNPP_NRT`, so nearly every existing `.env`
 * carries it without anyone having chosen it; treating that as a deliberate
 * setting would freeze those deployments on a single satellite for good. An
 * operator who genuinely added MODIS still keeps it.
 */
export function resolvePollSources(
  sources: string,
  legacy?: string,
): readonly string[] {
  return [
    ...new Set(
      [...sources.split(','), legacy ?? '']
        .map((source) => source.trim())
        .filter(Boolean),
    ),
  ];
}
