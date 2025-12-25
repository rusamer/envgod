# EnvGod SDK

A secure, server-side Node.js and Next.js SDK for fetching environment bundles from the EnvGod Data Plane.

## Features

- **Secure by Default**: Throws if executed in a browser environment.
- **In-Memory Only**: Never writes secrets to disk or logs them.
- **Auto-Auth**: Exchanges `ENVGOD_API_KEY` for short-lived JWTs.
- **Smart Caching**: Caches tokens and bundles in memory until expiry.
- **Reliable**: Automatic retry on 401 (token expiry) and network resiliency.
- **Next.js Ready**: Dedicated `envgod/next` entry point with `server-only` guards.

## Installation

```bash
npm install @rusamer/envgod
# or
pnpm add @rusamer/envgod
# or
yarn add @rusamer/envgod
```

## Configuration

The SDK automatically reads the following environment variables:

| Variable | Description |
|C...|...|
| `ENVGOD_API_URL` | URL of the EnvGod Data Plane |
| `ENVGOD_API_KEY` | Your project Service Key |
| `ENVGOD_PROJECT` | Project ID |
| `ENVGOD_ENV` | Environment Name (e.g., prod) |
| `ENVGOD_SERVICE` | Service Name |

```env
ENVGOD_API_URL=https://api.example.com
ENVGOD_API_KEY=sk_xxx
ENVGOD_PROJECT=myapp
ENVGOD_ENV=prod
ENVGOD_SERVICE=web
```

## Usage

### Node.js

```typescript
import { loadEnv } from '@rusamer/envgod';

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
import { loadServerEnv } from '@rusamer/envgod/next';

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
