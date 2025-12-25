import type { EnvGodConfig, LoadEnvOptions, AuthExchangeResponse, BundleResponse } from './types.js';

// --- State ---
interface CacheState {
    token: string | null;
    tokenExpiresAt: number | null; // Timestamp in ms
    bundle: Record<string, string> | null;
}

const state: CacheState = {
    token: null,
    tokenExpiresAt: null,
    bundle: null,
};

let pendingLoadPromise: Promise<Record<string, string>> | null = null;

/** @internal For testing only */
export function _resetState() {
    state.token = null;
    state.tokenExpiresAt = null;
    state.bundle = null;
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

    const missing = Object.entries(config)
        .filter(([_, v]) => !v)
        .map(([k]) => k);

    if (missing.length > 0) {
        throw new Error(`[EnvGod] Missing required configuration: ${missing.join(', ')}`);
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

async function exchangeToken(config: EnvGodConfig, timeout: number): Promise<string> {
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

async function loadEnvInternal(options?: LoadEnvOptions): Promise<Record<string, string>> {
    checkBrowser();
    const config = getEnvGodConfig(options);
    const timeout = options?.timeout ?? 5000;
    const now = Date.now();

    // 1. Check if we have a valid token
    let token = state.token;
    let tokenValid = token && state.tokenExpiresAt && state.tokenExpiresAt > now;

    // 2. If token invalid, exchange
    if (!tokenValid) {
        token = await exchangeToken(config, timeout);
    }

    // 3. If we have a cached bundle and the token is still the same/valid, return it?
    if (state.bundle && tokenValid) {
        Object.assign(process.env, state.bundle);
        return state.bundle;
    }

    // 4. Fetch bundle with retry logic
    try {
        const values = await fetchBundle(config, token!, timeout);
        state.bundle = values;
        Object.assign(process.env, values);
        return values;
    } catch (err: any) {
        if (err.message === '401') {
            // Retry ONCE: Re-exchange and Re-fetch
            state.token = null;
            state.bundle = null;

            const newToken = await exchangeToken(config, timeout);
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
