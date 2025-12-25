import 'server-only';
import { loadEnv, type LoadEnvOptions } from './index.js';

export async function loadServerEnv(options?: LoadEnvOptions) {
    return loadEnv(options);
}

export * from './types.js';
