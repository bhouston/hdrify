import { Github, Package } from 'lucide-react';

export default function Header() {
  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4 shadow-sm">
      <h1 className="text-xl font-semibold text-foreground">HDRify</h1>
      <nav className="flex items-center gap-4">
        <a
          aria-label="GitHub repository"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          href="https://github.com/bhouston/hdrify"
          rel="noopener noreferrer"
          target="_blank"
        >
          <Github className="size-5" />
          <span className="sr-only sm:not-sr-only">GitHub</span>
        </a>
        <a
          aria-label="NPM package"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          href="https://www.npmjs.com/package/hdrify"
          rel="noopener noreferrer"
          target="_blank"
        >
          <Package className="size-5" />
          <span className="sr-only sm:not-sr-only">NPM</span>
        </a>
      </nav>
    </header>
  );
}
