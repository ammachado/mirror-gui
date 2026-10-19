import './setup.js';
import request from 'supertest';
import { ensureTestDirs } from './setup.js';
import { app } from '../../../server/index.js';

export async function getTestApp() {
  await ensureTestDirs();
  // supertest connects to 127.0.0.1, but app.listen(0) binds every interface and can
  // get a port another local program holds on 127.0.0.1, so requests reach that
  // program instead. Binding 127.0.0.1 makes the OS pick a port free there.
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  // Nothing closes the server, so it must not keep the test worker alive.
  server.unref();
  return request(server);
}
