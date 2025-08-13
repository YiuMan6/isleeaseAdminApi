import { prisma } from "../config/db";

export const getAllProductsService = async () => {
  return prisma.product.findMany({
    include: {
      Image: true,
      Video: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
};
