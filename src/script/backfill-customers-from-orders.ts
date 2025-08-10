import { prisma } from "../config/db";
function normalizeEmail(email?: string | null) {
  return email ? email.trim().toLowerCase() : null;
}
function normalizePhone(phone?: string | null) {
  if (!phone) return null;
  const trimmed = phone.trim();
  const cleaned = trimmed.replace(/[^+\d]/g, "");
  return cleaned || null;
}

async function findOrCreateCustomer(args: {
  name: string;
  email?: string | null;
  phone?: string | null;
}) {
  const email = normalizeEmail(args.email);
  const phone = normalizePhone(args.phone);

  if (email) {
    const byEmail = await prisma.customer.findFirst({ where: { email } });
    if (byEmail) return byEmail;
  }
  if (phone) {
    const byPhone = await prisma.customer.findFirst({ where: { phone } });
    if (byPhone) return byPhone;
  }
  return prisma.customer.create({
    data: { name: args.name || "Unknown", email, phone },
  });
}

async function backfill() {
  const orders = await prisma.order.findMany({
    where: { customerId: null },
    select: {
      id: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
    },
  });

  console.log(`Found ${orders.length} orders without customerId.`);
  let created = 0,
    reused = 0,
    updated = 0;

  for (const o of orders) {
    const before = await prisma.customer.count();
    const customer = await findOrCreateCustomer({
      name: o.customerName,
      email: o.customerEmail,
      phone: o.customerPhone,
    });
    const after = await prisma.customer.count();
    if (after > before) created++;
    else reused++;

    await prisma.order.update({
      where: { id: o.id },
      data: { customerId: customer.id },
    });
    updated++;
    if (updated % 100 === 0)
      console.log(`Progress: ${updated}/${orders.length}`);
  }

  console.log("Backfill summary:");
  console.log(`  Orders updated:   ${updated}`);
  console.log(`  Customers reused: ${reused}`);
  console.log(`  Customers created:${created}`);
}

backfill()
  .catch((e) => {
    console.error("Backfill error:", e);
    process.exit(1);
  })
  .finally(async () => {
    prisma.$disconnect();
  });
