import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkPullRequest(pr) {
  if (pr.base.ref !== 'main') throw new Error('Contribution PRs must target main.');
  const branch = /^(?:feature|fix|chore|docs|refactor|test)\/(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(pr.head.ref);
  if (!branch) throw new Error('Use a branch such as feature/42-batch-export.');
  const closing = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${branch[1]}\\b`, 'i');
  if (!closing.test(pr.body ?? '')) throw new Error(`PR body must include Closes #${branch[1]}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  checkPullRequest(event.pull_request);
}
