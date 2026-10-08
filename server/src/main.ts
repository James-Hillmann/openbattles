import { startRelay } from './relay';

const port = Number(process.env.PORT ?? 8787);
startRelay({ port });
console.log(`relay listening on ws://localhost:${port}`);
