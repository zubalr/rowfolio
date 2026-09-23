/**
 * Unit tests for the pure side of the network helpers — the egress
 * scanner that e2e suites run over collected requests. Playwright glue is
 * exercised in the browser suite; the policy logic is fully covered here.
 */
import { describe, expect, it } from 'vitest';
import { formatViolations, scanRequestsForEgress, type ObservedRequest } from './index.ts';

const ORIGIN = 'http://127.0.0.1:4173';
const req = (url: string, method = 'GET', postData: string | null = null): ObservedRequest => ({ url, method, postData });

describe('scanRequestsForEgress', () => {
  const policy = { allowedOrigins: [ORIGIN], canaries: ['CANARY-TOKEN-7f3a'] };

  it('same-origin GETs pass clean', () => {
    expect(scanRequestsForEgress([req(`${ORIGIN}/`), req(`${ORIGIN}/assets/app.js`)], policy)).toEqual([]);
  });

  it('data:/blob: URLs are local resources, not egress', () => {
    expect(scanRequestsForEgress([req('data:image/png;base64,AAAA'), req('blob:http://x/1')], policy)).toEqual([]);
  });

  it('cross-origin request is a violation', () => {
    const v = scanRequestsForEgress([req('https://telemetry.example.com/collect')], policy);
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe('cross-origin');
  });

  it('POST to an allowed origin is still a violation (read-only policy)', () => {
    const v = scanRequestsForEgress([req(`${ORIGIN}/api`, 'POST', 'x=1')], policy);
    expect(v.map((x) => x.kind)).toEqual(['disallowed-method']);
  });

  it('path outside allowed prefixes is a violation', () => {
    const v = scanRequestsForEgress([req(`${ORIGIN}/admin/secret`)], { ...policy, allowedPathPrefixes: ['/assets'] });
    expect(v.map((x) => x.kind)).toEqual(['cross-origin']);
  });

  it('canary token in URL or body is a violation', () => {
    const inUrl = scanRequestsForEgress([req(`${ORIGIN}/cb?t=CANARY-TOKEN-7f3a`)], policy);
    expect(inUrl.map((x) => x.kind)).toEqual(['canary-in-url']);
    const inBody = scanRequestsForEgress([req('https://evil.example/x', 'GET')], { ...policy, allowedOrigins: ['https://evil.example'], });
    expect(inBody).toEqual([]);
    const body = scanRequestsForEgress([req(`${ORIGIN}/x`, 'GET', 'payload CANARY-TOKEN-7f3a tail')], policy);
    expect(body.map((x) => x.kind)).toEqual(['canary-in-body']);
  });

  it('unparseable URLs count as violations', () => {
    const v = scanRequestsForEgress([req('notaurl')], policy);
    expect(v[0]!.kind).toBe('cross-origin');
  });

  it('empty canary list and no policy → everything external flagged', () => {
    expect(scanRequestsForEgress([req(`${ORIGIN}/`)])).toEqual([expect.objectContaining({ kind: 'cross-origin' })]);
  });
});

describe('formatViolations', () => {
  it('renders one line per violation', () => {
    const s = formatViolations([
      { kind: 'cross-origin', url: 'https://x', method: 'GET', detail: 'd1' },
      { kind: 'canary-in-url', url: 'https://y', method: 'POST', detail: 'd2' },
    ]);
    expect(s.split('\n')).toHaveLength(2);
    expect(s).toContain('cross-origin GET https://x');
  });
});
