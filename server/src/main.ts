import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { startRelay } from './relay';
import { staticHandler } from './static';

const port = Number(process.env.PORT ?? 8787);
const dist = fileURLToPath(new URL('../../client/dist', import.meta.url));
// One port for both: the built page over HTTP and the relay over WebSocket (any path, the client uses /relay).
const server = createServer(staticHandler(dist));
startRelay({ server });
server.listen(port, () => console.log(`OpenBattles on http://localhost:${port} (relay ws://localhost:${port}/relay)`));
