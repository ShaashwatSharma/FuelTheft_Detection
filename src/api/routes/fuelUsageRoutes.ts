import { Router } from 'express';
import { getFuelUsage } from '../controllers/fuelUsageController';

const router = Router();
// /fuelusage?busid&startDate&endDate
router.get('/', getFuelUsage);

export default router;
