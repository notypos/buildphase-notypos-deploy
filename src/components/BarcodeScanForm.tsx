'use client';

import { useEffect, useRef, useState } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

interface FoundItem {
  labelName: string;
  doseAmount: number | null;
  doseUnit: string | null;
  nihTracked: boolean;
}

interface LookupResult {
  matched: boolean;
  reason?: 'no_upc_match' | 'no_dsld_match';
  message?: string;
  dsldId?: string;
  productName?: string;
  brandName?: string | null;
  items?: FoundItem[];
}

/**
 * Live barcode scanning via @zxing/browser -- runs entirely client-side
 * against the camera stream, no server round trip just to detect a code.
 * Once a barcode is decoded, /api/product-lookup does the actual
 * barcode -> UPC database -> DSLD chain (see that route for why two hops).
 */
export default function BarcodeScanForm({ onNoMatch }: { onNoMatch?: () => void }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastCodeRef = useRef<string | null>(null);
  const lookingRef = useRef(false);

  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [savingName, setSavingName] = useState<string | null>(null);

  function stopScanning() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }

  useEffect(() => stopScanning, []);

  async function handleDecoded(barcode: string) {
    lookingRef.current = true;
    setLooking(true);
    setLookupError(null);
    try {
      const res = await fetch('/api/product-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode }),
      });
      const data = (await res.json()) as LookupResult & { error?: string };
      if (!res.ok) {
        setLookupError(data.error ?? 'Could not look that up.');
        lastCodeRef.current = null;
        return;
      }
      setResult(data);
      if (data.matched) {
        stopScanning();
      } else {
        lastCodeRef.current = null; // let the same or a different code retrigger
      }
    } catch {
      setLookupError('Could not reach the lookup service. Check your connection.');
      lastCodeRef.current = null;
    } finally {
      lookingRef.current = false;
      setLooking(false);
    }
  }

  async function startScanning() {
    setCameraError(null);
    setResult(null);
    setLookupError(null);
    lastCodeRef.current = null;

    try {
      // Lazy import: zxing pulls in its full decoding library, no reason to
      // ship it in the initial bundle for people who never open the scanner.
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      setScanning(true);

      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current ?? undefined,
        (result) => {
          // `error` fires on essentially every frame with no code in view
          // (zxing's NotFoundException) -- that's expected, not a failure,
          // so it's deliberately not read here at all.
          if (!result || lookingRef.current) return;
          const text = result.getText();
          if (text === lastCodeRef.current) return;
          lastCodeRef.current = text;
          void handleDecoded(text);
        },
      );
      controlsRef.current = controls;
    } catch {
      setCameraError('Could not access the camera — check your browser permissions.');
      setScanning(false);
    }
  }

  async function addItem(item: FoundItem) {
    setSavingName(item.labelName);
    setNeedsAuth(false);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setNeedsAuth(true);
      setSavingName(null);
      return;
    }

    const { error: insertError } = await supabase.from('stack_items').insert({
      user_id: user.id,
      label_name: item.labelName,
      supplement: item.labelName,
      dsld_id: result?.dsldId ?? null,
      dose_amount: item.doseAmount,
      dose_unit: item.doseAmount != null ? item.doseUnit : null,
    });

    setSavingName(null);
    if (insertError) {
      setLookupError('Could not save that item — try again.');
      return;
    }
    setSavedNames((prev) => new Set(prev).add(item.labelName));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {!scanning && !result && (
        <div className="rounded-xl border-2 border-dashed border-slate-300 py-8 text-center">
          <button
            type="button"
            onClick={() => void startScanning()}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            📷 Scan a barcode
          </button>
          {cameraError && <p className="mt-2 text-sm text-red-700">{cameraError}</p>}
        </div>
      )}

      {scanning && (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} autoPlay playsInline muted className="w-full" />
            <div className="pointer-events-none absolute inset-x-10 top-1/2 h-20 -translate-y-1/2 rounded-lg border-4 border-teal-400" />
            {looking && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
                Looking it up…
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={stopScanning}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
        </div>
      )}

      {lookupError && <p className="text-sm text-red-700">{lookupError}</p>}

      {result && !result.matched && (
        <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          <p>{result.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startScanning()}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
            >
              Scan again
            </button>
            {onNoMatch && (
              <button
                type="button"
                onClick={onNoMatch}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700"
              >
                Photograph the label instead
              </button>
            )}
          </div>
        </div>
      )}

      {result && result.matched && (
        <div className="space-y-3 rounded-xl border border-teal-200 bg-teal-50/40 p-4">
          <p className="text-sm font-semibold text-teal-900">
            ✓ Found it — {result.productName}
            {result.brandName ? ` (${result.brandName})` : ''}
          </p>
          <p className="text-xs text-slate-500">
            Sourced from NIH&apos;s Dietary Supplement Label Database, not read off a photo — this is
            the manufacturer-submitted label NIH has on file.
          </p>
          {(result.items ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">NIH&apos;s record for this product has no listed ingredient rows.</p>
          ) : (
            <ul className="space-y-3">
              {(result.items ?? []).map((item, i) => {
                const saved = savedNames.has(item.labelName);
                return (
                  <li
                    key={i}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3"
                  >
                    <span className="min-w-0 flex-1 text-sm">{item.labelName}</span>
                    <span className="text-sm text-slate-500">
                      {item.doseAmount != null ? `${item.doseAmount} ${item.doseUnit ?? ''}` : '—'}
                    </span>
                    <span
                      title={
                        item.nihTracked
                          ? 'NIH publishes an upper limit for this nutrient'
                          : "NIH doesn't publish a limit for this — won't be dose-checked"
                      }
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.nihTracked ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {item.nihTracked ? '✓ NIH-tracked' : 'ℹ no NIH limit'}
                    </span>
                    <button
                      type="button"
                      onClick={() => addItem(item)}
                      disabled={saved || savingName === item.labelName}
                      className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {saved ? 'Added ✓' : savingName === item.labelName ? 'Saving…' : 'Add to My Stack'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              setResult(null);
              lastCodeRef.current = null;
            }}
            className="text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            Scan another product
          </button>
        </div>
      )}

      {needsAuth && (
        <p className="text-sm text-amber-800">
          <Link href="/login" className="font-medium underline">
            Sign in
          </Link>{' '}
          to save this to My Stack.
        </p>
      )}
    </div>
  );
}
