import cors from "cors";

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    console.log("[CORS] request origin =", origin);
    const allowed = [
      "https://admin.isleease.com",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5174", // 以防你用 127.0.0.1 打开
    ];
    if (!origin || allowed.includes(origin)) callback(null, true);
    else callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  exposedHeaders: ["x-access-token", "x-auth-expired"],
  optionsSuccessStatus: 204,
});
