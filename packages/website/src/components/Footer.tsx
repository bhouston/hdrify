export default function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-muted/30 px-6 py-4 text-center text-sm text-muted-foreground">
      Built with{' '}
      <span aria-hidden="true" className="text-red-500">
        ♥
      </span>{' '}
      by{' '}
      <a
        className="underline hover:text-foreground transition-colors"
        href="https://benhouston3d.com"
        rel="noopener noreferrer"
        target="_blank"
      >
        Ben Houston
      </a>
      . Sponsored by{' '}
      <a
        className="underline hover:text-foreground transition-colors"
        href="https://landofassets.com"
        rel="noopener noreferrer"
        target="_blank"
      >
        Land of Assets
      </a>
      .
    </footer>
  );
}
