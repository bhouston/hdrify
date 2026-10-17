import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import CodeBlock from '@theme/CodeBlock';
import styles from './index.module.css';

const snippet = `import { readExr, writeHdr } from 'hdrify';

const response = await fetch('/studio.exr');
const image = readExr(new Uint8Array(await response.arrayBuffer()));

// One floating-point RGBA image. Any supported output.
const radiance = writeHdr(image);`;

export default function Home() {
  const demoUrl = useBaseUrl('/demo/');
  return (
    <Layout
      title="High dynamic range imaging for JavaScript"
      description="Read, transform, and write OpenEXR, Radiance HDR, and JPEG gain maps in JavaScript. Typed APIs for browsers, Node.js, React, and the command line."
    >
      <header className={styles.hero}>
        <div className={`container ${styles.heroGrid}`}>
          <div>
            <p className={styles.eyebrow}>OpenEXR · Radiance HDR · Ultra HDR</p>
            <h1>
              Keep the light.
              <br />
              Skip the native bindings.
            </h1>
            <p className={styles.lead}>
              Read, transform, and write high dynamic range images anywhere JavaScript runs. One typed pixel format
              connects your browser, server, and creative tools.
            </p>
            <div className={styles.actions}>
              <Link className="button button--primary button--lg" to="/docs/">
                Get started
              </Link>
              <Link className="button button--secondary button--lg" href={`pathname://${demoUrl}`} target="_self">
                Try the live demo ↗
              </Link>
            </div>
            <p className={styles.install}>
              <code>npm install hdrify</code>
            </p>
          </div>
          <div
            className={styles.visual}
            aria-label="HDRify converts between EXR, HDR and JPEG gain maps using a shared floating-point RGBA image"
          >
            <div className={styles.spectrum} />
            <div className={styles.visualContent}>
              <img src={useBaseUrl('/img/hdrify.png')} width="100" height="100" alt="HDRify" />
              <p>Every highlight. Every channel.</p>
              <div className={styles.formats}>
                <span>EXR</span>
                <span>HDR</span>
                <span>JPEG-R</span>
              </div>
              <code>Float32Array · RGBA · linear light</code>
            </div>
          </div>
        </div>
      </header>
      <main className="container">
        <section className={styles.grid} aria-label="Capabilities and benefits">
          {[
            [
              'Read and write',
              'Move between OpenEXR, Radiance RGBE, Ultra HDR, and Adobe gain map JPEGs with a consistent API.',
              '/docs/formats/',
            ],
            [
              'Transform with precision',
              'Resize, flip, convert color spaces, and apply ACES, AgX, Khronos Neutral, or Reinhard tone mapping.',
              '/docs/examples/',
            ],
            [
              'Run where you work',
              'Use the core library in browsers, workers, and Node.js. Add React previews, a CLI, or editor integration.',
              '/docs/react/',
            ],
          ].map(([title, text, to]) => (
            <article className={styles.card} key={title}>
              <h2>{title}</h2>
              <p>{text}</p>
              <Link to={to}>Explore →</Link>
            </article>
          ))}
        </section>
        <section className={styles.split}>
          <div>
            <p className={styles.eyebrow}>A small API for a wide range</p>
            <h2>From encoded bytes to useful pixels.</h2>
            <p>
              Readers return a shared <code>HdrifyImage</code>: dimensions, floating-point RGBA pixels, and metadata.
              Transform it once, then choose your output format.
            </p>
            <p>
              Pure JavaScript, TypeScript definitions, and tree-shakeable functions let you bring only the tools your
              application needs.
            </p>
            <Link to="/docs/examples/">See complete code examples →</Link>
          </div>
          <CodeBlock language="typescript" title="Convert EXR to Radiance HDR">
            {snippet}
          </CodeBlock>
        </section>
        <section className={styles.banner}>
          <div>
            <p className={styles.eyebrow}>See it for yourself</p>
            <h2>Your images. Your browser.</h2>
            <p>
              Drop an EXR, HDR, or gain map JPEG into the live viewer. Adjust exposure and tone mapping, inspect
              metadata, then download a conversion. Local files are processed in your browser.
            </p>
          </div>
          <Link className="button button--primary button--lg" href={`pathname://${demoUrl}`} target="_self">
            Open viewer & converter ↗
          </Link>
        </section>
        <section className={styles.grid} aria-label="HDRify tools">
          <article className={styles.card}>
            <h2>React</h2>
            <p>Display HDR images with HdrifyCanvas and control exposure and tone mapping.</p>
            <Link to="/docs/react/">Build a preview →</Link>
          </article>
          <article className={styles.card}>
            <h2>Command line</h2>
            <p>Convert files, inspect metadata, and generate reference images from your terminal or scripts.</p>
            <Link to="/docs/cli/">Use hdrify-cli →</Link>
          </article>
          <article className={styles.card}>
            <h2>VS Code & Cursor</h2>
            <p>Preview HDR images and convert formats without leaving your editor.</p>
            <a href="https://marketplace.visualstudio.com/items?itemName=benhouston3d.hdrify-vscode-extension">
              Get the extension →
            </a>
          </article>
        </section>
      </main>
    </Layout>
  );
}
