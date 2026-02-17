import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import type { HdrifyImage } from 'hdrify';
import {
  addRangeMetadata,
  encodeGainMap,
  readExr,
  readHdr,
  readJpegGainMap,
  type ToneMappingType,
  writeExr,
  writeHdr,
  writeJpegGainMap,
} from 'hdrify';
import { HdrifyCanvas } from 'hdrify-react';
import { Download } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
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
  { value: '/examples/blouberg_sunrise_2_1k.jpg', label: 'Blouberg Sunrise 1k (Ultra HDR)' },
  { value: '/examples/moonless_golf_1k.hdr', label: 'Moonless Golf 1k (HDR)' },
  { value: '/examples/moonless_golf_1k.jpg', label: 'Moonless Golf 1k (Ultra HDR)' },
  { value: '/examples/pedestrian_overpass_1k.hdr', label: 'Pedestrian Overpass 1k (HDR)' },
  { value: '/examples/pedestrian_overpass_1k.jpg', label: 'Pedestrian Overpass 1k (Ultra HDR)' },
  { value: '/examples/reference_cie.exr', label: 'Reference CIE (EXR)' },
  { value: '/examples/reference_cie.hdr', label: 'Reference CIE (HDR)' },
  { value: '/examples/reference_cie.jpg', label: 'Reference CIE (Ultra HDR)' },
  { value: '/examples/reference_cie_r.hdr', label: 'CIE Wedge R (HDR)' },
  { value: '/examples/reference_cie_g.hdr', label: 'CIE Wedge G (HDR)' },
  { value: '/examples/reference_cie_b.hdr', label: 'CIE Wedge B (HDR)' },
  { value: '/examples/reference_gradient.exr', label: 'Reference Gradient (EXR)' },
  { value: '/examples/reference_gradient.hdr', label: 'Reference Gradient (HDR)' },
  { value: '/examples/reference_gradient.jpg', label: 'Reference Gradient (Ultra HDR)' },
  { value: '/examples/memorial.hdr', label: 'Memorial (HDR)' },
  { value: '/examples/memorial.exr', label: 'Memorial (EXR)' },
  { value: '/examples/memorial.jpg', label: 'Memorial (Ultra HDR)' },
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
  const [hdrifyImage, setHdrifyImage] = useState<HdrifyImage | null>(null);
  const [exposure, setExposure] = useState(1.0);
  const [displayMode, setDisplayMode] = useState<ToneMappingType>('neutral');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedExampleUrl, setSelectedExampleUrl] = useState<string>('');
  const [loadingExample, setLoadingExample] = useState(false);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ldrCanvasRef = useRef<HTMLCanvasElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);

        const ext = file.name.toLowerCase().split('.').pop();
        let parsed: HdrifyImage;

        if (ext === 'exr') {
          parsed = readExr(buffer);
        } else if (ext === 'hdr') {
          parsed = readHdr(buffer);
        } else if (ext === 'jpg' || ext === 'jpeg') {
          parsed = readJpegGainMap(buffer);
        } else {
          toast.error('Unsupported file format. Please use .exr, .hdr, or .jpg (gain map) files.');
          return;
        }

        setHdrifyImage(parsed);
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
      let parsed: HdrifyImage;
      if (ext === 'exr') {
        parsed = readExr(buffer);
      } else if (ext === 'hdr') {
        parsed = readHdr(buffer);
      } else if (ext === 'jpg' || ext === 'jpeg') {
        parsed = readJpegGainMap(buffer);
      } else {
        toast.error('Unsupported format. Example must be .exr, .hdr, or .jpg (gain map).');
        return;
      }
      setHdrifyImage(parsed);
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
    if (!hdrifyImage) return;
    const bytes = writeExr(hdrifyImage);
    const blob = new Blob([bytes], { type: 'image/x-exr' });
    downloadBlob(blob, 'image.exr');
  }, [hdrifyImage]);

  const handleDownloadHdr = useCallback(() => {
    if (!hdrifyImage) return;
    const bytes = writeHdr(hdrifyImage);
    const blob = new Blob([bytes], { type: 'image/vnd.radiance' });
    downloadBlob(blob, 'image.hdr');
  }, [hdrifyImage]);

  const handleDownloadJpegR = useCallback(() => {
    if (!hdrifyImage) return;
    try {
      const encoding = encodeGainMap(hdrifyImage, { toneMapping: displayMode });
      const bytes = writeJpegGainMap(encoding, { quality: 90 });
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      downloadBlob(blob, 'image.jpg');
    } catch (err) {
      toast.error(`Failed to create Ultra HDR JPEG: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [hdrifyImage, displayMode]);

  const handleDownloadWebP = useCallback(() => {
    const canvas = ldrCanvasRef.current;
    if (!canvas) return;
    canvas.toBlob(
      (blob) => {
        if (blob) downloadBlob(blob, 'image.webp');
      },
      'image/webp',
      0.92,
    );
  }, []);

  const handleAreaClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="flex flex-1 flex-col p-4">
      <p className="mb-4 text-sm text-muted-foreground">
        This is a web demo of the{' '}
        {/** biome-ignore assist/source/useSortedAttributes: anchor attribute order preferred for readability */}
        <a
          href="https://github.com/bhouston/hdrify"
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'underline' }}
        >
          HDRify library
        </a>
        , which can read/write{' '}
        <a
          href="https://en.wikipedia.org/wiki/RGBE_image_format"
          rel="noopener noreferrer"
          style={{ textDecoration: 'underline' }}
          target="_blank"
        >
          HDR
        </a>
        ,{' '}
        <a
          href="https://en.wikipedia.org/wiki/OpenEXR"
          rel="noopener noreferrer"
          style={{ textDecoration: 'underline' }}
          target="_blank"
        >
          EXR
        </a>
        , and{' '}
        <a
          href="https://en.wikipedia.org/wiki/Ultra_HDR"
          rel="noopener noreferrer"
          style={{ textDecoration: 'underline' }}
          target="_blank"
        >
          UltraHDR JPEG
        </a>
        , and apply tone mapping transformations.
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
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {/* Tone controls above image — horizontal exposure */}
        {hdrifyImage && (
          <div className="grid w-full grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-2">
            <span className="text-xs font-medium text-muted-foreground">Tone mapping</span>
            <span className="text-xs font-medium text-muted-foreground">Exposure</span>
            <Select onValueChange={(v) => setDisplayMode(v as ToneMappingType)} value={displayMode}>
              <SelectTrigger className="w-full min-w-[140px]" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aces">ACES</SelectItem>
                <SelectItem value="neutral">Neutral</SelectItem>
                <SelectItem value="agx">AgX</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex min-w-0 items-center gap-2">
              <Slider
                className="flex-1"
                max={10}
                min={0.1}
                onValueChange={handleExposureChange}
                orientation="horizontal"
                step={0.1}
                value={[exposure]}
              />
              <span className="w-8 shrink-0 text-xs text-muted-foreground">{exposure.toFixed(1)}</span>
            </div>
          </div>
        )}

        {/* Center: integrated drop zone + image viewer */}
        <button
          aria-label="Drop EXR, HDR or JPEG gain map here, or click to select a file"
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
          <input
            accept=".exr,.hdr,.jpg,.jpeg"
            className="sr-only"
            onChange={handleFileInput}
            ref={fileInputRef}
            type="file"
          />
          {hdrifyImage ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4">
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <HdrifyCanvas
                  className="max-h-full max-w-full rounded object-contain"
                  exposure={exposure}
                  forwardedRef={ldrCanvasRef}
                  hdrifyImage={hdrifyImage}
                  toneMapping={displayMode}
                />
              </div>
              <p className="shrink-0 text-center text-xs text-muted-foreground">
                Drag another file here (HDR, EXR, or UltraHDR JPG) or click to load a different image
              </p>
            </div>
          ) : (
            <div className="text-center text-muted-foreground">
              <p className="text-lg">{isDragging ? 'Drop the file here' : 'Drop EXR, HDR or JPEG gain map here'}</p>
              <p className="mt-1 text-sm">or click to select a file.</p>
              <p className="mt-1 text-sm">
                Or load an example image from the <b>Examples dropdown</b>.
              </p>
            </div>
          )}
        </button>

        {/* Below image: Info (left) + Download (right) in two columns */}
        {hdrifyImage && (
          <div className="grid w-full grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Info</span>
              <dl className="flex flex-col gap-1 text-xs text-muted-foreground">
                {sourceFileName && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-foreground">File name</dt>
                    <dd className="truncate" title={sourceFileName}>
                      {sourceFileName}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-foreground">Width</dt>
                  <dd>{hdrifyImage.width}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-foreground">Height</dt>
                  <dd>{hdrifyImage.height}</dd>
                </div>
                {hdrifyImage.metadata?.compression != null && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-foreground">Compression</dt>
                    <dd>
                      {EXR_COMPRESSION_NAMES[hdrifyImage.metadata.compression as number] ??
                        `unknown (${hdrifyImage.metadata.compression})`}
                    </dd>
                  </div>
                )}
                {hdrifyImage.metadata?.format != null &&
                  (hdrifyImage.metadata.format === 'ultrahdr' || hdrifyImage.metadata.format === 'adobe-gainmap') && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-foreground">Gain map format</dt>
                      <dd>{hdrifyImage.metadata.format === 'ultrahdr' ? 'Ultra HDR (JPEG-R)' : 'Adobe gain map'}</dd>
                    </div>
                  )}
                {(() => {
                  const rangeMeta = addRangeMetadata(hdrifyImage);
                  const min = rangeMeta.MIN_VALUE as [number, number, number];
                  const max = rangeMeta.MAX_VALUE as [number, number, number];
                  return (
                    <>
                      <div className="flex justify-between gap-4">
                        <dt className="text-foreground">R range</dt>
                        <dd title={`min: ${min[0]}, max: ${max[0]}`}>
                          [{min[0].toFixed(3)}, {max[0].toFixed(3)}]
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-foreground">G range</dt>
                        <dd title={`min: ${min[1]}, max: ${max[1]}`}>
                          [{min[1].toFixed(3)}, {max[1].toFixed(3)}]
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-foreground">B range</dt>
                        <dd title={`min: ${min[2]}, max: ${max[2]}`}>
                          [{min[2].toFixed(3)}, {max[2].toFixed(3)}]
                        </dd>
                      </div>
                    </>
                  );
                })()}
              </dl>
            </div>
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
                EXR (HDR)
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
                Radiance HDR (HDR)
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
                UltraHDR JPEG (HDR)
              </Button>
              <Button
                className="justify-start gap-2"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownloadWebP();
                }}
                size="sm"
                variant="outline"
              >
                <Download className="size-4" />
                WebP (SDR)
              </Button>
            </div>
          </div>
        )}
      </div>

      <section aria-labelledby="features-heading" className="mt-8 min-w-0 border-t border-border pt-6">
        <h2 className="mb-3 text-sm font-semibold text-foreground" id="features-heading">
          About this tool
        </h2>
        <ul className="grid grid-cols-1 gap-2 text-sm text-muted-foreground md:grid-cols-2">
          <li>
            <strong className="text-foreground">Formats:</strong> Supports HDR (Radiance RGBE), EXR (OpenEXR), and Ultra
            HDR (JPEG with gain maps).
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
            <strong className="text-foreground">Gain maps:</strong> Read and write both Adobe Gain Map JPEGs and
            UltraHDR (Android compatible) JPEGs.
          </li>
          <li>
            <strong className="text-foreground">Tone mapping:</strong> ACES, Khronos Neutral, and AgX.
          </li>
          <li className="md:col-span-2">
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
