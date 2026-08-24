import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { createClient as createAnonClient } from '@supabase/supabase-js';
import { embedQuery } from '@/lib/embeddings';
import { generate } from '@/lib/llm';
import { EMBEDDING_DIMS } from '@/lib/llm/models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Production self-check.
 *
 * Verifies that every configured secret actually WORKS in the deployed
 * environment, not merely that it is present — a key can be set and still be
 * wrong, expired, or pointing at the wrong project. Each check exercises the
 * real dependency.
 *
 * It never returns a secret, a key prefix, or a raw provider error: those would
 * turn a diagnostic into an information leak on a public endpoint. Failures
 * report a short sanitized reason.
 *
 * `?deep=1` additionally spends one embedding call and one generation call.
 * Those cost tokens, so they are opt-in rather than running on every hit.
 */

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

function present(name: string): Check {
  const v = process.env[name];
  return { name: `env · ${name}`, ok: !!v && v.length > 8, detail: v ? 'set' : 'MISSING' };
}

/** Short, safe reason — never the provider's raw message. */
function reason(err: unknown): string {
  const s = String(err);
  if (/401|403|unauthor|invalid.*key|api key/i.test(s)) return 'rejected the credentials';
  if (/404|not found|not listed/i.test(s)) return 'endpoint or model not found';
  if (/429|quota|rate/i.test(s)) return 'rate limited or out of quota';
  if (/timeout|ETIMEDOUT|abort/i.test(s)) return 'timed out';
  if (/fetch failed|ENOTFOUND|ECONN/i.test(s)) return 'unreachable from this network';
  return 'failed';
}

export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get('deep') === '1';
  const checks: Check[] = [
    present('NEXT_PUBLIC_SUPABASE_URL'),
    present('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    present('SUPABASE_SERVICE_ROLE_KEY'),
    present('GEMINI_API_KEY'),
    present('TRUSSED_BASE_URL'),
    present('TRUSSED_API_KEY_OPENAI'),
    {
      name: 'env · NEXT_PUBLIC_SITE_URL',
      ok: !!process.env.NEXT_PUBLIC_SITE_URL && !process.env.NEXT_PUBLIC_SITE_URL.includes('localhost'),
      detail: process.env.NEXT_PUBLIC_SITE_URL?.includes('localhost')
        ? 'still points at localhost — auth redirects will break'
        : process.env.NEXT_PUBLIC_SITE_URL
          ? 'set'
          : 'MISSING',
    },
    {
      name: 'config · RETRIEVAL_MIN_SIMILARITY',
      ok: !!Number(process.env.RETRIEVAL_MIN_SIMILARITY),
      detail: process.env.RETRIEVAL_MIN_SIMILARITY ?? 'using default 0.66',
    },
  ];

  // --- anon key: the one the browser uses ---
  try {
    const anon = createAnonClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { error } = await anon.from('fact_sheets').select('id', { head: true, count: 'exact' });
    checks.push({ name: 'supabase · anon key reads corpus', ok: !error, detail: error ? reason(error.message) : 'ok' });
  } catch (e) {
    checks.push({ name: 'supabase · anon key reads corpus', ok: false, detail: reason(e) });
  }

  // --- service role + corpus present ---
  try {
    const db = createServiceClient();
    const [sheets, chunks, limits] = await Promise.all([
      db.from('fact_sheets').select('*', { head: true, count: 'exact' }),
      db.from('chunks').select('*', { head: true, count: 'exact' }),
      db.from('nutrient_limits').select('*', { head: true, count: 'exact' }),
    ]);
    const err = sheets.error ?? chunks.error ?? limits.error;
    checks.push({
      name: 'supabase · service role + corpus',
      ok: !err && (chunks.count ?? 0) > 0,
      detail: err
        ? reason(err.message)
        : `${sheets.count} sheets · ${chunks.count} chunks · ${limits.count} limit rows`,
    });

    const { error: rpcErr } = await db.rpc('match_chunks', {
      query_embedding: Array(EMBEDDING_DIMS).fill(0),
      match_count: 1,
      filter_audience: 'consumer',
      filter_language: 'en',
      min_similarity: 0,
    });
    checks.push({ name: 'supabase · match_chunks RPC', ok: !rpcErr, detail: rpcErr ? reason(rpcErr.message) : 'callable' });
  } catch (e) {
    checks.push({ name: 'supabase · service role + corpus', ok: false, detail: reason(e) });
  }

  if (deep) {
    // --- Gemini: the embedding path ---
    try {
      const v = await embedQuery('vitamin d upper limit');
      checks.push({
        name: 'gemini · embeddings',
        ok: v.length === EMBEDDING_DIMS,
        detail: `${v.length} dimensions`,
      });
    } catch (e) {
      checks.push({ name: 'gemini · embeddings', ok: false, detail: reason(e) });
    }

    // --- Trussed: the generation path ---
    try {
      const text = await generate({
        system: 'Reply with the single word OK.',
        prompt: 'Health check.',
        maxTokens: 8,
        timeoutMs: 20000,
      });
      checks.push({ name: 'trussed · generation', ok: text.trim().length > 0, detail: 'responded' });
    } catch (e) {
      checks.push({ name: 'trussed · generation', ok: false, detail: reason(e) });
    }
  }

  const ok = checks.every((c) => c.ok);
  return NextResponse.json(
    { ok, deep, checkedAt: new Date().toISOString(), checks },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
