export type ExtensionCompatibility = "compatible" | "outdated" | "invalid";

function parseVersion(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!match) return null;
  return match.slice(1).map(Number) as [number, number, number];
}

export function compareExtensionVersions(left: unknown, right: unknown) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return null;
  for (let index = 0; index < parsedLeft.length; index += 1) {
    if (parsedLeft[index] !== parsedRight[index]) return parsedLeft[index] > parsedRight[index] ? 1 : -1;
  }
  return 0;
}

export function extensionCompatibility(candidate: unknown, minimum: string): ExtensionCompatibility {
  const parsedCandidate = parseVersion(candidate);
  const parsedMinimum = parseVersion(minimum);
  if (!parsedCandidate || !parsedMinimum) return "invalid";
  // A different major version requires an explicit compatibility review. Within the
  // current extension generation, newer minor/patch releases remain compatible.
  if (parsedCandidate[0] !== parsedMinimum[0]) return "invalid";
  return (compareExtensionVersions(candidate, minimum) ?? -1) >= 0 ? "compatible" : "outdated";
}
