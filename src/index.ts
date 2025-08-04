import express from 'express';
import { corsMiddleware } from './middlewares/cors.middleware';
import orderRoutes from './routes/order.route';
import productRoutes from './routes/product.route';

const app = express();
const PORT = process.env.PORT || 3000;

// 全局中间件
app.use(corsMiddleware);
app.use(express.json());

// 注册路由
app.use('/api/orders', orderRoutes);

app.use('/api/products', productRoutes);

// 启动服务
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
