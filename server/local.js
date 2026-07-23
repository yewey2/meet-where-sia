import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import app from './index.mjs';

const distDirectory = fileURLToPath(new URL('../dist', import.meta.url));

if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.get('/{*path}', (_request, response) => {
    response.sendFile('index.html', { root: distDirectory });
  });
}

const port = Number(process.env.PORT || 8787);

app.listen(port, () => {
  console.log(`Meet Where Sia listening on http://localhost:${port}`);
});
