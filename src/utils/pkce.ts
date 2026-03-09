/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0 SPA flows.
 * Runs in the browser only.
 */

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** Generate a cryptographically random code verifier (43–128 chars). */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Derive the S256 code challenge from a verifier. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Build a Microsoft identity platform authorization URL. */
export function buildMsAuthUrl(params: {
  clientId: string;
  tenantId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  state?: string;
}): string {
  const q = new URLSearchParams({
    client_id: params.clientId,
    response_type: "code",
    redirect_uri: params.redirectUri,
    response_mode: "query",
    scope: params.scopes.join(" "),
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    ...(params.state ? { state: params.state } : {}),
  });
  return `https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/authorize?${q}`;
}
