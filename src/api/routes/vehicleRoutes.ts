import express from 'express';
import {
  getVehicles,
  getVehicleDetails,
} from '../controllers/vehicleController';

const router = express.Router();

// /vehicles
router.get('/', getVehicles);

// /vehicles/:id/details?include=alerts,events,readings&fromDate=2023-01-01&toDate=2023-12-31
router.get('/:id/details', getVehicleDetails);


export default router;
