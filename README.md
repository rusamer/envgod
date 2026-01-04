# Env.Guards SDK

A secure, server-side Node.js and Next.js SDK for fetching environment bundles from the Env.Guards Data Plane.

## The EnvGuards Workflow

Env.Guards is a complete system for managing secrets. This SDK is designed for server-side applications to fetch secrets programmatically at runtime.

1.  **Management via the Dashboard**: A user first signs up and manages secrets using the **Env.Guards Frontend**. There, they generate a scoped API key for a specific service.

2.  **Server-Side Integration with the SDK**: In your server-side code (e.g., Node.js, Next.js), you import this SDK. You provide it with the API key and scope identifiers via environment variables, and it securely fetches and loads the secrets into `process.env`.

3.  **Local Development with the CLI**: For local development or CI/CD, the **`@rusamer/envguards-cli`** is often preferred, as it can inject secrets without requiring any code changes or SDK installation.

## Features

- **Secure by Default**: Throws if executed in a browser environment.
- **In-Memory Only**: Never writes secrets to disk or logs them.
- **Auto-Auth**: Exchanges `ENV_GUARDS_API_KEY` for short-lived JWTs.
- **Smart Caching**: Caches tokens and bundles in memory until expiry.
- **Reliable**: Automatic retry on 401 (token expiry) and network resiliency.
- **Next.js Ready**: Dedicated `envguards/next` entry point with `server-only` guards.

## Installation

```bash
npm install @rusamer/envguards
# or
pnpm add @rusamer/envguards
# or
yarn add @rusamer/envguards
```

## Configuration

The SDK automatically reads the following environment variables:

| Variable | Description |
|C...|...|
| `ENV_GUARDS_API_URL` | URL of the Env.Guards Data Plane |
| `ENV_GUARDS_API_KEY` | Your project Service Key |
| `ENV_GUARDS_PROJECT` | Project ID |
| `ENV_GUARDS_ENV` | Environment Name (e.g., prod) |
| `ENV_GUARDS_SERVICE` | Service Name |

```env
ENV_GUARDS_API_URL=https://api.example.com
ENV_GUARDS_API_KEY=sk_xxx
ENV_GUARDS_PROJECT=myapp
ENV_GUARDS_ENV=prod
ENV_GUARDS_SERVICE=web
```

## Usage

### Node.js

```typescript
import { loadEnv } from '@rusamer/envguards';

async function main() {
  const env = await loadEnv();
  
  console.log(process.env.MY_SECRET); // Accessed from process.env
  console.log(env.MY_SECRET);         // Or from the returned object
}

main();
```

### Next.js (App Router / Server Actions)

Use the Next.js specific helper to ensure server-side only execution.

```typescript
// src/lib/env.ts
import { loadServerEnv } from '@rusamer/envguards/next';

export async function getSecrets() {
  return loadServerEnv();
}
```

```typescript
// src/app/page.tsx
import { getSecrets } from '@/lib/env';

export default async function Page() {
  const env = await getSecrets();
  return <div>Secret length: {env.API_KEY.length}</div>;
}
```

## Security Notes

1. **Server-Only**: This SDK is designed strictly for server environments. It explicitly checks for `window` and imports `server-only` in the Next.js entrypoint.
2. **No Persistence**: Secrets are held in memory. Restarting the server will trigger a fresh fetch.
3. **Logs**: The SDK does not log secret values.

## For Maintainers

### Build

```bash
pnpm build
```

### Test

```bash
pnpm test
```

### Publish

1. `npm version patch`
2. `npm publish`
