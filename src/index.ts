import express from "express";
import { corsMiddleware } from "./middlewares/cors.middleware";
import authRoutes from "./routes/auth.route";
import orderRoutes from "./routes/order.route";
import productRoutes from "./routes/product.route";
import inventoryRoutes from "./routes/inventory.route";
import { requireAuth } from "./middlewares/auth.middleware";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// 全局中间件
app.use(corsMiddleware); // 允许跨域 + 带 cookie
app.use(express.json());

// 公共路由（登录 / 刷新 / 登出 / 我是谁）
app.use("/api/auth", authRoutes); // auth.route.ts 内部已 use(cookieParser())

// 受保护的业务路由（必须带 Authorization: Bearer <access>）
app.use("/api/orders", requireAuth, orderRoutes);
app.use("/api/products", requireAuth, productRoutes);

app.use("/api/inventory", inventoryRoutes);
// 健康检查（可选）
app.get("/health", (_req, res) => res.json({ ok: true }));

// 启动服务
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
