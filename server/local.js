import 'dotenv/config';
import app from '../api/index.js';

const port = Number(process.env.PORT || 8787);

app.listen(port, () => {
  console.log(`MeetMiddle API listening on http://localhost:${port}`);
});
