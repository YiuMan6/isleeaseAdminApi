import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

type AdminLevel = "ADMIN" | "SUPER";
type AuthedRequest = Request & {
  user?: {
    id: number;
    label: "INTERNAL" | "RETAILER" | "VIP" | string;
    customerId?: number | null;
    adminLevel?: AdminLevel | null;
    sessionVersion?: number;
  };
};

const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET || "dev-access-secret";

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
      customerId: p.customerId ?? null,
      adminLevel: (p.adminLevel ?? null) as AdminLevel | null,
      sessionVersion: p.sv ?? 0,
    };
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

const rank: Record<AdminLevel, number> = { ADMIN: 1, SUPER: 2 };

export function requireAdminLevel(min: AdminLevel = "ADMIN") {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const u = req.user;
    if (!u) return res.status(401).json({ message: "No token" });
    if (u.label !== "INTERNAL")
      return res.status(403).json({ message: "Admins only" });

    const level = String(u.adminLevel ?? "ADMIN").toUpperCase() as AdminLevel;
    if (rank[level] < rank[min]) {
      return res.status(403).json({ message: `Require ${min}` });
    }
    next();
  };
}
