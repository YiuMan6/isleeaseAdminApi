import cors from "cors";

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      "https://wholesale.isleease.com",
      "https://admin.isleease.com",
      "http://localhost:5173",
      "http://localhost:5174",
    ];

    // 允许无 Origin (Postman、服务器内部调用) 或匹配白名单
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,

  allowedHeaders: ["Content-Type", "Authorization"],

  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  exposedHeaders: ["x-access-token", "x-auth-expired"],
});
