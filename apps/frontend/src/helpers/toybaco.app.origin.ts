const DEFAULT_TOYBACO_APP_ORIGIN = 'https://app.toybaco.jp';

// Deployment configuration is privileged, but still reject credentials, paths,
// malformed URLs and clear-text non-local origins. Returning null makes the
// embed boundary fail closed instead of silently widening frame access.
export function toybacoAppOrigin(
  raw = process.env.TOYBACO_APP_ORIGIN
) {
  const value = (raw || DEFAULT_TOYBACO_APP_ORIGIN).trim();
  if (!value || value.length > 2048) return null;

  try {
    const parsed = new URL(value);
    const local =
      parsed.hostname === 'localhost' || parsed.hostname.endsWith('.localhost');
    if (
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}
