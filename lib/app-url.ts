import { NextRequest } from 'next/server';

function normalizeUrl(base: string): string {
  return base.replace(/\/$/, '');
}

export function getPublicAppUrl(request?: NextRequest): string | null {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return normalizeUrl(explicit);

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) return normalizeUrl(`https://${vercelProd.replace(/^https?:\/\//, '')}`);

  const vercelAny = process.env.VERCEL_URL?.trim();
  if (vercelAny) return normalizeUrl(`https://${vercelAny.replace(/^https?:\/\//, '')}`);

  if (request) return normalizeUrl(request.nextUrl.origin);
  return null;
}
