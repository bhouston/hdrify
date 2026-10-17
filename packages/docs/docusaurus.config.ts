import type { Config } from '@docusaurus/types';
const config: Config = {
  title: 'HDRify',
  tagline: 'High dynamic range imaging. Anywhere JavaScript runs.',
  favicon: 'img/hdrify.png',
  url: process.env.SITE_URL ?? 'https://bhouston.github.io',
  baseUrl: process.env.BASE_URL ?? '/hdrify/',
  organizationName: 'bhouston',
  projectName: 'hdrify',
  trailingSlash: true,
  onBrokenLinks: 'throw',
  markdown: { format: 'md', hooks: { onBrokenMarkdownLinks: 'throw' } },
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
    navbar: {
      title: 'HDRify',
      logo: { alt: '', src: 'img/hdrify.png' },
      items: [
        { to: '/docs/', label: 'Docs', position: 'left' },
        { to: '/docs/api/core/', label: 'API', position: 'left' },
        { to: '/docs/cli/reference/', label: 'CLI', position: 'left' },
        {
          href: `pathname://${process.env.BASE_URL ?? '/hdrify/'}demo/`,
          label: 'Live demo',
          target: '_self',
          position: 'left',
        },
        { href: 'https://github.com/bhouston/hdrify', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Build with HDRify',
          items: [
            { to: '/docs/examples/', label: 'Code examples' },
            { to: '/docs/react/', label: 'React integration' },
            { href: 'https://www.npmjs.com/package/hdrify', label: 'npm' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} HDRify · MIT · Created by <a href="https://ben3d.ca">Ben Houston</a> · Sponsored by <a href="https://landofassets.com">Land of Assets</a>`,
    },
    prism: { additionalLanguages: ['bash', 'typescript', 'tsx'] },
  },
};
export default config;
