import { Router } from "express";
import cookieParser from "cookie-parser";
import { login, refresh, logout, whoami } from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const router = Router();
router.use(cookieParser()); // 只给 /auth 这条链解析 refresh cookie

router.post("/login", login); // 返回 accessToken + 设置 httpOnly refresh cookie
router.post("/refresh", refresh); // 用 cookie 刷新 access，并旋转 refresh
router.post("/logout", logout); // 清 cookie + 失效所有 refresh（可选）
router.get("/me", requireAuth, whoami);

export default router;
