import express from 'express';
import { getAlerts } from '../controllers/alerts';

const router = express.Router();
// /alerts?type&fromDate&toDate
router.get('/', getAlerts);



export default router;
