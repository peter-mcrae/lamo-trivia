import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyAdminAccess } from '../admin-auth';
import { createMockEnv } from './mocks';

describe('verifyAdminAccess', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('dev fallback (SEED_SECRET)', () => {
    it('returns admin identity for correct Bearer token', async () => {
      const env = createMockEnv({ SEED_SECRET: 'test-secret-123' } as any);
      const request = new Request('http://localhost/api/admin/users', {
        headers: { Authorization: 'Bearer test-secret-123' },
      });

      const result = await verifyAdminAccess(request, env);

      expect(result).not.toBeNull();
      expect(result!.email).toBe('dev-admin@local');
      expect(result!.method).toBe('seed-secret');
    });

    it('returns null for wrong Bearer token', async () => {
      const env = createMockEnv({ SEED_SECRET: 'test-secret-123' } as any);
      const request = new Request('http://localhost/api/admin/users', {
        headers: { Authorization: 'Bearer wrong-token' },
      });

      const result = await verifyAdminAccess(request, env);
      expect(result).toBeNull();
    });

    it('returns null for missing Authorization header', async () => {
      const env = createMockEnv({ SEED_SECRET: 'test-secret-123' } as any);
      const request = new Request('http://localhost/api/admin/users');

      const result = await verifyAdminAccess(request, env);
      expect(result).toBeNull();
    });

    it('returns null when SEED_SECRET is not set', async () => {
      const env = createMockEnv();
      const request = new Request('http://localhost/api/admin/users', {
        headers: { Authorization: 'Bearer anything' },
      });

      const result = await verifyAdminAccess(request, env);
      expect(result).toBeNull();
    });

    it('returns null for empty Bearer token', async () => {
      const env = createMockEnv({ SEED_SECRET: 'test-secret-123' } as any);
      const request = new Request('http://localhost/api/admin/users', {
        headers: { Authorization: 'Bearer ' },
      });

      const result = await verifyAdminAccess(request, env);
      expect(result).toBeNull();
    });

    it('returns null for non-Bearer auth scheme', async () => {
      const env = createMockEnv({ SEED_SECRET: 'test-secret-123' } as any);
      const request = new Request('http://localhost/api/admin/users', {
        headers: { Authorization: 'Basic dGVzdA==' },
      });

      const result = await verifyAdminAccess(request, env);
      expect(result).toBeNull();
    });
  });

  describe('Cloudflare Access (JWT)', () => {
    it('returns null when CF_ACCESS_AUD is set but JWT header is missing', async () => {
      const env = createMockEnv({
        CF_ACCESS_AUD: 'test-aud',
        CF_ACCESS_TEAM_DOMAIN: 'myteam',
      } as any);

      const request = new Request('http://localhost/api/admin/users');

      const result = await verifyAdminAccess(request, env);
      expect(result).toBeNull();
    });

    it('returns null for invalid JWT when CF_ACCESS is configured', async () => {
      const env = createMockEnv({
        CF_ACCESS_AUD: 'test-aud',
        CF_ACCESS_TEAM_DOMAIN: 'myteam',
      } as any);

      const request = new Request('http://localhost/api/admin/users', {
        headers: { 'Cf-Access-Jwt-Assertion': 'not-a-valid-jwt' },
      });

      const result = await verifyAdminAccess(request, env);
      expect(result).toBeNull();
    });
  });
});
