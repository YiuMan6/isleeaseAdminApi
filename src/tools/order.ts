import { Prisma } from "@prisma/client";
import { DecInput } from "../types/ordert";

export const toDec = (v: DecInput): Prisma.Decimal => {
  if (v instanceof Prisma.Decimal) return v;
  if (typeof v === "number" || typeof v === "string") return new Prisma.Decimal(v);
  return new Prisma.Decimal(0);
};

export const toNum2 = (v: DecInput) => Number(toDec(v).toFixed(2));

export function calcOrderMoney(order: any) {
  // 产品小计（未税）
  const productSubtotalDec = (order?.items ?? []).reduce(
    (sum: Prisma.Decimal, it: any) => {
      const priceDec = toDec(it?.product?.price); // 可接收 number/string/Decimal
      const qty = Number(it?.quantity ?? 0);
      return sum.add(priceDec.mul(qty));
    },
    new Prisma.Decimal(0)
  );

  // 运费
  const shippingCostDec = toDec(order?.shippingCost);
  const shippingGstIncl = order?.shippingGstIncl ?? true;

  const shippingExGstDec = shippingGstIncl
    ? shippingCostDec.div(1.1)
    : shippingCostDec;

  const gstOnProductsDec = productSubtotalDec.mul(0.1);
  const gstOnShippingDec = shippingExGstDec.mul(0.1);

  const subtotalExGstDec = productSubtotalDec.add(shippingExGstDec);
  const gstTotalDec = gstOnProductsDec.add(gstOnShippingDec);
  const grandTotalDec = subtotalExGstDec.add(gstTotalDec);

  return {
    money: {
      productSubtotal: toNum2(productSubtotalDec),
      shippingExGst: toNum2(shippingExGstDec),
      gstOnProducts: toNum2(gstOnProductsDec),
      gstOnShipping: toNum2(gstOnShippingDec),
      subtotalExGst: toNum2(subtotalExGstDec),
      gstTotal: toNum2(gstTotalDec),
      totalWithGST: toNum2(grandTotalDec),
    },
  };
}
