import express from 'express';
import { getAlerts, getAllAlerts } from '../controllers/alertController';

const router = express.Router();

router.get('/', getAlerts);
router.get('/all', getAllAlerts);


export default router;
