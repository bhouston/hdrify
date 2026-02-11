import { Github, Package } from 'lucide-react'

export default function Header() {
  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4 shadow-sm">
      <h1 className="text-xl font-semibold text-foreground">HDRify</h1>
      <nav className="flex items-center gap-4">
        <a
          href="https://github.com/bhouston/hdrify"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="GitHub repository"
        >
          <Github className="size-5" />
          <span className="sr-only sm:not-sr-only">GitHub</span>
        </a>
        <a
          href="https://www.npmjs.com/package/hdrify"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="NPM package"
        >
          <Package className="size-5" />
          <span className="sr-only sm:not-sr-only">NPM</span>
        </a>
      </nav>
    </header>
  )
}
