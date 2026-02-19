import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE_NAME = "worklog_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

type SessionPayload = {
  exp: number;
  nonce: string;
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getSessionSecret(): string {
  return getRequiredEnv("WORKLOG_SESSION_SECRET");
}

function signPayload(payloadBase64: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(payloadBase64)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function isValidAppPassword(input: string): boolean {
  const expected = getRequiredEnv("WORKLOG_APP_PASSWORD");
  return safeEqual(input, expected);
}

export function createSessionToken(): string {
  const payload: SessionPayload = {
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    nonce: randomBytes(18).toString("base64url"),
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signPayload(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

export function verifySessionToken(token?: string): boolean {
  if (!token) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return false;
  }

  const [payloadBase64, signature] = parts;
  const expectedSignature = signPayload(payloadBase64);

  if (!safeEqual(signature, expectedSignature)) {
    return false;
  }

  const payloadRaw = Buffer.from(payloadBase64, "base64url").toString("utf8");
  const payload = JSON.parse(payloadRaw) as SessionPayload;

  return payload.exp > Math.floor(Date.now() / 1000);
}

export async function hasValidSessionCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export const SESSION = {
  name: SESSION_COOKIE_NAME,
  maxAge: SESSION_TTL_SECONDS,
};
