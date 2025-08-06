import { Router } from 'express';
import { createOrder, getAllOrders } from '../controllers/order.controller';

const router = Router();

router.post('/', createOrder);
router.get('/',getAllOrders);

export default router;
