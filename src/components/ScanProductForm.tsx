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

interface LookupResult {
  matched: boolean;
  reason?: 'not_recognized' | 'no_dsld_match';
  message?: string;
  dsldId?: string;
  productName?: string;
  brandName?: string | null;
  identified?: { brandName: string | null; productName: string | null };
  items?: FoundItem[];
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
          <div className="relative overflow-hidden rounded-xl bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} autoPlay playsInline muted className="w-full" />
          </div>
          <p className="text-center text-xs text-slate-400">
            Frame the front of the bottle — brand and product name, not the ingredients panel.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={capturePhoto}
              className="rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800"
            >
              Capture
            </button>
            <button
              type="button"
              onClick={closeCamera}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : !previewUrl ? (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 rounded-xl border-2 border-dashed border-slate-300 py-8 text-center sm:flex-row sm:justify-center sm:gap-3">
            <button
              type="button"
              onClick={openCamera}
              className="mx-auto rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 sm:mx-0"
            >
              🎥 Use camera
            </button>
            <label
              htmlFor="scan-product-file-input"
              className="mx-auto cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700 sm:mx-0"
            >
              📁 Choose or take a photo
            </label>
          </div>
          {cameraError && <p className="text-sm text-red-700">{cameraError}</p>}
          <p className="text-center text-xs text-slate-400">
            Photograph the front of the bottle — e.g. &quot;Nature Made Super B-Complex&quot; — not the
            Supplement Facts panel.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <img src={previewUrl} alt="Product preview" className="max-h-72 w-full rounded-xl border border-slate-200 object-contain" />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning}
              className="rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {scanning ? 'Identifying…' : 'Identify product'}
            </button>
            <button
              type="button"
              onClick={resetToStart}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              Retake photo
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      {result && !result.matched && (
        <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          <p>{result.message}</p>
          {onNoMatch && (
            <button
              type="button"
              onClick={onNoMatch}
              className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700"
            >
              Photograph the Supplement Facts panel instead
            </button>
          )}
        </div>
      )}

      {result && result.matched && (
        <div className="space-y-3 rounded-xl border border-teal-200 bg-teal-50/40 p-4">
          <p className="text-sm font-semibold text-teal-900">
            ✓ Found it — {result.productName}
            {result.brandName ? ` (${result.brandName})` : ''}
          </p>
          <p className="text-xs text-slate-500">
            Sourced from NIH&apos;s Dietary Supplement Label Database, not read off the photo — this is
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
            onClick={resetToStart}
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
