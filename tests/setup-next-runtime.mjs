/**
 * ESM preloader: exposes AsyncLocalStorage on globalThis so that Next.js
 * dist/client/components/async-local-storage.js can instantiate it.
 * Use via: NODE_OPTIONS='--import /path/to/setup-next-runtime.mjs'
 * or:      node --import ./tests/setup-next-runtime.mjs <script>
 */
import { AsyncLocalStorage } from 'async_hooks';
globalThis.AsyncLocalStorage = AsyncLocalStorage;
