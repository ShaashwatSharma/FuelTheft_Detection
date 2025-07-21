import express from 'express';
import { getBusDetails } from '../controllers/busController';

const router = express.Router();

router.get('/:id/details', getBusDetails);

export default router; // ✅ this must exist