import express from 'express';
import cors from 'cors';

import historyRoutes from './routes/history';
import vehicleRoutes from './routes/vehicleRoutes';
import sensor from './routes/sensor';
import fuelUsageRoutes from './routes/fuelUsageRoutes';
import getSummaryMetrics  from './routes/summaryMatrix';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/vehicles', vehicleRoutes);
app.use('/history', historyRoutes);
app.use('/sensor', sensor);
app.use('/fuelusage', fuelUsageRoutes);
app.use('/summarymatrix', getSummaryMetrics);



app.get('/health', (req, res) => {
  res.send('✅ API is healthy');
});

app.listen(PORT, () => {
  console.log(`🚀 API server running on port ${PORT}`);
});
