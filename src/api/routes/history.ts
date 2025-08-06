import express from 'express';
import { getHistory } from '../controllers/historycontroller';

const router = express.Router();
// /alerts?type&fromDate&toDate
router.get('/', getHistory);



export default router;

