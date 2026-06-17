// Pure, IO-free helpers for the versioning tooling. Kept separate so the
// semver math and drift comparison can be unit-tested without touching the
// filesystem, git, or the board. The stamp/bump/check scripts import these.

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Parse a strict "x.y.z" SemVer string into [major, minor, patch].
 * Throws on anything that isn't three dot-separated non-negative integers,
 * so a malformed VERSION file fails loud instead of silently stamping junk.
 */
export function parseSemver(version) {
  const m = SEMVER_RE.exec(String(version).trim());
  if (!m) throw new Error(`Malformed version (expected x.y.z): ${JSON.stringify(version)}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Compute the next version from a current one and a bump type. */
export function nextVersion(current, type) {
  const [major, minor, patch] = parseSemver(current);
  switch (type) {
    case "major": return `${major + 1}.0.0`;
    case "minor": return `${major}.${minor + 1}.0`;
    case "patch": return `${major}.${minor}.${patch + 1}`;
    default: throw new Error(`Unknown bump type: ${JSON.stringify(type)} (use major|minor|patch)`);
  }
}

/**
 * Compare an artifact's self-reported version against the repo's expected
 * version. Returns one of:
 *   "match"   — reported === expected
 *   "drift"   — reported is a real version but differs from expected
 *   "unknown" — artifact reported nothing usable (absent / "unknown" / pre-versioning)
 */
export function compareArtifact(reported, expected) {
  if (reported == null || reported === "" || reported === "unknown") return "unknown";
  return reported === expected ? "match" : "drift";
}
