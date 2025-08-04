import { Request, Response } from 'express';
import { createOrderService } from '../services/order.service'

export const createOrder = async (req: Request, res: Response) => {
  try {
    const order = await createOrderService(req.body);
    res.status(201).json({ message: 'Order created successfully', order });
  } catch (error: any) {
    console.error('Create order error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
