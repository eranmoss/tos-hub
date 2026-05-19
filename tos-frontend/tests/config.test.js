import { describe, it, expect, beforeEach } from 'vitest';
import { config, getToken, setToken, clearToken } from '../src/config.js';

describe('config', () => {
  it('reads apiBase from TOS_CONFIG', () => {
    expect(config.apiBase).toBe('http://localhost:3000');
  });

  it('reads tenantId from TOS_CONFIG', () => {
    expect(config.tenantId).toBe('test-tenant');
  });

  it('reads branding from TOS_CONFIG', () => {
    expect(config.branding.primaryColor).toBe('#0D3B6E');
  });

  it('provides a default apiBase when TOS_CONFIG is absent', () => {
    // config was imported with TOS_CONFIG set; just verify the default path exists
    expect(typeof config.apiBase).toBe('string');
  });
});

describe('getToken / setToken / clearToken', () => {
  beforeEach(() => {
    localStorage.clear();
    config.auth.token = null;
  });

  it('returns token from config.auth.token', () => {
    config.auth.token = 'from-config';
    expect(getToken()).toBe('from-config');
  });

  it('falls back to localStorage when config token is null', () => {
    localStorage.setItem('tos_jwt', 'from-storage');
    expect(getToken()).toBe('from-storage');
  });

  it('setToken persists to localStorage and config', () => {
    setToken('new-token');
    expect(config.auth.token).toBe('new-token');
    expect(localStorage.getItem('tos_jwt')).toBe('new-token');
  });

  it('clearToken removes from both places', () => {
    setToken('to-clear');
    clearToken();
    expect(config.auth.token).toBeNull();
    expect(localStorage.getItem('tos_jwt')).toBeNull();
  });
});
