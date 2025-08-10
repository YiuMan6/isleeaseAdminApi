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

const COOKIE_NAME = process.env.COOKIE_NAME || "refresh_token";
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN;
const PROD = process.env.NODE_ENV === "production";

// sameSite 可通过环境变量覆盖（lax | none | strict），默认 lax
type SameSiteOpt = "lax" | "none" | "strict";
const SAMESITE = (
  process.env.COOKIE_SAMESITE || "lax"
).toLowerCase() as SameSiteOpt;
const SECURE = PROD || SAMESITE === "none";

// 令牌时长（默认：access 15 分钟，refresh 60 分钟）
const ACCESS_TTL_MIN = parseInt(process.env.ACCESS_TTL_MIN || "15", 10);
const REFRESH_TTL_MIN = parseInt(process.env.REFRESH_TTL_MIN || "60", 10);

// CSRF：只在跨站 Cookie（sameSite=none）时强制校验，其他情况下可不强制（本地/同站更方便）
const REQUIRE_CSRF = SAMESITE === "none";
const CSRF_COOKIE = process.env.CSRF_COOKIE_NAME || "XSRF-TOKEN";
const CSRF_HEADER = (
  process.env.CSRF_HEADER_NAME || "x-csrf-token"
).toLowerCase();

function setRefreshCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: SECURE,
    sameSite: SAMESITE,
    path: "/",
    domain: COOKIE_DOMAIN || undefined,
    maxAge: REFRESH_TTL_MIN * 60 * 1000, // 1 小时（或按 env）
  });
}

function setCsrfCookie(res: Response) {
  // 双提交：非 httpOnly，让前端能读到并放到请求头
  const value = crypto.randomBytes(24).toString("hex");
  res.cookie(CSRF_COOKIE, value, {
    httpOnly: false,
    secure: SECURE,
    sameSite: SAMESITE,
    path: "/",
    domain: COOKIE_DOMAIN || undefined,
    maxAge: REFRESH_TTL_MIN * 60 * 1000,
  });
  return value;
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    path: "/",
    domain: COOKIE_DOMAIN || undefined,
    sameSite: SAMESITE,
    secure: SECURE,
  });
  // 同时清掉 CSRF Cookie（名称与设置一致）
  res.clearCookie(CSRF_COOKIE, {
    path: "/",
    domain: COOKIE_DOMAIN || undefined,
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
    return res
      .status(400)
      .json({ message: "Invalid body", issues: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const user = await authenticate(email, password);
  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  // access 15m、refresh 60m（由 service 内部的 env/常量控制）
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
  setCsrfCookie(res); // 设置/更新 CSRF

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

  // 双提交 CSRF 检查（仅在 sameSite=none 时强制）
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
    setCsrfCookie(res); // 每次旋转也更新 CSRF
    res.json({ accessToken, accessTokenExpiresInMin: ACCESS_TTL_MIN });
  } catch (e: any) {
    const msg =
      e?.message === "SESSION_INVALIDATED"
        ? "Session invalidated"
        : e?.message === "USER_NOT_FOUND"
        ? "User not found"
        : "Invalid refresh token";
    clearRefreshCookie(res);
    // 被服务器失效可视为 403，更语义化；其他按 401
    const code = msg === "Session invalidated" ? 403 : 401;
    res.status(code).json({ message: msg });
  }
}

export async function logout(req: Request, res: Response) {
  // 更安全：优先按已鉴权用户失效；否则仅清 Cookie
  const authedUserId = (req as any).user?.id as number | undefined;
  const bodyEmail = (req.body?.email as string | undefined)
    ?.toLowerCase?.()
    ?.trim?.();

  if (authedUserId) {
    await invalidateSessionsByUserId(authedUserId);
  } else if (bodyEmail) {
    // 兼容旧用法，但不推荐：可能被人滥用传他人邮箱
    await invalidateSessionsByEmail(bodyEmail);
  }

  clearRefreshCookie(res);
  res.json({ ok: true });
}

export async function whoami(req: Request, res: Response) {
  return res.json((req as any).user ?? null);
}
