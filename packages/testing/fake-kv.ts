/**
 * In-memory stand-in for a Workers KV namespace binding.
 *
 * Small but real: `put` stores, `get` returns what was stored, `delete` removes
 * it, `list` reports the keys. A stub whose `put` discarded silently would let a
 * test claiming to exercise storage pass against nothing.
 *
 * What it does **not** model — reach for a different double if a test needs any
 * of these, rather than assuming they work: expiry (`expirationTtl`), metadata,
 * cursors and pagination on `list`, the `type` option on `get` (values come back
 * as the strings they went in as), and KV's eventual consistency, which is the
 * whole reason `docs/security-audit.md` #4 rejected it as a rate-limit store.
 */
export interface FakeKvNamespace {
  get(key: string): Promise<string | null>;
  /**
   * Present because it is what tells a KV namespace apart from an `R2Bucket`,
   * which shares every other member here — `kvBinding` in `@starter/config`
   * keys its check on exactly that, so a fake without it would be rejected as
   * not-a-namespace. `metadata` is always null; this fake does not store any.
   */
  getWithMetadata(key: string): Promise<{ value: string | null; metadata: null }>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }>;
  /** Everything currently stored, for assertions. */
  readonly store: Map<string, string>;
}

export function createFakeKv(): FakeKvNamespace {
  const store = new Map<string, string>();

  return {
    store,
    get: async (key) => store.get(key) ?? null,
    getWithMetadata: async (key) => ({ value: store.get(key) ?? null, metadata: null }),
    put: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
    list: async (options) => ({
      keys: [...store.keys()]
        .filter((name) => !options?.prefix || name.startsWith(options.prefix))
        .map((name) => ({ name })),
    }),
  };
}
