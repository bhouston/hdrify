import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useCallback, useEffect } from 'react'
import {
  readExr,
  readHdr,
  writeExr,
  writeHdr,
  encodeGainMap,
  writeJpegGainMap,
  applyToneMapping,
} from 'hdrify'
import { toast } from 'sonner'
import { Download } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: Index,
})

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function Index() {
  const [imageData, setImageData] = useState<{
    width: number
    height: number
    data: Float32Array
  } | null>(null)
  const [exposure, setExposure] = useState(1.0)
  const [isDragging, setIsDragging] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const renderToCanvas = useCallback(
    (data: Float32Array, width: number, height: number, exp: number) => {
      const canvas = canvasRef.current
      if (!canvas) return

      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const ldrRgb = applyToneMapping(data, width, height, {
        toneMapping: 'reinhard',
        exposure: exp,
      })

      const canvasImageData = ctx.createImageData(width, height)
      const pixels = canvasImageData.data
      for (let i = 0; i < width * height; i++) {
        pixels[i * 4] = ldrRgb[i * 3] ?? 0
        pixels[i * 4 + 1] = ldrRgb[i * 3 + 1] ?? 0
        pixels[i * 4 + 2] = ldrRgb[i * 3 + 2] ?? 0
        pixels[i * 4 + 3] = 255
      }

      ctx.putImageData(canvasImageData, 0, 0)
    },
    [],
  )

  useEffect(() => {
    if (!imageData) return
    renderToCanvas(imageData.data, imageData.width, imageData.height, exposure)
  }, [imageData, exposure, renderToCanvas])

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const arrayBuffer = await file.arrayBuffer()
        const buffer = new Uint8Array(arrayBuffer)

        const ext = file.name.toLowerCase().split('.').pop()
        let parsed: { width: number; height: number; data: Float32Array }

        if (ext === 'exr') {
          parsed = readExr(buffer)
        } else if (ext === 'hdr') {
          parsed = readHdr(buffer)
        } else {
          toast.error('Unsupported file format. Please use .exr or .hdr files.')
          return
        }

        setImageData(parsed)
      } catch (error) {
        console.error('Error parsing file:', error)
        toast.error(
          `Error parsing file: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
    [],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)

      const files = e.dataTransfer.files
      const file = files[0]
      if (file) {
        void handleFile(file)
      }
    },
    [handleFile],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      const file = files?.[0]
      if (file) {
        void handleFile(file)
      }
    },
    [handleFile],
  )

  const handleExposureChange = useCallback((value: number[]) => {
    setExposure(value[0] ?? 1)
  }, [])

  const handleDownloadExr = useCallback(() => {
    if (!imageData) return
    const bytes = writeExr(imageData)
    const blob = new Blob([bytes], { type: 'image/x-exr' })
    downloadBlob(blob, 'image.exr')
  }, [imageData])

  const handleDownloadHdr = useCallback(() => {
    if (!imageData) return
    const bytes = writeHdr(imageData)
    const blob = new Blob([bytes], { type: 'image/vnd.radiance' })
    downloadBlob(blob, 'image.hdr')
  }, [imageData])

  const handleDownloadJpegR = useCallback(() => {
    if (!imageData) return
    const encoding = encodeGainMap(imageData, { toneMapping: 'reinhard' })
    const bytes = writeJpegGainMap(encoding, { quality: 90 })
    const blob = new Blob([bytes], { type: 'image/jpeg' })
    downloadBlob(blob, 'image.jpg')
  }, [imageData])

  const handleAreaClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return (
    <div className="flex flex-1 flex-col p-4">
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left: vertical exposure slider (only when image loaded) */}
        {imageData && (
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Exposure
            </span>
            <div className="flex h-48 flex-1 items-center">
              <Slider
                orientation="vertical"
                min={0.1}
                max={10}
                step={0.1}
                value={[exposure]}
                onValueChange={handleExposureChange}
                className="h-full"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {exposure.toFixed(1)}
            </span>
          </div>
        )}

        {/* Center: integrated drop zone + image viewer */}
        <button
          type="button"
          aria-label="Drop EXR or HDR file here, or click to select a file"
          className={cn(
            'flex min-h-[400px] w-full flex-1 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed bg-transparent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 bg-muted/30 hover:border-muted-foreground/50'
          )}
          onClick={handleAreaClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".exr,.hdr"
            onChange={handleFileInput}
            className="sr-only"
          />
          {imageData ? (
            <div className="flex h-full w-full items-center justify-center p-4">
              <canvas
                ref={canvasRef}
                className="max-h-full max-w-full rounded object-contain"
              />
            </div>
          ) : (
            <div className="text-center text-muted-foreground">
              <p className="text-lg">
                {isDragging ? 'Drop the file here' : 'Drop EXR or HDR here'}
              </p>
              <p className="mt-1 text-sm">or click to select a file</p>
            </div>
          )}
        </button>

        {/* Right: download buttons (only when image loaded) */}
        {imageData && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Download
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handleDownloadExr()
              }}
              className="justify-start gap-2"
            >
              <Download className="size-4" />
              EXR
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handleDownloadHdr()
              }}
              className="justify-start gap-2"
            >
              <Download className="size-4" />
              HDR
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handleDownloadJpegR()
              }}
              className="justify-start gap-2"
            >
              <Download className="size-4" />
              UltraHDR JPEG
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
