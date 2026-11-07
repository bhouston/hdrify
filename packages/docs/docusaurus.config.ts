import type { Config } from '@docusaurus/types';
import { legacyRedirectTarget } from './legacyRedirect.mjs';
const url = process.env.SITE_URL ?? 'https://hdrify.ben3d.ca';
const baseUrl = process.env.BASE_URL ?? '/';
const githubIcon =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="display:block"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>';
const link = (attributes: Record<string, string>) => ({ tagName: 'link', attributes });
// Raw head tags: `themeConfig.metadata` goes through Helmet, which keeps one tag per name and would drop a theme-color.
const themeColor = (content: string, scheme: string) => ({
  tagName: 'meta',
  attributes: { name: 'theme-color', content, media: `(prefers-color-scheme: ${scheme})` },
});

const config: Config = {
  title: 'HDRify',
  tagline: 'High dynamic range imaging. Anywhere JavaScript runs.',
  favicon: 'img/hdrify.png',
  url,
  baseUrl,
  headTags: [
    {
      tagName: 'script',
      attributes: {},
      innerHTML: `var target = (${legacyRedirectTarget.toString()})(location.href, ${JSON.stringify(baseUrl)}); if (target) location.replace(target);`,
    },
    link({ rel: 'icon', type: 'image/png', sizes: '32x32', href: `${baseUrl}img/favicon-32x32.png` }),
    link({ rel: 'apple-touch-icon', sizes: '180x180', href: `${baseUrl}img/apple-touch-icon.png` }),
    link({ rel: 'manifest', href: `${baseUrl}site.webmanifest` }),
    themeColor('#fcfbf7', 'light'),
    themeColor('#101c20', 'dark'),
    {
      tagName: 'script',
      attributes: { type: 'application/ld+json' },
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'HDRify',
        url: new URL(baseUrl, url).href,
        description:
          'Read, transform, and write OpenEXR, Radiance HDR, and JPEG gain maps in JavaScript. Typed APIs for browsers, Node.js, React, and the command line.',
      }),
    },
  ],
  organizationName: 'bhouston',
  projectName: 'hdrify',
  trailingSlash: true,
  onBrokenLinks: 'throw',
  markdown: { format: 'detect', hooks: { onBrokenMarkdownLinks: 'throw' } },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.js',
          editUrl: ({ docPath }: { docPath: string }) =>
            docPath.startsWith('generated-cli/')
              ? undefined
              : `https://github.com/bhouston/hdrify/edit/main/packages/docs/${docPath}`,
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
        gtag: { trackingID: 'G-CJJ7XP4N79' },
      },
    ],
  ],
  plugins: [
    [
      '@clidoc/docusaurus',
      {
        input: '.generated/hdrify.opencli.json',
        outputDir: 'docs/generated-cli',
        basePath: '/cli/reference',
      },
    ],
    [
      'docusaurus-plugin-typedoc',
      {
        id: 'core',
        entryPoints: ['../hdrify/src/index.ts'],
        tsconfig: '../hdrify/tsconfig.json',
        out: 'docs/api/core',
        readme: 'none',
        entryFileName: 'index',
        sidebar: { autoConfiguration: false },
        disableSources: true,
      },
    ],
    [
      'docusaurus-plugin-typedoc',
      {
        id: 'react',
        entryPoints: ['../hdrify-react/src/index.ts'],
        tsconfig: '../hdrify-react/tsconfig.json',
        out: 'docs/api/react',
        readme: 'none',
        entryFileName: 'index',
        sidebar: { autoConfiguration: false },
        disableSources: true,
      },
    ],
  ],
  themeConfig: {
    image: 'img/social-card.png',
    metadata: [
      { property: 'og:site_name', content: 'HDRify' },
      { name: 'twitter:site', content: '@BenHouston3D' },
    ],
    colorMode: { disableSwitch: true, respectPrefersColorScheme: true },
    navbar: {
      title: 'HDRify',
      logo: { alt: '', src: 'img/hdrify.png' },
      items: [
        { to: '/docs/', label: 'Docs', position: 'left' },
        { to: '/docs/api/core/', label: 'API', position: 'left' },
        { to: '/docs/cli/reference/', label: 'CLI', position: 'left' },
        { to: '/docs/image-viewer/', label: '<image-viewer>', position: 'left' },
        {
          href: `pathname://${baseUrl}demo/`,
          label: 'Live demo',
          target: '_self',
          position: 'left',
        },
        {
          href: 'https://github.com/bhouston/hdrify',
          html: githubIcon,
          'aria-label': 'GitHub repository',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Build with HDRify',
          items: [
            { to: '/docs/examples/', label: 'Code examples' },
            { to: '/docs/image-viewer/', label: '<image-viewer>' },
            { to: '/docs/react/', label: 'React integration' },
            { href: 'https://www.npmjs.com/package/hdrify', label: 'npm' },
          ],
        },
      ],
      copyright:
        'Made with ❤️ by <a href="https://ben3d.ca">Ben Houston</a>. Sponsored by <a href="https://landofassets.com">Land of Assets</a>',
    },
    prism: { additionalLanguages: ['bash', 'typescript', 'tsx'] },
  },
};
export default config;
