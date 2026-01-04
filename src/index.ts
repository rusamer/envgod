import type { EnvGuardsConfig, LoadEnvOptions, AuthExchangeResponse, BundleResponse } from './types.js';

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

function checkBrowser() {
    if (typeof window !== 'undefined') {
        throw new Error('[Env.Guards] Security Warning: SDK execution attempting in browser environment. This SDK is server-only.');
    }
}

async function fetchWithTimeout(url: string, init: RequestInit & { timeout?: number }) {
    const { timeout = 5000, ...rest } = init;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
        const res = await fetch(url, { ...rest, signal: controller.signal });
        return res;
    } catch (err: any) {
        if (err.name === 'AbortError') {
            throw new Error(`[Env.Guards] Request timed out after ${timeout}ms`);
        }
        throw err;
    } finally {
        clearTimeout(id);
    }
}

// --- Core Logic ---

async function resolveRuntimeKey(config: EnvGuardsConfig): Promise<string> {
    // 1. Explicitly passed apiKey
    if (config.apiKey) return config.apiKey;

    // 2. Environment variable
    if (process.env.ENV_GUARDS_API_KEY) return process.env.ENV_GUARDS_API_KEY;

    // 3. Keytar (for local development, optional)
    try {
        const keytar = (await import('keytar')).default;
        const SERVICE = 'env-guards';
        const { apiUrl, org, project, env, service } = config;
        if (apiUrl && org && project && env && service) {
            const account = `runtime:${apiUrl}:${org}:${project}:${env}:${service}`;
            const key = await keytar.getPassword(SERVICE, account);
            if (key) return key;
        }
    } catch (err) {
        // Keytar is optional, so we ignore errors (e.g., native module not built).
    }

    throw new Error('[Env.Guards] Runtime key not found. Please set ENV_GUARDS_API_KEY, use `env-guards run`, or run `env-guards add-runtime-key`.');
}

function getFullConfig(options?: LoadEnvOptions): EnvGuardsConfig {
    const env = process.env;
    return {
        apiUrl: options?.config?.apiUrl ?? env.ENV_GUARDS_API_URL,
        apiKey: options?.config?.apiKey ?? env.ENV_GUARDS_API_KEY,
        org: options?.config?.org ?? env.ENV_GUARDS_ORG,
        project: options?.config?.project ?? env.ENV_GUARDS_PROJECT,
        env: options?.config?.env ?? env.ENV_GUARDS_ENV,
        service: options?.config?.service ?? env.ENV_GUARDS_SERVICE,
    };
}

async function exchangeToken(apiUrl: string, runtimeKey: string, scope: Partial<EnvGuardsConfig>, timeout: number, state: CacheState): Promise<string> {
    const res = await fetchWithTimeout(`${apiUrl}/v1/auth/exchange`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${runtimeKey}`,
        },
        body: JSON.stringify(scope),
        timeout,
    });

    if (!res.ok) {
        throw new Error(`[Env.Guards] Auth exchange failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as AuthExchangeResponse;
    state.token = data.token;
    state.tokenExpiresAt = new Date(data.expiresAt).getTime();
    return data.token;
}

async function fetchBundle(apiUrl: string, token: string, timeout: number): Promise<Record<string, string>> {
    const res = await fetchWithTimeout(`${apiUrl}/v1/bundle`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        timeout,
    });

    if (res.status === 401) throw new Error('401'); // Signal to retry
    if (!res.ok) throw new Error(`[Env.Guards] Fetch bundle failed: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as BundleResponse;
    return data.values;
}

function getConfigFingerprint(apiUrl: string, runtimeKey: string, config: EnvGuardsConfig): string {
    const keyPrefix = runtimeKey.substring(0, 12); // env-guards_sk_...
    return [apiUrl, keyPrefix, config.org, config.project, config.env, config.service].join('|');
}

async function loadEnvInternal(options?: LoadEnvOptions): Promise<Record<string, string>> {
    checkBrowser();
    const config = getFullConfig(options);
    const { apiUrl, ...scope } = config;

    if (!apiUrl) {
        throw new Error('[Env.Guards] Missing required configuration: apiUrl is required.');
    }

    const runtimeKey = await resolveRuntimeKey(config);
    const timeout = options?.timeout ?? 5000;
    const now = Date.now();
    const TOKEN_SKEW_MS = 30 * 1000;

    const fingerprint = getConfigFingerprint(apiUrl, runtimeKey, config);
    if (!cache.has(fingerprint)) {
        cache.set(fingerprint, { token: null, tokenExpiresAt: null, bundle: null });
    }
    const state = cache.get(fingerprint)!;

    let token = state.token;
    let tokenValid = token && state.tokenExpiresAt && state.tokenExpiresAt > (now + TOKEN_SKEW_MS);

    if (!tokenValid) {
        token = await exchangeToken(apiUrl, runtimeKey, scope, timeout, state);
    }

    if (state.bundle && tokenValid) {
        Object.assign(process.env, state.bundle);
        return state.bundle;
    }

    try {
        const values = await fetchBundle(apiUrl, token!, timeout);
        state.bundle = values;
        Object.assign(process.env, values);
        return values;
    } catch (err: any) {
        if (err.message === '401') {
            state.token = null;
            state.bundle = null;
            const newToken = await exchangeToken(apiUrl, runtimeKey, scope, timeout, state);
            const values = await fetchBundle(apiUrl, newToken, timeout);
            state.bundle = values;
            Object.assign(process.env, values);
            return values;
        }
        throw err;
    }
}

export function loadEnv(options?: LoadEnvOptions): Promise<Record<string, string>> {
    if (pendingLoadPromise) {
        return pendingLoadPromise;
    }

    pendingLoadPromise = loadEnvInternal(options).finally(() => {
        pendingLoadPromise = null;
    });

    return pendingLoadPromise;
}

export * from './types.js';
