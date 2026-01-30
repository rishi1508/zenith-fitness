import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5174;

// Serve static files from dist
app.use(express.static(join(__dirname, 'dist')));

// SPA fallback
app.get('/{*path}', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔥 Zenith Fitness running on http://0.0.0.0:${PORT}`);
  console.log(`📱 Install as PWA on your phone!`);
});
