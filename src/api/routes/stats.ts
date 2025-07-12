import express from 'express';
import { getStatsSummary } from '../controllers/statsController';


const router = express.Router();

router.get('/summary', getStatsSummary);

export default router;
