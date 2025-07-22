import express from 'express';
import { getSensorStatus } from '../controllers/sensorController';


const router = express.Router();
// /sensor
// sensor?busid
router.get('/', getSensorStatus);



export default router;
