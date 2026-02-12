import { createFileRoute } from '@tanstack/react-router';
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

/** Display mode: 'none' = Direct HDR (no tone mapping), or a real tone mapping type */
type DisplayMode = ToneMappingType | 'none';

import { FloatImageCanvas } from '@/components/FloatImageCanvas';
import { FloatImageCanvasHDR } from '@/components/FloatImageCanvasHDR';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useHdrCanvasSupport } from '@/hooks/useHdrCanvasSupport';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/')({
  component: Index,
});

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Index() {
  const hdrSupported = useHdrCanvasSupport();
  const [imageData, setImageData] = useState<FloatImageData | null>(null);
  const [exposure, setExposure] = useState(1.0);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('neutral');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevHdrSupportedRef = useRef(false);

  // Default to Direct HDR when HDR support is first detected
  useEffect(() => {
    if (hdrSupported && !prevHdrSupportedRef.current) {
      setDisplayMode('none');
    }
    prevHdrSupportedRef.current = hdrSupported;
  }, [hdrSupported]);

  const handleFile = useCallback(async (file: File) => {
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
    } catch (error) {
      console.error('Error parsing file:', error);
      toast.error(`Error parsing file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

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
        HDRify implements HDR, EXR, and JPEG-R reading and writing in pure JavaScript—no native bindings.
      </p>
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
            <div className="flex h-full w-full items-center justify-center p-4">
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
          ) : (
            <div className="text-center text-muted-foreground">
              <p className="text-lg">{isDragging ? 'Drop the file here' : 'Drop EXR or HDR here'}</p>
              <p className="mt-1 text-sm">or click to select a file</p>
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
          </div>
        )}
      </div>
    </div>
  );
}
