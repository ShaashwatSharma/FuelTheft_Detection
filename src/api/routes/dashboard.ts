import express from 'express';
import { getDashboardData } from '../controllers/dashboardController';

const router = express.Router();

router.get('/', getDashboardData);

export default router;
