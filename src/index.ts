import express from 'express';
import { corsMiddleware } from './middlewares/cors.middleware';
const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(corsMiddleware);
// 路由
// app.use('/api/users', userRoutes);

// 启动服务器
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
