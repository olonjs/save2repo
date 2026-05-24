import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { AgentCredentialScope } from "@/lib/mcpGatewayCredentials";

type CodeTokenPayload = {
  typ: "auth_code";
  sub: string;
  clientId: string;
  credentialId: string;
  tenantId: string;
  scopes: AgentCredentialScope[];
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  iat: number;
  exp: number;
};

type AccessTokenPayload = {
  typ: "access_token";
  sub: string;
  clientId: string;
  credentialId: string;
  tenantId: string;
  scopes: AgentCredentialScope[];
  iat: number;
  exp: number;
};

const DEFAULT_CODE_TTL_SECONDS = 300;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 3600;

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function getSigningSecret(): string {
  return (
    process.env.MCP_OAUTH_SIGNING_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.LS_WEBHOOK_SECRET?.trim() ||
    ""
  );
}

function signPayload(payloadB64: string): string {
  const secret = getSigningSecret();
  if (!secret) {
    throw new Error("MCP OAuth signing secret is not configured");
  }
  const digest = createHmac("sha256", secret).update(payloadB64).digest();
  return base64UrlEncode(digest);
}

function encodeSignedToken(payload: object): string {
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(payloadB64);
  return `${payloadB64}.${signature}`;
}

function decodeAndVerifySignedToken<T extends { exp: number }>(token: string): T | null {
  const [payloadB64, signatureB64] = token.split(".");
  if (!payloadB64 || !signatureB64) return null;
  const expectedSignature = signPayload(payloadB64);
  const a = Buffer.from(signatureB64);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  const payloadRaw = base64UrlDecode(payloadB64).toString("utf8");
  const payload = JSON.parse(payloadRaw) as T;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function createAuthorizationCode(params: {
  userId: string;
  clientId: string;
  credentialId: string;
  tenantId: string;
  scopes: AgentCredentialScope[];
  redirectUri: string;
  codeChallenge: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: CodeTokenPayload = {
    typ: "auth_code",
    sub: params.userId,
    clientId: params.clientId,
    credentialId: params.credentialId,
    tenantId: params.tenantId,
    scopes: params.scopes,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: "S256",
    iat: now,
    exp: now + DEFAULT_CODE_TTL_SECONDS,
  };
  return encodeSignedToken(payload);
}

export function verifyAuthorizationCode(code: string): CodeTokenPayload | null {
  const payload = decodeAndVerifySignedToken<CodeTokenPayload>(code);
  if (!payload || payload.typ !== "auth_code") return null;
  return payload;
}

export function createAccessToken(params: {
  userId: string;
  clientId: string;
  credentialId: string;
  tenantId: string;
  scopes: AgentCredentialScope[];
}): { accessToken: string; expiresIn: number } {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  const payload: AccessTokenPayload = {
    typ: "access_token",
    sub: params.userId,
    clientId: params.clientId,
    credentialId: params.credentialId,
    tenantId: params.tenantId,
    scopes: params.scopes,
    iat: now,
    exp: now + expiresIn,
  };
  return { accessToken: encodeSignedToken(payload), expiresIn };
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  const payload = decodeAndVerifySignedToken<AccessTokenPayload>(token);
  if (!payload || payload.typ !== "access_token") return null;
  return payload;
}

export function verifyPkce(params: { codeVerifier: string; expectedChallenge: string }): boolean {
  const derived = base64UrlEncode(createHash("sha256").update(params.codeVerifier).digest());
  return derived === params.expectedChallenge;
}

export function isAllowedOAuthRedirectUri(uri: string): boolean {
  const allowlistRaw = process.env.MCP_OAUTH_REDIRECT_ALLOWLIST?.trim();
  const defaults = ["https://claude.ai/api/mcp/auth_callback"];
  const allowlist = allowlistRaw
    ? allowlistRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : defaults;
  return allowlist.includes(uri);
}
