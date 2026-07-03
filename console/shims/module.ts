// Browser stand-in for node:module, aliased in vite.config.ts.
// @helixid/core's did-hedera-loader calls createRequire inside a
// try/catch and falls back to null, so throwing here is the correct
// browser behaviour.
export function createRequire(): never {
  throw new Error('createRequire is not available in the Console');
}
export default { createRequire };
