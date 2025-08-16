import { Router } from 'express';
import { getFuelUsage } from '../controllers/fuelUsageController';

const router = Router();
// /fuelusage?busId&fromDate&toDate
router.get('/', getFuelUsage);

export default router;
