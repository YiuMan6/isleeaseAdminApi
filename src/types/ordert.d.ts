interface OrderItemInput {
  productId: number;
  quantity: number;
}

interface CreateOrderInput {
  userId?: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  position: string;
  note?: string;
  barcodeAll: boolean;
  packageType: "boxes" | "opp";
  items: OrderItemInput[];
}

/** ---------- Decimal helpers（关键修复） ---------- */
type DecInput = Prisma.Decimal | number | string | bigint | null | undefined;
// 


export type UpdateOrderUnifiedInput = {
  expectedUpdatedAt?: string;

  // 基本信息
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress?: string;
  position?: string;
  note?: string | null;
  barcodeAll?: boolean;
  packageType?: "boxes" | "opp";

  // 状态（方案二：无 'paid'）
  orderStatus?:
    | "pending"
    | "confirmed"
    | "packed"
    | "shipped"
    | "completed"
    | "cancelled";

  // 支付（独立）
  paymentStatus?: "unpaid" | "paid" | "refunded";

  // 运费
  shippingCartons?: number | null;
  shippingCost?: number | null;     // Decimal? -> string|null when writing
  shippingGstIncl?: boolean | null; // null 视为 true
  shippingNote?: string | null;

  // 明细（整单替换；传空数组则清空）
  items?: Array<{ productId: number; quantity: number; backorder?: number }>;
};
