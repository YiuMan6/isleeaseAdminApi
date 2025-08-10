import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

type AdminLevel = "ADMIN" | "SUPER";
type AuthedRequest = Request & {
  user?: {
    id: number;
    label: "INTERNAL" | "RETAILER" | "VIP" | string;
    customerId?: number | null;
    adminLevel?: "ADMIN" | "SUPER" | null;
    sessionVersion?: number;
  };
};

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
const rank: Record<string, number> = { ADMIN: 1, SUPER: 2 };

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  const auth = req.header("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const p = jwt.verify(token, ACCESS_SECRET) as any;
    req.user = {
      id: Number(p.sub),
      label: p.label,
      customerId: p.customerId,
      adminLevel: p.adminLevel,
      sessionVersion: p.sv,
    };
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

export function requireAdminLevel(min: AdminLevel = "ADMIN") {
  // 👇 把 req/res/next 都标注类型
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const u = req.user;
    if (!u) return void res.status(401).json({ message: "No token" });
    if (u.label !== "INTERNAL")
      return void res.status(403).json({ message: "Admins only" });

    const level = String(u.adminLevel ?? "ADMIN").toUpperCase() as AdminLevel;
    if (rank[level] < rank[min]) {
      return void res.status(403).json({ message: `Require ${min}` });
    }
    next();
  };
}
