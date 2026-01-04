export interface EnvGuardsConfig {
    apiUrl?: string;
    apiKey?: string;
    org?: string;
    project?: string;
    env?: string;
    service?: string;
}

export interface LoadEnvOptions {
    /** Override default configuration */
    config?: Partial<EnvGuardsConfig>;
    /** Timeout in milliseconds (default: 5000) */
    timeout?: number;
}

export interface AuthExchangeResponse {
    token: string;
    expiresAt: string; // ISO string
}

export interface BundleResponse {
    values: Record<string, string>;
}
