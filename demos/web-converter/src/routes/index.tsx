import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import {
  encodeGainMap,
  type FloatImageData,
  readExr,
  readHdr,
  type ToneMappingType,
  writeExr,
  writeHdr,
  writeJpegGainMap,
} from 'hdrify';
import { Download } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

/** Display mode: 'none' = Direct HDR (no tone mapping), or a real tone mapping type */
type DisplayMode = ToneMappingType | 'none';

import { FloatImageCanvas } from '@/components/FloatImageCanvas';
import { FloatImageCanvasHDR } from '@/components/FloatImageCanvasHDR';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useHdrCanvasSupport } from '@/hooks/useHdrCanvasSupport';
import { cn } from '@/lib/utils';

const indexSearchSchema = z.object({
  image: z.string().min(1).optional(),
});

export type IndexSearch = z.infer<typeof indexSearchSchema>;

export const Route = createFileRoute('/')({
  component: Index,
  validateSearch: zodValidator(indexSearchSchema),
});

/** EXR compression type → display name (matches OpenEXR standard) */
const EXR_COMPRESSION_NAMES: Record<number, string> = {
  0: 'none',
  1: 'RLE',
  2: 'ZIPS',
  3: 'ZIP',
  4: 'PIZ',
  5: 'PXR24',
  6: 'B44',
  7: 'B44A',
};

const EXAMPLE_FILES: { value: string; label: string }[] = [
  { value: '/examples/blouberg_sunrise_2_1k.hdr', label: 'Blouberg Sunrise 1k (HDR)' },
  { value: '/examples/moonless_golf_1k.hdr', label: 'Moonless Golf 1k (HDR)' },
  { value: '/examples/pedestrian_overpass_1k.hdr', label: 'Pedestrian Overpass 1k (HDR)' },
  { value: '/examples/rainbow.hdr', label: 'Rainbow (HDR)' },
  { value: '/examples/example_halfs.exr', label: 'Example half float (EXR)' },
  { value: '/examples/example_piz.exr', label: 'Example PIZ compression (EXR)' },
  { value: '/examples/example_pxr24.exr', label: 'Example PXR24 (EXR)' },
  { value: '/examples/example_rle.exr', label: 'Example RLE compression (EXR)' },
  { value: '/examples/example_wideColorSpace.exr', label: 'Example wide color space (EXR)' },
  { value: '/examples/example_zip.exr', label: 'Example ZIP compression (EXR)' },
  { value: '/examples/example_zips.exr', label: 'Example ZIPS compression (EXR)' },
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Index() {
  const navigate = useNavigate();
  const { image: imageParam } = Route.useSearch();
  const hdrSupported = useHdrCanvasSupport();
  const [imageData, setImageData] = useState<FloatImageData | null>(null);
  const [exposure, setExposure] = useState(1.0);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('neutral');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedExampleUrl, setSelectedExampleUrl] = useState<string>('');
  const [loadingExample, setLoadingExample] = useState(false);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevHdrSupportedRef = useRef(false);

  // Default to Direct HDR when HDR support is first detected
  useEffect(() => {
    if (hdrSupported && !prevHdrSupportedRef.current) {
      setDisplayMode('none');
    }
    prevHdrSupportedRef.current = hdrSupported;
  }, [hdrSupported]);

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);

        const ext = file.name.toLowerCase().split('.').pop();
        let parsed: FloatImageData;

        if (ext === 'exr') {
          parsed = readExr(buffer);
        } else if (ext === 'hdr') {
          parsed = readHdr(buffer);
        } else {
          toast.error('Unsupported file format. Please use .exr or .hdr files.');
          return;
        }

        setImageData(parsed);
        setSourceFileName(file.name);
        setSelectedExampleUrl('');
        void navigate({ to: '.', search: {} as IndexSearch });
      } catch (error) {
        console.error('Error parsing file:', error);
        toast.error(`Error parsing file: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [navigate],
  );

  const loadFromUrl = useCallback(async (url: string) => {
    setLoadingExample(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);
      const ext = url.toLowerCase().split('.').pop() ?? '';
      let parsed: FloatImageData;
      if (ext === 'exr') {
        parsed = readExr(buffer);
      } else if (ext === 'hdr') {
        parsed = readHdr(buffer);
      } else {
        toast.error('Unsupported format. Example must be .exr or .hdr.');
        return;
      }
      setImageData(parsed);
      setSourceFileName(url.split('/').pop() ?? '');
      setSelectedExampleUrl(url);
      toast.success('Example loaded');
    } catch (error) {
      console.error('Error loading example:', error);
      toast.error(`Failed to load example: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoadingExample(false);
    }
  }, []);

  // Load image from URL when ?image= is present (shared link or example selection)
  useEffect(() => {
    if (!imageParam) return;
    void loadFromUrl(imageParam);
  }, [imageParam, loadFromUrl]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      const file = files[0];
      if (file) {
        void handleFile(file);
      }
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      const file = files?.[0];
      if (file) {
        void handleFile(file);
      }
    },
    [handleFile],
  );

  const handleExposureChange = useCallback((value: number[]) => {
    setExposure(value[0] ?? 1);
  }, []);

  const handleDownloadExr = useCallback(() => {
    if (!imageData) return;
    const bytes = writeExr(imageData);
    const blob = new Blob([bytes], { type: 'image/x-exr' });
    downloadBlob(blob, 'image.exr');
  }, [imageData]);

  const handleDownloadHdr = useCallback(() => {
    if (!imageData) return;
    const bytes = writeHdr(imageData);
    const blob = new Blob([bytes], { type: 'image/vnd.radiance' });
    downloadBlob(blob, 'image.hdr');
  }, [imageData]);

  const handleDownloadJpegR = useCallback(() => {
    if (!imageData) return;
    const toneMappingForEncode = displayMode === 'none' ? 'neutral' : displayMode;
    const encoding = encodeGainMap(imageData, { toneMapping: toneMappingForEncode });
    const bytes = writeJpegGainMap(encoding, { quality: 90 });
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    downloadBlob(blob, 'image.jpg');
  }, [imageData, displayMode]);

  const handleAreaClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="flex flex-1 flex-col p-4">
      <p className="mb-4 text-sm text-muted-foreground">
        This is a web demo of the {/** biome-ignore assist/source/useSortedAttributes: <explanation> */}
        <a
          href="https://github.com/bhouston/hdrify"
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'underline' }}
        >
          HDRify library
        </a>
        , which can read/write HDR, EXR, and JPEG-R and apply tone mapping transformations.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Examples</span>
        <Select
          disabled={loadingExample}
          onValueChange={(value) => void navigate({ to: '/', search: { image: value } as IndexSearch })}
          value={selectedExampleUrl}
        >
          <SelectTrigger className="w-[280px]" size="sm">
            <SelectValue placeholder="Load an example…" />
          </SelectTrigger>
          <SelectContent>
            {EXAMPLE_FILES.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left: vertical exposure slider (only when image loaded) */}
        {imageData && (
          <div className="flex min-w-[10.5rem] flex-col items-center gap-3">
            <div className="flex w-full flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Tone mapping</span>
              <Select onValueChange={(v) => setDisplayMode(v as DisplayMode)} value={displayMode}>
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {hdrSupported && <SelectItem value="none">Direct HDR</SelectItem>}
                  <SelectItem value="aces">ACES</SelectItem>
                  <SelectItem value="reinhard">Reinhard</SelectItem>
                  <SelectItem value="neutral">Khronos Neutral</SelectItem>
                  <SelectItem value="agx">AgX (Blender)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Exposure</span>
              <div className="flex h-48 flex-1 items-center">
                <Slider
                  className="h-full"
                  max={10}
                  min={0.1}
                  onValueChange={handleExposureChange}
                  orientation="vertical"
                  step={0.1}
                  value={[exposure]}
                />
              </div>
              <span className="text-xs text-muted-foreground">{exposure.toFixed(1)}</span>
            </div>
          </div>
        )}

        {/* Center: integrated drop zone + image viewer */}
        <button
          aria-label="Drop EXR or HDR file here, or click to select a file"
          className={cn(
            'flex min-h-[400px] w-full flex-1 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed bg-transparent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 bg-muted/30 hover:border-muted-foreground/50',
          )}
          onClick={handleAreaClick}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          type="button"
        >
          <input accept=".exr,.hdr" className="sr-only" onChange={handleFileInput} ref={fileInputRef} type="file" />
          {imageData ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4">
              <div className="flex min-h-0 flex-1 items-center justify-center">
                {hdrSupported && displayMode === 'none' ? (
                  <FloatImageCanvasHDR
                    className="max-h-full max-w-full rounded object-contain"
                    exposure={exposure}
                    imageData={imageData}
                    toneMapping="neutral"
                  />
                ) : (
                  <FloatImageCanvas
                    className="max-h-full max-w-full rounded object-contain"
                    exposure={exposure}
                    imageData={imageData}
                    toneMapping={displayMode === 'none' ? 'neutral' : displayMode}
                  />
                )}
              </div>
              <p className="shrink-0 text-center text-xs text-muted-foreground">
                Drag another file here or click to load a different image
              </p>
            </div>
          ) : (
            <div className="text-center text-muted-foreground">
              <p className="text-lg">{isDragging ? 'Drop the file here' : 'Drop EXR or HDR here'}</p>
              <p className="mt-1 text-sm">or click to select a file.</p>
              <p className="mt-1 text-sm">Or load an example image by clicking the <b>Examples dropdown</b>.</p>
            </div>
          )}
        </button>

        {/* Right: download buttons (only when image loaded) */}
        {imageData && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Download</span>
            <Button
              className="justify-start gap-2"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadExr();
              }}
              size="sm"
              variant="outline"
            >
              <Download className="size-4" />
              EXR
            </Button>
            <Button
              className="justify-start gap-2"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadHdr();
              }}
              size="sm"
              variant="outline"
            >
              <Download className="size-4" />
              HDR
            </Button>
            <Button
              className="justify-start gap-2"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadJpegR();
              }}
              size="sm"
              variant="outline"
            >
              <Download className="size-4" />
              UltraHDR JPEG
            </Button>
            <div className="mt-4 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Info</span>
              <dl className="flex flex-col gap-1 text-xs text-muted-foreground">
                <div className="flex justify-between gap-4">
                  <dt className="text-foreground">Width</dt>
                  <dd>{imageData.width}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-foreground">Height</dt>
                  <dd>{imageData.height}</dd>
                </div>
                {imageData.metadata?.compression != null && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-foreground">Compression</dt>
                    <dd>
                      {EXR_COMPRESSION_NAMES[imageData.metadata.compression as number] ??
                        `unknown (${imageData.metadata.compression})`}
                    </dd>
                  </div>
                )}
                {sourceFileName && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-foreground">File name</dt>
                    <dd className="truncate" title={sourceFileName}>
                      {sourceFileName}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        )}
      </div>

      <section aria-labelledby="features-heading" className="mt-8 border-t border-border pt-6">
        <h2 className="mb-3 text-sm font-semibold text-foreground" id="features-heading">
          About this tool
        </h2>
        <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-1 md:grid-cols-2">
          <li>
            <strong className="text-foreground">Formats:</strong> Supports HDR (Radiance RGBE), EXR (OpenEXR), and Ultra
            HDR / Ultra JPG (JPEG with gain maps).
          </li>
          <li>
            <strong className="text-foreground">True HDR display:</strong> On compatible browsers (mainly Chrome at this
            time), the viewer can display images in true HDR when you choose “Direct HDR” in the tone mapping dropdown.
          </li>
          <li>
            <strong className="text-foreground">Pure JavaScript:</strong> Read and write these formats in pure
            JavaScript—no native bindings. Works in Node.js and in the browser.
          </li>
          <li>
            <strong className="text-foreground">Tree-shaking friendly:</strong> The library is written in a functional
            style to maximize tree-shaking and keep deployment sizes small.
          </li>
          <li>
            <strong className="text-foreground">EXR compression:</strong> Read and write EXR with no compression, RLE,
            ZIPS, ZIP, PIZ, and PXR24 (Pixar 24-bit).
          </li>
          <li>
            <strong className="text-foreground">Tone mapping:</strong> ACES, Reinhard, Khronos Neutral, and AgX
            (Blender).
          </li>
          <li className="sm:col-span-2">
            <strong className="text-foreground">CLI:</strong> A command-line tool is available for batch conversion and
            inspection:{' '}
            <a
              className="text-primary underline underline-offset-2 hover:no-underline"
              href="https://www.npmjs.com/package/hdrify-cli"
              rel="noopener noreferrer"
              target="_blank"
            >
              hdrify-cli on npm
            </a>
            .
          </li>
        </ul>
      </section>
    </div>
  );
}
