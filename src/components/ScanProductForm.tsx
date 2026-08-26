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

// Auto-capture tuning. Deliberately simple (frame-to-frame stillness on a
// tiny grayscale downscale) rather than any kind of symbol/shape detection --
// that's exactly the category of thing that turned out to be unreliable on
// real hardware for barcodes. This only ever decides *when* to take the same
// photo a manual tap would, never what's in it.
const AUTO_MAX_FAILS = 2;
const AUTO_SAMPLE_INTERVAL_MS = 350;
const AUTO_STABLE_FRAMES_NEEDED = 3;
const AUTO_MOTION_THRESHOLD = 4;
const AUTO_MIN_BRIGHTNESS = 15;
const AUTO_SAMPLE_W = 32;
const AUTO_SAMPLE_H = 24;

function sampleGray(video: HTMLVideoElement, canvas: HTMLCanvasElement): Uint8ClampedArray | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    gray[i] = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
  }
  return gray;
}

function meanAbsDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function meanBrightness(a: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  return sum / a.length;
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

  // Auto-capture: try it first every time the camera opens; after two
  // consecutive misses, fall back to manual-only for the rest of this scan
  // session (reset on "Scan another product" / retake / upload). This is
  // NOT symbol decoding -- the thing that made barcode scanning unreliable
  // on real hardware -- it's a plain frame-stillness heuristic: sample a
  // tiny grayscale downscale of the video a few times a second, and once
  // it stops changing for about a second, snap a full-res frame and run it
  // through the same identify call a manual capture uses.
  const [autoMode, setAutoMode] = useState(true);
  const autoFailCountRef = useRef(0);
  const autoBusyRef = useRef(false);
  const prevSampleRef = useRef<Uint8ClampedArray | null>(null);
  const stableStreakRef = useRef(0);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOpen]);

  useEffect(() => {
    if (!cameraOpen || !autoMode || scanning) return;
    if (!sampleCanvasRef.current) {
      const c = document.createElement('canvas');
      c.width = AUTO_SAMPLE_W;
      c.height = AUTO_SAMPLE_H;
      sampleCanvasRef.current = c;
    }
    prevSampleRef.current = null;
    stableStreakRef.current = 0;

    const id = window.setInterval(() => {
      if (autoBusyRef.current) return;
      const video = videoRef.current;
      const canvas = sampleCanvasRef.current;
      if (!video || !canvas || video.videoWidth === 0) return;

      const sample = sampleGray(video, canvas);
      if (!sample) return;

      if (meanBrightness(sample) < AUTO_MIN_BRIGHTNESS) {
        stableStreakRef.current = 0;
      } else if (prevSampleRef.current) {
        const diff = meanAbsDiff(sample, prevSampleRef.current);
        stableStreakRef.current = diff < AUTO_MOTION_THRESHOLD ? stableStreakRef.current + 1 : 0;
      }
      prevSampleRef.current = sample;

      if (stableStreakRef.current >= AUTO_STABLE_FRAMES_NEEDED) {
        stableStreakRef.current = 0;
        autoBusyRef.current = true;
        void triggerAutoCapture();
      }
    }, AUTO_SAMPLE_INTERVAL_MS);

    return () => window.clearInterval(id);
    // triggerAutoCapture/openCamera/closeCamera intentionally omitted: they're
    // plain function declarations that get a new identity every render, and
    // this loop should only restart when camera/mode/scanning actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen, autoMode, scanning]);

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
    autoFailCountRef.current = 0;
    setAutoMode(true);
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

  async function doScan(source: Blob): Promise<LookupResult> {
    const { blob, type } = await prepareImage(source);
    const form = new FormData();
    form.append('image', blob, `product.${type === 'image/jpeg' ? 'jpg' : 'png'}`);
    const res = await fetch('/api/scan-product', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) {
      return { matched: false, message: data?.error ?? 'Could not identify that product.' };
    }
    return data as LookupResult;
  }

  async function handleScan() {
    if (!pendingBlob || scanning) return;
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await doScan(pendingBlob));
    } catch {
      setError('Could not identify that product. Check your connection and try again.');
    } finally {
      setScanning(false);
    }
  }

  /** Fires when the auto-detect loop decides the frame has held still long enough. */
  async function triggerAutoCapture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      autoBusyRef.current = false;
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      autoBusyRef.current = false;
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) {
      autoBusyRef.current = false;
      return;
    }

    closeCamera();
    setPendingBlob(blob);
    setPreviewUrl(URL.createObjectURL(blob));
    setError(null);
    setScanning(true);

    try {
      const data = await doScan(blob);
      if (data.matched) {
        setResult(data);
        return;
      }
      autoFailCountRef.current += 1;
      if (autoFailCountRef.current >= AUTO_MAX_FAILS) {
        // Two misses -- stop guessing on our own and hand control back.
        setAutoMode(false);
        setResult(data);
      } else {
        // Quiet retry: don't surface a miss the user never asked about,
        // just keep watching.
        setResult(null);
        setPendingBlob(null);
        setPreviewUrl(null);
        await openCamera();
      }
    } catch {
      autoFailCountRef.current += 1;
      if (autoFailCountRef.current >= AUTO_MAX_FAILS) {
        setAutoMode(false);
        setError('Could not identify that product. Check your connection and try again.');
      } else {
        setPendingBlob(null);
        setPreviewUrl(null);
        await openCamera();
      }
    } finally {
      setScanning(false);
      autoBusyRef.current = false;
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
            {autoMode
              ? 'Hold the bottle steady in frame — it captures automatically. You can also tap Capture any time.'
              : "Auto-detect is off for this scan — frame the bottle's front and tap Capture."}
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
          {!autoMode && (
            <p className="mt-2 text-xs text-amber-800">
              Auto-detect couldn&apos;t find a match after two tries. Line the label up yourself and
              tap Capture.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {!autoMode && (
              <button
                type="button"
                onClick={() => openCamera()}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700"
              >
                Open camera
              </button>
            )}
            {onNoMatch && (
              <button
                type="button"
                onClick={onNoMatch}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700"
              >
                Photograph the Supplement Facts panel instead
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
