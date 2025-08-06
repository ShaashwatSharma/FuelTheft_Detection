import express from 'express';
import { getSummaryMetrics } from '../controllers/summarymatrixcontroller';


const router = express.Router();


router.get('/', getSummaryMetrics);



export default router;
