'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

interface FoundItem {
  labelName: string;
  doseAmount: number | null;
  doseUnit: string | null;
  nihTracked: boolean;
}

interface DsldAlternate {
  id: string;
  fullName: string;
  brandName: string | null;
}

interface LookupResult {
  matched: boolean;
  reason?: 'not_recognized' | 'no_dsld_match';
  message?: string;
  dsldId?: string;
  productName?: string;
  brandName?: string | null;
  identified?: { brandName: string | null; productName: string | null };
  items?: FoundItem[];
  /** Other NIH records the same search turned up -- surfaced when the auto-picked
   * one might be the wrong variant (e.g. brand matches but a "with Vitamin C"
   * line the photo never showed does too). See dsld/client.ts scoreMatches(). */
  alternates?: DsldAlternate[];
}

// Same client-side downscale used by the Supplement-Facts scanner -- keeps
// the request small and fast without a server round trip just to find out
// a phone photo was several MB (or HEIC).
async function prepareImage(source: File | Blob): Promise<{ blob: Blob; type: string }> {
  const bitmap = await createImageBitmap(source);
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { blob: source, type: source.type || 'image/jpeg' };
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) return { blob: source, type: source.type || 'image/jpeg' };
  return { blob, type: 'image/jpeg' };
}

/**
 * "Scan a product" -- point a camera at the FRONT of a bottle (brand +
 * product name, not the Supplement Facts panel) and get back NIH's own
 * DSLD record as the source of truth. Replaced live barcode scanning
 * (native BarcodeDetector + @zxing/browser), which real-device testing
 * showed was unreliable -- see plan.md "Explicitly cut". Capture UX
 * deliberately mirrors ScanLabelForm's (camera or upload, preview, retake)
 * since that pattern already works well; only the photo's subject and the
 * endpoint it's sent to differ.
 */
export default function ScanProductForm({ onNoMatch }: { onNoMatch?: () => void }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [savingName, setSavingName] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOpen]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function resetToStart() {
    setPreviewUrl(null);
    setPendingBlob(null);
    setResult(null);
    setError(null);
    setNeedsAuth(false);
    setSavedNames(new Set());
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    resetToStart();
    setPendingBlob(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function openCamera() {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
    } catch {
      setCameraError('Could not access the camera — check your browser permissions, or upload a photo instead.');
    }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        closeCamera();
        resetToStart();
        setPendingBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
      },
      'image/jpeg',
      0.9,
    );
  }

  async function handleScan() {
    if (!pendingBlob || scanning) return;
    setScanning(true);
    setError(null);
    setResult(null);

    try {
      const { blob, type } = await prepareImage(pendingBlob);
      const form = new FormData();
      form.append('image', blob, `product.${type === 'image/jpeg' ? 'jpg' : 'png'}`);

      const res = await fetch('/api/scan-product', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Could not identify that product.');
        return;
      }
      setResult(data as LookupResult);
    } catch {
      setError('Could not identify that product. Check your connection and try again.');
    } finally {
      setScanning(false);
    }
  }

  /** User said the auto-picked NIH record is the wrong variant -- re-fetch by
   * the alternate's id directly, no new photo or vision call needed. */
  async function switchVariant(alt: DsldAlternate) {
    setSwitchingId(alt.id);
    setError(null);
    try {
      const form = new FormData();
      form.append('dsldId', alt.id);
      const res = await fetch('/api/scan-product', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Could not load that record.');
        return;
      }
      setSavedNames(new Set());
      setResult(data as LookupResult);
    } catch {
      setError('Could not load that record. Check your connection and try again.');
    } finally {
      setSwitchingId(null);
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
      setError('Could not save that item — try again.');
      return;
    }
    setSavedNames((prev) => new Set(prev).add(item.labelName));
    router.refresh();
  }

  const firstIngredient = result?.items?.[0]?.labelName ?? null;

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onPick}
        className="hidden"
        id="scan-product-file-input"
      />

      {cameraOpen ? (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="w-full" />
          </div>
          <p className="text-center text-xs text-slate-500">
            Frame the front of the bottle — brand and product name, not the ingredients panel.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={capturePhoto}
              className="rounded-md bg-gradient-to-r from-[#7557f8] to-[#32d1b0] px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Capture
            </button>
            <button
              type="button"
              onClick={closeCamera}
              className="rounded-md px-3.5 py-2 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : !previewUrl ? (
        <div className="space-y-2">
          <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-violet-300/30 bg-[#07111f]/70 px-5 py-8 text-center">
            <p className="max-w-md text-sm leading-relaxed text-slate-300">
              Scan the front of the bottle first. ClearLabel will try to match the product to NIH&apos;s
              Dietary Supplement Label Database.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={openCamera}
                className="mx-auto rounded-md bg-gradient-to-r from-[#7557f8] to-[#32d1b0] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 sm:mx-0"
              >
                Use camera
              </button>
              <label
                htmlFor="scan-product-file-input"
                className="mx-auto cursor-pointer rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-violet-300/40 hover:text-white sm:mx-0"
              >
                Choose photo
              </label>
            </div>
          </div>
          {cameraError && <p className="text-sm text-red-200">{cameraError}</p>}
          <p className="text-center text-xs text-slate-500">
            Photograph the front of the bottle, not the Supplement Facts panel.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Product preview" className="max-h-72 w-full rounded-lg border border-white/10 bg-[#07111f] object-contain" />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning}
              className="rounded-md bg-gradient-to-r from-[#7557f8] to-[#32d1b0] px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {scanning ? 'Looking up this product in NIH DSLD...' : 'Identify product'}
            </button>
            <button
              type="button"
              onClick={resetToStart}
              className="rounded-md px-3.5 py-2 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              Retake photo
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-200">{error}</p>}

      {result && !result.matched && (
        <div className="rounded-lg border border-amber-300/25 bg-amber-300/[0.08] p-4 text-sm text-amber-50">
          <p>{result.message}</p>
          {onNoMatch && (
            <button
              type="button"
              onClick={onNoMatch}
              className="mt-3 rounded-md border border-amber-200/25 bg-white/5 px-3 py-1.5 text-sm font-semibold text-amber-50 transition hover:border-amber-200/50"
            >
              Photograph the Supplement Facts panel instead
            </button>
          )}
        </div>
      )}

      {result && result.matched && (
        <div className="space-y-5 rounded-lg border border-teal-300/20 bg-teal-300/[0.06] p-5">
          <div className="grid gap-5 lg:grid-cols-[11rem_minmax(0,1fr)]">
            <div className="flex min-h-48 items-center justify-center rounded-lg border border-white/10 bg-[#07111f] p-4">
              <div className="h-36 w-20 rounded-b-lg rounded-t-[1.6rem] border border-white/20 bg-gradient-to-b from-slate-100 to-slate-300 p-2">
                <div className="h-5 rounded-sm bg-slate-950" />
                <div className="mt-4 rounded-md border border-slate-950 bg-white p-2 text-[0.52rem] leading-tight text-slate-950">
                  <p className="font-bold">Supplement Facts</p>
                  <div className="mt-1 h-px bg-slate-950" />
                  <p className="mt-1">DSLD label data</p>
                </div>
              </div>
            </div>
            <div className="min-w-0">
              <div className="mb-3 inline-flex rounded-full border border-teal-300/25 bg-teal-300/10 px-3 py-1 text-xs font-bold text-teal-100">
                Found in NIH Database (DSLD)
              </div>
              <h2 className="text-2xl font-bold text-white">{result.productName}</h2>
              {result.brandName && <p className="mt-1 text-sm text-slate-400">Brand: {result.brandName}</p>}
              {result.dsldId && <p className="mt-2 font-mono text-xs text-slate-500">DSLD ID {result.dsldId}</p>}
              <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-300">
                According to the product label in NIH DSLD, this record lists the ingredient rows
                below. DSLD is a label database; it does not mean NIH endorses or independently
                verifies the product.
              </p>
            </div>
          </div>

          {(result.alternates ?? []).length > 0 && (
            <div className="rounded-lg border border-amber-300/25 bg-amber-300/[0.08] p-3 text-xs text-amber-50">
              <p className="mb-2">
                Not the right one? Same brand, different NIH record — a manufacturer often sells more
                than one version:
              </p>
              <div className="flex flex-wrap gap-2">
                {(result.alternates ?? []).map((alt) => (
                  <button
                    key={alt.id}
                    type="button"
                    onClick={() => switchVariant(alt)}
                    disabled={switchingId !== null}
                    className="rounded-md border border-amber-200/25 bg-white/5 px-2.5 py-1 font-medium text-amber-50 transition hover:border-amber-200/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {switchingId === alt.id ? 'Loading…' : alt.fullName}
                    {alt.brandName ? ` — ${alt.brandName}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="rounded-lg border border-white/10 bg-[#07111f]/70 p-4">
              <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div>
                  <h3 className="text-base font-semibold text-white">Major ingredients</h3>
                  <p className="mt-1 text-xs text-slate-500">According to the product label</p>
                </div>
                {firstIngredient && (
                  <Link
                    href={{ pathname: '/ask', query: { q: `What does NIH say about ${firstIngredient}?` } }}
                    className="rounded-md border border-violet-300/25 bg-violet-300/10 px-3 py-2 text-sm font-semibold text-violet-100 transition hover:border-violet-200/50"
                  >
                    View NIH Evidence
                  </Link>
                )}
              </div>
          {(result.items ?? []).length === 0 ? (
                <p className="text-sm text-slate-500">NIH&apos;s record for this product has no listed ingredient rows.</p>
          ) : (
                <ul className="space-y-3">
              {(result.items ?? []).map((item, i) => {
                const saved = savedNames.has(item.labelName);
                return (
                  <li
                    key={i}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-3"
                  >
                        <span className="min-w-0 flex-1 text-sm text-slate-100">{item.labelName}</span>
                        <span className="font-mono text-sm text-slate-300">
                          {item.doseAmount != null ? `${item.doseAmount} ${item.doseUnit ?? ''}` : '-'}
                    </span>
                    <span
                      title={
                        item.nihTracked
                          ? 'NIH publishes an upper limit for this nutrient'
                          : "NIH doesn't publish a limit for this — won't be dose-checked"
                      }
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                            item.nihTracked
                              ? 'bg-teal-300/[0.15] text-teal-100 ring-1 ring-teal-300/25'
                              : 'bg-white/5 text-slate-400 ring-1 ring-white/10'
                      }`}
                    >
                          {item.nihTracked ? 'NIH-tracked' : 'No NIH limit'}
                    </span>
                    <button
                      type="button"
                      onClick={() => addItem(item)}
                      disabled={saved || savingName === item.labelName}
                          className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
                    >
                          {saved ? 'Added' : savingName === item.labelName ? 'Saving...' : 'Add to My Stack'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
            </div>

            <aside className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4 text-slate-950">
              <h3 className="text-xl font-black">Supplement Facts</h3>
              <p className="mt-2 text-xs font-semibold">Serving data as available from DSLD</p>
              <div className="mt-3 h-1 bg-slate-950" />
              <div className="flex justify-between gap-3 border-b-2 border-slate-950 py-2 text-xs font-bold">
                <span>Ingredient</span>
                <span>Amount</span>
              </div>
              <div className="divide-y divide-slate-300">
                {(result.items ?? []).slice(0, 7).map((item, i) => (
                  <div key={`${item.labelName}-${i}`} className="flex justify-between gap-3 py-2 text-sm">
                    <span className="font-semibold">{item.labelName}</span>
                    <span className="shrink-0 font-mono">
                      {item.doseAmount != null ? `${item.doseAmount} ${item.doseUnit ?? ''}` : '-'}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 border-t-2 border-slate-950 pt-3 text-xs leading-relaxed">
                Product information comes from the manufacturer&apos;s label in NIH DSLD.
              </p>
            </aside>
          </div>

          <button
            type="button"
            onClick={resetToStart}
            className="rounded-md px-3 py-2 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            Scan another product
          </button>
        </div>
      )}

      {needsAuth && (
        <p className="text-sm text-amber-100">
          <Link href="/login" className="font-semibold underline">
            Sign in
          </Link>{' '}
          to save this to My Stack.
        </p>
      )}
    </div>
  );
}
