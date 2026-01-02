import type { EnvGodConfig, LoadEnvOptions, AuthExchangeResponse, BundleResponse } from './types.js';

// --- State ---
interface CacheState {
    token: string | null;
    tokenExpiresAt: number | null; // Timestamp in ms
    bundle: Record<string, string> | null;
}

const cache = new Map<string, CacheState>();
let pendingLoadPromise: Promise<Record<string, string>> | null = null;

/** @internal For testing only */
export function _resetState() {
    cache.clear();
    pendingLoadPromise = null;
}

// --- Helpers ---

/**
 * Validates and returns the configuration.
 * Prioritizes options > process.env.
 */
export function getEnvGodConfig(options?: LoadEnvOptions): EnvGodConfig {
    const env = process.env;
    const config = {
        apiUrl: options?.config?.apiUrl ?? env.ENVGOD_API_URL,
        apiKey: options?.config?.apiKey ?? env.ENVGOD_API_KEY,
        project: options?.config?.project ?? env.ENVGOD_PROJECT,
        env: options?.config?.env ?? env.ENVGOD_ENV,
        service: options?.config?.service ?? env.ENVGOD_SERVICE,
    };

    if (!config.apiUrl || !config.apiKey) {
        throw new Error('[EnvGod] Missing required configuration: apiUrl and apiKey are required.');
    }

    return config as EnvGodConfig;
}

/**
 * Checks if the current environment is a browser.
 */
function checkBrowser() {
    if (typeof window !== 'undefined') {
        throw new Error('[EnvGod] Security Warning: SDK execution attempting in browser environment. This SDK is server-only.');
    }
}

/**
 * Fetches with timeout.
 */
async function fetchWithTimeout(url: string, init: RequestInit & { timeout?: number }) {
    const { timeout = 5000, ...rest } = init;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
        const res = await fetch(url, { ...rest, signal: controller.signal });
        return res;
    } catch (err: any) {
        if (err.name === 'AbortError') {
            throw new Error(`[EnvGod] Request timed out after ${timeout}ms`);
        }
        throw err;
    } finally {
        clearTimeout(id);
    }
}

// --- Core Logic ---

async function exchangeToken(config: EnvGodConfig, timeout: number, state: CacheState): Promise<string> {
    const res = await fetchWithTimeout(`${config.apiUrl}/v1/auth/exchange`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            project: config.project,
            env: config.env,
            service: config.service,
        }),
        timeout,
    });

    if (!res.ok) {
        throw new Error(`[EnvGod] Auth exchange failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as AuthExchangeResponse;
    state.token = data.token;
    state.tokenExpiresAt = new Date(data.expiresAt).getTime();
    return data.token;
}

async function fetchBundle(config: EnvGodConfig, token: string, timeout: number): Promise<Record<string, string>> {
    const res = await fetchWithTimeout(`${config.apiUrl}/v1/bundle`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
        timeout,
    });

    if (res.status === 401) {
        throw new Error('401'); // Signal to retry
    }

    if (!res.ok) {
        throw new Error(`[EnvGod] Fetch bundle failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as BundleResponse;
    return data.values;
}

function getConfigFingerprint(config: EnvGodConfig): string {
    const keyPrefix = config.apiKey.substring(0, 8);
    return [config.apiUrl, keyPrefix, config.project, config.env, config.service].join('|');
}

async function loadEnvInternal(options?: LoadEnvOptions): Promise<Record<string, string>> {
    checkBrowser();
    const config = getEnvGodConfig(options);
    const timeout = options?.timeout ?? 5000;
    const now = Date.now();
    const TOKEN_SKEW_MS = 30 * 1000; // 30 seconds

    const fingerprint = getConfigFingerprint(config);
    if (!cache.has(fingerprint)) {
        cache.set(fingerprint, { token: null, tokenExpiresAt: null, bundle: null });
    }
    const state = cache.get(fingerprint)!;

    let token = state.token;
    let tokenValid = token && state.tokenExpiresAt && state.tokenExpiresAt > (now + TOKEN_SKEW_MS);

    if (!tokenValid) {
        token = await exchangeToken(config, timeout, state);
    }

    if (state.bundle && tokenValid) {
        Object.assign(process.env, state.bundle);
        return state.bundle;
    }

    try {
        const values = await fetchBundle(config, token!, timeout);
        state.bundle = values;
        Object.assign(process.env, values);
        return values;
    } catch (err: any) {
        if (err.message === '401') {
            state.token = null;
            state.bundle = null;
            const newToken = await exchangeToken(config, timeout, state);
            const values = await fetchBundle(config, newToken, timeout);
            state.bundle = values;
            Object.assign(process.env, values);
            return values;
        }
        throw err;
    }
}

/**
 * Main entry point to load environment variables.
 * Uses Singleflight pattern to prevent concurrent network requests.
 */
export function loadEnv(options?: LoadEnvOptions): Promise<Record<string, string>> {
    if (pendingLoadPromise) {
        return pendingLoadPromise;
    }

    pendingLoadPromise = loadEnvInternal(options)
        .finally(() => {
            pendingLoadPromise = null;
        });

    return pendingLoadPromise;
}

export * from './types.js';
