import { Link } from '@tanstack/react-router';
import { Github, Package } from 'lucide-react';

export default function Header() {
  return (
    <header className="flex h-14 items-stretch border-b border-border bg-card pl-0 pr-6 py-0 shadow-sm">
      <Link
        to="/"
        search={{}}
        className="flex flex-shrink-0 items-center gap-3 self-stretch text-foreground no-underline hover:text-foreground"
      >
        <img src="/logo192.png" alt="HDRify logo" className="h-full w-auto object-contain" />
        <h1 className="text-xl font-semibold">HDRify</h1>
      </Link>
      <nav className="ml-auto flex items-center gap-4">
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
