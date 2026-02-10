import { renderToString } from 'react-dom/server';
import { App } from './root';

export function render() {
  const html = renderToString(<App />);
  return { html };
}
