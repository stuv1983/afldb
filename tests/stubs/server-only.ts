// Stub for the `server-only` package.
//
// In the application this module throws if imported from client code,
// which is exactly the boundary we want in production. Vitest runs in
// Node outside React, so it is replaced with a no-op here.
export {};
