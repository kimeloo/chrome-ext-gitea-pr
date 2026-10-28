// HTML 미리보기를 로컬 HTTP(127.0.0.1)로 제공한다.
// 보안 프로그램 등으로 크롬이 file:// 경로를 열지 못하는 환경을 위한 실행 방법이며, 요청마다 다시 빌드하므로
// 확장 코드를 수정한 뒤 브라우저에서 새로고침하면 바로 반영된다.
import http from 'node:http';
import { BuildError, buildShell } from './build.mjs';

const HOST = '127.0.0.1';
const FIRST_PORT = Number(process.env.PORT) || 4173;
const MAX_ATTEMPTS = 10;

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${HOST}`);
  if (req.method !== 'GET' || pathname !== '/') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  try {
    const html = buildShell();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
  } catch (err) {
    const message = err instanceof BuildError ? err.message : String(err?.stack ?? err);
    console.error(message);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`미리보기 빌드 실패\n\n${message}`);
  }
});

function listen(port, attempt) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_ATTEMPTS) {
      listen(port + 1, attempt + 1);
      return;
    }
    console.error(err.message);
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    console.log(`미리보기: http://${HOST}:${port}/  (종료: Ctrl+C)`);
  });
}

listen(FIRST_PORT, 1);
