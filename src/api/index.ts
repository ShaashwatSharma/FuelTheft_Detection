import express from 'express';
import cors from 'cors';
import alertRoutes from './routes/alerts';
import vehicleRoutes from './routes/vehicleRoutes';
import sensor from './routes/sensor';
import fuelUsageRoutes from './routes/fuelUsageRoutes';
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/vehicles', vehicleRoutes);
app.use('/alerts', alertRoutes);
app.use('/sensor', sensor);
app.use('/fuelusage', fuelUsageRoutes);


app.get('/health', (req, res) => {
  res.send('✅ API is healthy');
});

app.listen(PORT, () => {
  console.log(`🚀 API server running on port ${PORT}`);
});
