// POST /integrations/function is a frontend RPC boundary. Keep this inventory
// limited to useCustomProviderFunction callers and the LinkedIn company picker.
// @Tool also serves agents, so decoration alone must not expose extra methods
// (for example Hashnode tagsList; the frontend calls tags instead).
const frontendTools = new Map<string, readonly string[]>([
  ['devto', ['tags', 'organizations']],
  ['discord', ['channels']],
  ['dribbble', ['teams']],
  ['hashnode', ['publications']],
  ['instagram', ['audioSearch']],
  ['lemmy', ['subreddits']],
  ['listmonk', ['list', 'templates']],
  ['medium', ['publications']],
  ['mewe', ['groups']],
  ['pinterest', ['boards']],
  ['reddit', ['restrictions', 'subreddits']],
  ['skool', ['groups', 'label']],
  ['slack', ['channels']],
  ['tiktok-business', ['musicSearch', 'locationSearch']],
  ['whop', ['companies', 'experiences']],
  ['wordpress', ['postTypes', 'categoriesList', 'tagsList']],
  ['wrapcast', ['subreddits']],
]);

// These frontend loaders predate @Tool. Grant only the specific provider/name
// pairs, without changing the tool inventory exposed to agents.
const frontendLoaders = new Map<string, readonly string[]>([
  ['facebook', ['pages']],
  ['gmb', ['toybacoLocations']],
  ['hashnode', ['tags']],
  ['instagram', ['pages']],
  ['linkedin', ['company']],
  ['linkedin-page', ['company', 'companies']],
  ['tiktok', ['creatorInfo']],
  ['tumblr', ['pages']],
  ['youtube', ['pages']],
]);

export function isFrontendIntegrationFunction(
  provider: string,
  name: unknown,
  tools: Readonly<Record<string, readonly { methodName: string }[]>>
): boolean {
  if (typeof name !== 'string') {
    return false;
  }
  if (frontendLoaders.get(provider)?.includes(name)) {
    return true;
  }
  if (!frontendTools.get(provider)?.includes(name)) {
    return false;
  }
  // Use IntegrationManager.getAllTools(), which reads the provider's @Tool
  // metadata and already filters out providers disabled by product policy.
  return (
    Object.prototype.hasOwnProperty.call(tools, provider) &&
    Array.isArray(tools[provider]) &&
    tools[provider].some((tool) => tool.methodName === name)
  );
}
