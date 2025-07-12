import express from 'express';
import cors from 'cors';
import statsRoutes from './routes/stats';

import dashboardRoutes from './routes/dashboard';
import busRoutes from './routes/buses';
import alertRoutes from './routes/alerts';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/dashboard', dashboardRoutes);
app.use('/buses', busRoutes);
app.use('/alerts', alertRoutes);
app.use('/stats', statsRoutes);

app.get('/health', (req, res) => {
  res.send('✅ API is healthy');
});

app.listen(PORT, () => {
  console.log(`🚀 API server running on port ${PORT}`);
});
