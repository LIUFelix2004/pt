/**
 * Renamed-variable helper.
 *
 * Every environment variable that changed name goes through this module so the
 * codebase never repeats the `??` fallback. Reading a legacy name prints a
 * one-time deprecation warning; the new name is authoritative.
 */

const warned = new Set<string>();

export function legacyEnv(newKey: string, oldKey: string): string | undefined {
  const fresh = process.env[newKey];
  if (fresh !== undefined) return fresh;
  const legacy = process.env[oldKey];
  if (legacy !== undefined && !warned.has(oldKey)) {
    warned.add(oldKey);
    console.warn(`[portus] ${oldKey} is deprecated; use ${newKey}`);
  }
  return legacy;
}

/** Alias of legacyEnv for callers that want to state the old name inline. */
export const envOrLegacy = legacyEnv;
