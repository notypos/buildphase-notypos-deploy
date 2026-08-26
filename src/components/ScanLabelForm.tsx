'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const UNITS = ['mcg', 'mg', 'g', 'iu'] as const;
type Unit = (typeof UNITS)[number];

interface ScanItem {
  labelName: string;
  doseAmount: number | null;
  doseUnit: Unit | null;
  nihTracked: boolean;
}

interface ScanResult {
  productName: string | null;
  items: ScanItem[];
  readable: boolean;
  note: string | null;
}

// Downscale + re-encode client-side before upload. iPhone photos can be
// several MB (or HEIC); this keeps the request small and fast without a
// server round trip just to find out the photo was too big.
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

type FrameHint = 'dark' | 'bright' | 'blurry' | 'good';

const HINT_TEXT: Record<FrameHint, string> = {
  dark: '🔅 Too dark — find more light',
  bright: '🔆 Too bright — reduce glare',
  blurry: '📳 Hold steady',
  good: '✅ Looks good',
};

// Cheap, local (no library, no network) live-quality read on the camera
// preview: average brightness + a rough sharpness proxy from a downsized
// grayscale sample. Not as good as a dedicated document-scanning SDK, but
// gives the same kind of "adjust for brightness" nudge for free.
function sampleFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): FrameHint | null {
  if (video.videoWidth === 0) return null;
  const w = 80;
  const h = Math.round((video.videoHeight / video.videoWidth) * w);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let sum = 0;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = g;
    sum += g;
  }
  const brightness = sum / gray.length;
  if (brightness < 55) return 'dark';
  if (brightness > 215) return 'bright';

  // Sharpness proxy: mean absolute difference between horizontally adjacent
  // pixels. A blurry/out-of-focus frame has much smaller local contrast.
  let diffSum = 0;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w; x++) {
      diffSum += Math.abs(gray[y * w + x] - gray[y * w + x - 1]);
      count++;
    }
  }
  const sharpness = diffSum / count;
  if (sharpness < 4) return 'blurry';
  return 'good';
}

export default function ScanLabelForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [frameHint, setFrameHint] = useState<FrameHint | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [savingName, setSavingName] = useState<string | null>(null);

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOpen]);

  // Live brightness/sharpness feedback while the camera is open.
  useEffect(() => {
    if (!cameraOpen) return;
    const canvas = sampleCanvasRef.current ?? document.createElement('canvas');
    sampleCanvasRef.current = canvas;
    const id = setInterval(() => {
      if (!videoRef.current) return;
      setFrameHint(sampleFrame(videoRef.current, canvas));
    }, 400);
    return () => clearInterval(id);
  }, [cameraOpen]);

  useEffect(() => {
    // Stop the camera on unmount so the browser's "recording" indicator
    // doesn't stay lit after leaving the page.
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
    setFrameHint(null);
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
      form.append('image', blob, `label.${type === 'image/jpeg' ? 'jpg' : 'png'}`);

      const res = await fetch('/api/scan', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Could not read that label.');
        return;
      }
      setResult(data as ScanResult);
    } catch {
      setError('Could not read that label. Check your connection and try again.');
    } finally {
      setScanning(false);
    }
  }

  async function addItem(item: ScanItem) {
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
      dose_amount: item.doseAmount,
      dose_unit: item.doseAmount ? item.doseUnit : null,
    });

    setSavingName(null);
    if (insertError) {
      setError('Could not save that item — try again.');
      return;
    }
    setSavedNames((prev) => new Set(prev).add(item.labelName));
    router.refresh();
  }

  function updateItem(index: number, patch: Partial<ScanItem>) {
    setResult((prev) => {
      if (!prev) return prev;
      const items = prev.items.slice();
      items[index] = { ...items[index], ...patch };
      return { ...prev, items };
    });
  }

  const bracket = 'absolute h-8 w-8 border-teal-400';

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onPick}
        className="hidden"
        id="scan-file-input"
      />

      {cameraOpen ? (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} autoPlay playsInline muted className="w-full" />

            {/* Viewfinder guide: a centered rectangle with corner brackets,
                like a document/QR scanner, so it's obvious where to frame
                the label. Purely visual — capture isn't cropped to it. */}
            <div className="pointer-events-none absolute inset-6 sm:inset-10">
              <div className={`${bracket} top-0 left-0 rounded-tl-lg border-t-4 border-l-4`} />
              <div className={`${bracket} top-0 right-0 rounded-tr-lg border-t-4 border-r-4`} />
              <div className={`${bracket} bottom-0 left-0 rounded-bl-lg border-b-4 border-l-4`} />
              <div className={`${bracket} bottom-0 right-0 rounded-br-lg border-b-4 border-r-4`} />
            </div>

            {frameHint && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
                {HINT_TEXT[frameHint]}
              </div>
            )}
          </div>
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
              htmlFor="scan-file-input"
              className="mx-auto cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700 sm:mx-0"
            >
              📁 Choose or take a photo
            </label>
          </div>
          {cameraError && <p className="text-sm text-red-700">{cameraError}</p>}
          <p className="text-center text-xs text-slate-400">
            On a phone, &quot;Choose or take a photo&quot; also offers your camera directly.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <img src={previewUrl} alt="Label preview" className="max-h-72 w-full rounded-xl border border-slate-200 object-contain" />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning}
              className="rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {scanning ? 'Reading label…' : 'Scan label'}
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
      {needsAuth && (
        <p className="text-sm text-amber-800">
          <Link href="/login" className="font-medium underline">
            Sign in
          </Link>{' '}
          to save this to My Stack.
        </p>
      )}

      {result && !result.readable && (
        <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          Couldn&apos;t read a Supplement Facts panel in that photo. Try again with the label flat, in
          focus, and well lit.
        </p>
      )}

      {result && result.readable && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-4">
          {result.productName && <p className="text-sm font-semibold text-slate-900">{result.productName}</p>}
          {result.note && <p className="text-xs text-slate-500">Note: {result.note}</p>}
          {result.items.length === 0 ? (
            <p className="text-sm text-slate-500">No ingredient rows were found.</p>
          ) : (
            <ul className="space-y-3">
              {result.items.map((item, i) => {
                const saved = savedNames.has(item.labelName);
                return (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3">
                    <input
                      type="text"
                      value={item.labelName}
                      onChange={(e) => updateItem(i, { labelName: e.target.value })}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
                    />
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={item.doseAmount ?? ''}
                      onChange={(e) =>
                        updateItem(i, { doseAmount: e.target.value === '' ? null : Number(e.target.value) })
                      }
                      placeholder="dose"
                      className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
                    />
                    <select
                      value={item.doseUnit ?? ''}
                      onChange={(e) => updateItem(i, { doseUnit: (e.target.value || null) as Unit | null })}
                      disabled={item.doseAmount === null}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="">—</option>
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <span
                      title={
                        item.nihTracked
                          ? 'NIH publishes an upper limit for this nutrient'
                          : "NIH doesn't publish a limit for this — won't be dose-checked"
                      }
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.nihTracked ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {item.nihTracked ? '✓ NIH-tracked' : 'ℹ no NIH limit'}
                    </span>
                    <button
                      type="button"
                      onClick={() => addItem(item)}
                      disabled={saved || savingName === item.labelName || !item.labelName.trim()}
                      className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {saved ? 'Added ✓' : savingName === item.labelName ? 'Saving…' : 'Add to My Stack'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
