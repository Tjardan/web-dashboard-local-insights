/**
 * Parse git remote URLs to build web commit/browse links.
 * Supported: GitHub (HTTPS + SSH), Azure DevOps (HTTPS + SSH, dev.azure.com + *.visualstudio.com).
 */

function normalizeRemote(remote: string): string {
  return remote.trim().replace(/\.git$/, "");
}

/**
 * Build a URL to view a specific commit on the remote hosting service.
 * Returns null when the remote cannot be parsed or is not recognised.
 */
export function buildCommitUrl(
  gitRemote: string | undefined,
  sha: string,
): string | null {
  if (!gitRemote) return null;
  const r = normalizeRemote(gitRemote);

  // ── GitHub HTTPS ──────────────────────────────────────────
  // https://github.com/owner/repo
  const ghHttps = r.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)$/);
  if (ghHttps) return `https://github.com/${ghHttps[1]}/commit/${sha}`;

  // ── GitHub SSH ────────────────────────────────────────────
  // git@github.com:owner/repo
  const ghSsh = r.match(/^git@github\.com:([^/]+\/[^/]+)$/);
  if (ghSsh) return `https://github.com/${ghSsh[1]}/commit/${sha}`;

  // ── Azure DevOps HTTPS ────────────────────────────────────
  // https://dev.azure.com/org/project/_git/repo
  // https://user@dev.azure.com/org/project/_git/repo  (personal access token prefix)
  const azdoHttps = r.match(
    /^https?:\/\/[^@]*@?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/,
  );
  if (azdoHttps) {
    const [, org, project, repo] = azdoHttps;
    return `https://dev.azure.com/${org}/${project}/_git/${repo}/commit/${sha}`;
  }

  // ── Azure DevOps SSH ──────────────────────────────────────
  // git@ssh.dev.azure.com:v3/org/project/repo
  const azdoSsh = r.match(
    /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)$/,
  );
  if (azdoSsh) {
    const [, org, project, repo] = azdoSsh;
    return `https://dev.azure.com/${org}/${project}/_git/${repo}/commit/${sha}`;
  }

  // ── Legacy Visual Studio Team Services ────────────────────
  // https://org.visualstudio.com/project/_git/repo
  const vstsHttps = r.match(
    /^https?:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/?#]+)/,
  );
  if (vstsHttps) {
    const [, org, project, repo] = vstsHttps;
    return `https://dev.azure.com/${org}/${project}/_git/${repo}/commit/${sha}`;
  }

  return null;
}
