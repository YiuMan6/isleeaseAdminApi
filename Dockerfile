# ---------- 构建阶段 ----------
FROM node:20-slim AS builder

# 安装 pnpm
RUN npm i -g pnpm

WORKDIR /app

# 先安装依赖但不跑脚本（跳过 prisma generate）
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --ignore-scripts  

# 拷贝所有源码（此时 prisma/schema.prisma 已存在）
COPY . .                              

# 手动生成 Prisma Client
RUN pnpm prisma generate              

# 编译 TypeScript -> dist/
RUN pnpm tsc


# ---------- 运行阶段 ----------
FROM node:20-slim

RUN npm i -g pnpm

WORKDIR /app

# 先拷 prisma/，保证 @prisma/client 的 postinstall 能找到 schema
COPY --from=builder /app/prisma ./prisma

# 再拷依赖清单并安装生产依赖
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod

# 拷贝编译产物
COPY --from=builder /app/dist ./dist

# 环境变量与端口
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# 启动时执行 migrate 再运行服务
CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/index.js"]
