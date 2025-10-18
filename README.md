# isleeaseAdminApi


# 把云端数据库结构拉到本地
npx prisma db pull

# 根据结构生成 TypeScript 客户端
npx prisma generate

# 本地DBUG
npx prisma studio


# 本地改变数据结构后，推送到云端，先生成迁移文件，接着
npx prisma migrate dev --name change_xxx

# 执行所有的Migration文件
npx prisma migrate deploy