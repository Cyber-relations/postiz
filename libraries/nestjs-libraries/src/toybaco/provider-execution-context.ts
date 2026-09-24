import { AsyncLocalStorage } from 'node:async_hooks';

// One durable provider step owns this asynchronous call tree. Provider retries
// must never turn an ambiguous remote response into another mutation attempt.
// The context is local to this invocation, not shared across singleton providers.
const execution = new AsyncLocalStorage<boolean>();

export function postingProviderExecution(): boolean {
  return execution.getStore() === true;
}

export function withPostingProviderExecution<T>(
  enabled: boolean,
  work: () => Promise<T>,
): Promise<T> {
  return execution.run(enabled || postingProviderExecution(), work);
}
