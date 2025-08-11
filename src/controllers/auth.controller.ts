import { Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import {
  authenticate,
  signAccessTokenFor,
  signRefreshTokenFor,
  rotateFromRefresh,
  invalidateSessionsByEmail,
  invalidateSessionsByUserId,
} from "../services/auth.service";

type SameSiteOpt = "lax" | "none" | "strict";
// ===== 固定配置 =====
const COOKIE_NAME = "refresh_token"; // 刷新 token 名
const COOKIE_DOMAIN = ".isleease.com";
const PROD = true;
const SAMESITE: SameSiteOpt = "lax";
const SECURE = true;

const ACCESS_TTL_MIN = 15;
const REFRESH_TTL_MIN = 60;

const REQUIRE_CSRF = false; // 固定为 false
const CSRF_COOKIE = "XSRF-TOKEN";
const CSRF_HEADER = "x-csrf-token";

function setRefreshCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: SECURE,
    sameSite: SAMESITE,
    path: "/",
    domain: COOKIE_DOMAIN,
    maxAge: REFRESH_TTL_MIN * 60 * 1000,
  });
}

function setCsrfCookie(res: Response) {
  const value = crypto.randomBytes(24).toString("hex");
  res.cookie(CSRF_COOKIE, value, {
    httpOnly: false, // 允许前端读
    secure: SECURE,
    sameSite: SAMESITE,
    path: "/",
    domain: COOKIE_DOMAIN,
    maxAge: REFRESH_TTL_MIN * 60 * 1000,
  });
  return value;
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    path: "/",
    domain: COOKIE_DOMAIN,
    sameSite: SAMESITE,
    secure: SECURE,
  });
  res.clearCookie(CSRF_COOKIE, {
    path: "/",
    domain: COOKIE_DOMAIN,
    sameSite: SAMESITE,
    secure: SECURE,
  });
}

export async function login(req: Request, res: Response) {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid body",
      issues: parsed.error.flatten(),
    });
  }
  const { email, password } = parsed.data;

  const user = await authenticate(email, password);
  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  const access = signAccessTokenFor({
    id: user.id,
    label: user.label,
    customerId: user.customerId ?? null,
    adminLevel: (user as any).adminLevel ?? null,
    sessionVersion: user.sessionVersion ?? 0,
  });
  const refresh = signRefreshTokenFor({
    id: user.id,
    sessionVersion: user.sessionVersion ?? 0,
  });

  setRefreshCookie(res, refresh);
  setCsrfCookie(res);

  res.json({
    accessToken: access,
    user: {
      id: user.id,
      email: user.email,
      label: user.label,
      adminLevel: (user as any).adminLevel ?? null,
    },
    accessTokenExpiresInMin: ACCESS_TTL_MIN,
    refreshTokenExpiresInMin: REFRESH_TTL_MIN,
  });
}

export async function refresh(req: Request, res: Response) {
  const token = (req as any).cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ message: "No refresh token" });

  if (REQUIRE_CSRF) {
    const csrfCookie = (req as any).cookies?.[CSRF_COOKIE];
    const csrfHeader = String(req.headers[CSRF_HEADER] || "");
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return res.status(403).json({ message: "CSRF token invalid" });
    }
  }

  try {
    const { accessToken, refreshToken } = await rotateFromRefresh(token);
    setRefreshCookie(res, refreshToken);
    setCsrfCookie(res);
    res.json({ accessToken, accessTokenExpiresInMin: ACCESS_TTL_MIN });
  } catch (e: any) {
    const msg =
      e?.message === "SESSION_INVALIDATED"
        ? "Session invalidated"
        : e?.message === "USER_NOT_FOUND"
        ? "User not found"
        : "Invalid refresh token";
    clearRefreshCookie(res);
    const code = msg === "Session invalidated" ? 403 : 401;
    res.status(code).json({ message: msg });
  }
}

export async function logout(req: Request, res: Response) {
  const authedUserId = (req as any).user?.id as number | undefined;
  const bodyEmail = (req.body?.email as string | undefined)
    ?.toLowerCase?.()
    ?.trim?.();

  if (authedUserId) {
    await invalidateSessionsByUserId(authedUserId);
  } else if (bodyEmail) {
    await invalidateSessionsByEmail(bodyEmail);
  }

  clearRefreshCookie(res);
  res.json({ ok: true });
}

export async function whoami(req: Request, res: Response) {
  return res.json((req as any).user ?? null);
}
