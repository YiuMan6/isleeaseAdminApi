// src/services/auth.service.ts
import jwt, { JwtPayload } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../config/db";

// === 配置（可用 env 覆盖）===
const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET || "dev-access-secret";
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET || "dev-refresh-secret";

const ACCESS_TTL_MIN = parseInt(process.env.ACCESS_TTL_MIN || "15", 10); // 15m
const REFRESH_TTL_MIN = parseInt(process.env.REFRESH_TTL_MIN || "60", 10); // 60m

// === 类型 ===
type TokenUser = {
  id: number;
  label: any; // 你的项目里可能是枚举，放宽为 any 以避免类型冲突
  customerId: number | null;
  adminLevel: any | null; // 可能为枚举
  sessionVersion: number;
};

type RefreshPayload = JwtPayload & {
  sub: number | string; // 标准里 sub 常为 string
  sv: number; // sessionVersion
};

// === 工具：类型守卫 / sub 转换 ===
const isRefreshPayload = (p: unknown): p is RefreshPayload => {
  return !!p && typeof p === "object" && typeof (p as any).sv === "number";
};

const toUserId = (sub: number | string | undefined): number => {
  if (typeof sub === "number") return sub;
  if (typeof sub === "string" && /^\d+$/.test(sub)) return parseInt(sub, 10);
  throw new Error("INVALID_REFRESH");
};

// === 用户鉴权（按需替换实现）===
export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      email: true,
      label: true,
      sessionVersion: true,
      customerId: true,
      adminLevel: true,
      password: true, // 取 hash 用于校验
    },
  });
  if (!user) return null;

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return null;

  // 去掉 password 再返回
  const { password: _omit, ...safe } = user;
  return safe;
}

// === 签发 Token ===
export function signAccessTokenFor(user: TokenUser) {
  const payload = {
    sub: user.id,
    label: user.label,
    customerId: user.customerId,
    adminLevel: user.adminLevel,
    sv: user.sessionVersion,
  };
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: `${ACCESS_TTL_MIN}m` });
}

export function signRefreshTokenFor(input: {
  id: number;
  sessionVersion: number;
}) {
  const payload = { sub: input.id, sv: input.sessionVersion };
  return jwt.sign(payload, REFRESH_SECRET, {
    expiresIn: `${REFRESH_TTL_MIN}m`,
  });
}

// === 刷新 & 旋转 ===
export async function rotateFromRefresh(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  let decoded: RefreshPayload;
  try {
    const raw = jwt.verify(refreshToken, REFRESH_SECRET) as string | JwtPayload;
    if (!isRefreshPayload(raw)) throw new Error("INVALID_REFRESH");
    decoded = raw;
  } catch {
    throw new Error("INVALID_REFRESH");
  }

  const userId = toUserId(decoded.sub);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("USER_NOT_FOUND");

  // sessionVersion 不一致 -> 服务器端已失效（登出/重置密码等）
  if ((user.sessionVersion ?? 0) !== decoded.sv) {
    throw new Error("SESSION_INVALIDATED");
  }

  // 颁发新的 access & refresh（滑动续期）
  const accessToken = signAccessTokenFor({
    id: user.id,
    label: user.label,
    customerId: user.customerId ?? null,
    adminLevel: (user as any).adminLevel ?? null,
    sessionVersion: user.sessionVersion ?? 0,
  });
  const newRefreshToken = signRefreshTokenFor({
    id: user.id,
    sessionVersion: user.sessionVersion ?? 0,
  });

  return { accessToken, refreshToken: newRefreshToken };
}

// === 会话失效（软失效：递增 sessionVersion）===
export async function invalidateSessionsByEmail(email: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, sessionVersion: true },
  });
  if (!user) return;
  await prisma.user.update({
    where: { id: user.id },
    data: { sessionVersion: (user.sessionVersion ?? 0) + 1 },
  });
}

export async function invalidateSessionsByUserId(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, sessionVersion: true },
  });
  if (!user) return;
  await prisma.user.update({
    where: { id: user.id },
    data: { sessionVersion: (user.sessionVersion ?? 0) + 1 },
  });
}
