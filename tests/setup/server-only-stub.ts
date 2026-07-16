// Vitest stub for the `server-only` guard package. In production `server-only` throws if a
// module is pulled into a client bundle; under vitest's `node` environment there is no client
// bundle, so the guard is a no-op. Aliased in vitest.config.ts so server modules that import
// it (e.g. src/server/money-review-llm.ts) can be exercised transitively by unit tests.
export {};
