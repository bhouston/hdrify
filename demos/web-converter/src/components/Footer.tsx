export default function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-muted/30 px-6 py-4 text-center text-sm text-muted-foreground">
      Built with{' '}
      <span className="text-red-500" aria-hidden="true">
        ♥
      </span>{' '}
      by{' '}
      <a
        href="https://benhouston3d.com"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-foreground transition-colors"
      >
        Ben Houston
      </a>
      . Sponsored by{' '}
      <a
        href="https://landofassets.com"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-foreground transition-colors"
      >
        Land of Assets
      </a>
      .
    </footer>
  )
}
