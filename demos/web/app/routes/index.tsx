import { createFileRoute } from '@tanstack/react-router';
import { useState, useRef, useCallback } from 'react';
import { Buffer } from 'buffer';
import { parseEXRFile } from 'exr-image';
import { parseHDRFile } from 'hdr-image';

// Make Buffer available globally for browser
if (typeof window !== 'undefined' && !window.Buffer) {
  (window as any).Buffer = Buffer;
}

export const Route = createFileRoute('/')({
  component: Index,
});

function Index() {
  const [imageData, setImageData] = useState<{
    width: number;
    height: number;
    data: Float32Array;
  } | null>(null);
  const [exposure, setExposure] = useState(1.0);
  const [isDragging, setIsDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const renderToCanvas = useCallback(
    (data: Float32Array, width: number, height: number, exp: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const imageData = ctx.createImageData(width, height);
      const pixels = imageData.data;

      // Convert HDR/EXR data to LDR for display
      for (let i = 0; i < width * height; i++) {
        const dataIndex = i * 4; // RGBA format
        const pixelIndex = i * 4; // RGBA output

        const r = (data[dataIndex] ?? 0) * exp;
        const g = (data[dataIndex + 1] ?? 0) * exp;
        const b = (data[dataIndex + 2] ?? 0) * exp;

        // Apply tone mapping (simple Reinhard)
        const toneMappedR = r / (1 + r);
        const toneMappedG = g / (1 + g);
        const toneMappedB = b / (1 + b);

        // Convert to 0-255 range
        pixels[pixelIndex] = Math.max(0, Math.min(255, Math.round(toneMappedR * 255)));
        pixels[pixelIndex + 1] = Math.max(0, Math.min(255, Math.round(toneMappedG * 255)));
        pixels[pixelIndex + 2] = Math.max(0, Math.min(255, Math.round(toneMappedB * 255)));
        pixels[pixelIndex + 3] = 255; // Alpha
      }

      ctx.putImageData(imageData, 0, 0);
    },
    [],
  );

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const ext = file.name.toLowerCase().split('.').pop();
        let parsed;

        if (ext === 'exr') {
          parsed = parseEXRFile(buffer);
        } else if (ext === 'hdr') {
          parsed = parseHDRFile(buffer);
        } else {
          alert('Unsupported file format. Please use .exr or .hdr files.');
          return;
        }

        setImageData(parsed);
        renderToCanvas(parsed.data, parsed.width, parsed.height, exposure);
      } catch (error) {
        console.error('Error parsing file:', error);
        alert(`Error parsing file: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [exposure, renderToCanvas],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]!);
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
      if (files && files.length > 0) {
        handleFile(files[0]!);
      }
    },
    [handleFile],
  );

  const handleExposureChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newExposure = parseFloat(e.target.value);
      setExposure(newExposure);
      if (imageData) {
        renderToCanvas(imageData.data, imageData.width, imageData.height, newExposure);
      }
    },
    [imageData, renderToCanvas],
  );

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>EXR / HDR Image Viewer</h1>
      <p>Drag and drop an EXR or HDR file, or click to select a file.</p>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          border: `2px dashed ${isDragging ? '#007bff' : '#ccc'}`,
          borderRadius: '8px',
          padding: '3rem',
          textAlign: 'center',
          marginBottom: '2rem',
          backgroundColor: isDragging ? '#f0f8ff' : '#fafafa',
          cursor: 'pointer',
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".exr,.hdr"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
        {isDragging ? (
          <p>Drop the file here</p>
        ) : (
          <p>Drag and drop an EXR or HDR file here, or click to browse</p>
        )}
      </div>

      {imageData && (
        <div>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="exposure" style={{ display: 'block', marginBottom: '0.5rem' }}>
              Exposure: {exposure.toFixed(2)}
            </label>
            <input
              id="exposure"
              type="range"
              min="0.1"
              max="10.0"
              step="0.1"
              value={exposure}
              onChange={handleExposureChange}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <p>
              Dimensions: {imageData.width} × {imageData.height} pixels
            </p>
          </div>
          <canvas
            ref={canvasRef}
            style={{
              border: '1px solid #ccc',
              borderRadius: '4px',
              maxWidth: '100%',
              height: 'auto',
            }}
          />
        </div>
      )}
    </div>
  );
}
