function escapeAttribute(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

export function getPreviewHtml(scriptUri: string, styleUri: string, cspSource: string): string {
  // The viewer's React UI renders inline <style> elements, hence 'unsafe-inline' for styles only.
  const csp = [
    "default-src 'none'",
    `script-src ${cspSource}`,
    `style-src ${cspSource} 'unsafe-inline'`,
    'img-src data: blob:',
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HDR Image Preview</title>
  <link rel="stylesheet" href="${escapeAttribute(styleUri)}">
</head>
<body>
  <div id="root"></div>
  <script src="${escapeAttribute(scriptUri)}"></script>
</body>
</html>`;
}
