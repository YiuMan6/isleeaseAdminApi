import { Request, Response } from 'express';
import { getAllProductsService } from '../services/product.service';

export const getAllProductsController = async (_req: Request, res: Response) => {
  try {
    const products = await getAllProductsService();
    res.json({ success: true, data: products });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
