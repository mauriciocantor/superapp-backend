require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRouter = require('./auth');
const registryRouter = require('./registry');
const path = require('path');
const environmentsRouter = require('./environments');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/environments', environmentsRouter);
app.use('/auth', authRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.use('/registry', registryRouter);
app.use('/miniapps', express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`SuperApp Backend corriendo en puerto ${PORT}`);
});