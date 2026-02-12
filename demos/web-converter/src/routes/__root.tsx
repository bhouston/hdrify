import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import { Toaster } from 'sonner';

import Footer from '../components/Footer';
import Header from '../components/Header';

import appCss from '../styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'HDRify – EXR / HDR Image Viewer',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
<script async={true} src="https://www.googletagmanager.com/gtag/js?id=G-CJJ7XP4N79"></script>
<script>{`
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-CJJ7XP4N79');
`}</script>
      </head>
      <body className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}
