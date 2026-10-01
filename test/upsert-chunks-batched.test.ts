/**
 * Fork patch guard: engine-sql/chunks.ts splits the content_chunks upsert into
 * batches of 8 rows to keep each bun+postgres wire frame small (the
 * 2026-08-21 phantom-NUL corruption). Batching must be invisible to callers:
 * a page with more chunks than one batch has to land EVERY chunk, in order,
 * and a later shorter re-chunk still has to drop the tail. If the loop ever
 * stops after the first batch, or a batch boundary skips a row, search quietly
 * loses the back half of long notes — this test fails before that ships.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import type { ChunkInput } from '../src/core/types.ts';

let engine: PGLiteEngine;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({ database_url: '' });
  await engine.initSchema();
});

afterAll(async () => {
  await engine.disconnect();
});

const chunk = (i: number): ChunkInput => ({
  chunk_index: i,
  chunk_text: `chunk number ${i}`,
  chunk_source: 'compiled_truth',
});

test('a page larger than one insert batch keeps every chunk', async () => {
  await engine.putPage('long-note', { type: 'note', title: 'long', compiled_truth: 'body', frontmatter: {} });

  // 21 = two full batches of 8 plus a partial batch of 5.
  await engine.upsertChunks('long-note', Array.from({ length: 21 }, (_, i) => chunk(i)));
  const stored = await engine.getChunks('long-note', { includeUnsealed: true });
  expect(stored.map(c => c.chunk_index)).toEqual(Array.from({ length: 21 }, (_, i) => i));
  expect(stored[20].chunk_text).toBe('chunk number 20');

  // Re-chunking shorter still removes the old tail across batch boundaries.
  await engine.upsertChunks('long-note', Array.from({ length: 9 }, (_, i) => chunk(i)));
  const after = await engine.getChunks('long-note', { includeUnsealed: true });
  expect(after.map(c => c.chunk_index)).toEqual(Array.from({ length: 9 }, (_, i) => i));
});
