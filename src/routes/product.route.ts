import { Router } from 'express';
import { getAllProductsController } from '../controllers/product.controller';

const router = Router();

router.get('/', getAllProductsController);

export default router;
