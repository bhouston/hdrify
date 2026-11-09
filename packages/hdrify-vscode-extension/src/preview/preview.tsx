import { createRoot } from 'react-dom/client';
import { PreviewApp } from './App.js';
import './preview.css';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const api = acquireVsCodeApi();
createRoot(document.getElementById('root')!).render(<PreviewApp api={api} />);
