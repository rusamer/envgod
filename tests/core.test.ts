import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { loadEnv, getEnvGodConfig, _resetState } from '../src/index';

const MOCK_API_URL = 'http://api.envgod.test';

describe('EnvGod SDK', () => {
    let mockAgent: MockAgent;
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        _resetState(); // Ensure clean slate
        originalEnv = { ...process.env };
        process.env.ENVGOD_API_URL = MOCK_API_URL;
        process.env.ENVGOD_API_KEY = 'test-api-key';
        process.env.ENVGOD_PROJECT = 'test-proj';
        process.env.ENVGOD_ENV = 'dev';
        process.env.ENVGOD_SERVICE = 'api';

        mockAgent = new MockAgent();
        mockAgent.disableNetConnect();
        setGlobalDispatcher(mockAgent);
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
    });

    it('should throw if browser environment detected', async () => {
        // Simulate browser
        (global as any).window = {};

        await expect(loadEnv()).rejects.toThrow('browser environment');

        delete (global as any).window;
    });

    it('should validate configuration', () => {
        delete process.env.ENVGOD_API_KEY;
        expect(() => getEnvGodConfig()).toThrow('Missing required configuration');
    });

    it('should exchange token and fetch bundle (Happy Path)', async () => {
        const client = mockAgent.get(MOCK_API_URL);

        // 1. Auth Exchange
        client.intercept({
            path: '/v1/auth/exchange',
            method: 'POST',
            headers: { Authorization: 'Bearer test-api-key' },
        }).reply(200, {
            token: 'jwt-token-123',
            expiresAt: new Date(Date.now() + 10000).toISOString(),
        });

        // 2. Fetch Bundle
        client.intercept({
            path: '/v1/bundle',
            method: 'GET',
            headers: { Authorization: 'Bearer jwt-token-123' },
        }).reply(200, {
            values: { SECRET_FOO: 'bar' },
        });

        const vars = await loadEnv();
        expect(vars['SECRET_FOO']).toBe('bar');
        expect(process.env['SECRET_FOO']).toBe('bar');
    });

    it('should retry once on 401', async () => {
        const client = mockAgent.get(MOCK_API_URL);

        // Initial Exchange (returns expired token concept, or just one we'll force fail)
        client.intercept({
            path: '/v1/auth/exchange',
            method: 'POST',
        }).reply(200, {
            token: 'jwt-token-expired',
            expiresAt: new Date(Date.now() + 10000).toISOString(),
        });

        // First Bundle Fetch -> 401
        client.intercept({
            path: '/v1/bundle',
            method: 'GET',
            headers: { Authorization: 'Bearer jwt-token-expired' },
        }).reply(401, { error: 'Unauthorized' });

        // Retry Exchange
        client.intercept({
            path: '/v1/auth/exchange',
            method: 'POST',
        }).reply(200, {
            token: 'jwt-token-new',
            expiresAt: new Date(Date.now() + 10000).toISOString(),
        });

        // Retry Bundle Fetch -> 200
        client.intercept({
            path: '/v1/bundle',
            method: 'GET',
            headers: { Authorization: 'Bearer jwt-token-new' },
        }).reply(200, {
            values: { RECOVERED: 'true' },
        });

        const vars = await loadEnv();
        expect(vars['RECOVERED']).toBe('true');
    });
});
