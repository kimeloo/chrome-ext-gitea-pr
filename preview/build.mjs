// 확장 프로그램 원본을 수정하지 않고 단일 HTML 미리보기(dist/gitea-pr-status-preview.html)를 생성한다.
// Node 내장 모듈만 사용하며, 어느 작업 디렉터리에서 실행해도 저장소 루트를 기준으로 동작한다.
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXT_DIR = path.join(ROOT, 'extension');
const PREVIEW_DIR = path.join(ROOT, 'preview');
const OUT_FILE = path.join(ROOT, 'dist', 'gitea-pr-status-preview.html');

const ICON_SIZES = ['16', '32', '48', '128'];
const ALLOWED_REF = /^(?:https?:|data:|#|mailto:)/i;
const REMOTE_REF = /^(?:https?:|data:|\/\/|mailto:|#)/i;

export class BuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BuildError';
  }
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

function fail(abs, line, message) {
  throw new BuildError(`${rel(abs)}${line ? `:${line}` : ''}: ${message}`);
}

function lineAt(text, index) {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line += 1;
  return line;
}

const countNewlines = (text) => (text.match(/\n/g) ?? []).length;

// BOM과 CRLF를 제거해 줄 번호와 정규식 앵커를 안정적으로 유지한다.
function readText(abs) {
  try {
    return readFileSync(abs, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  } catch (err) {
    if (err.code === 'ENOENT') throw new BuildError(`${rel(abs)}: 파일이 없다.`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 인라인 안전 처리

// 인라인 <script> 안의 </script, <!-- 가 HTML 파서를 속이지 않도록 문자열 이스케이프로 바꾼다.
const escapeJs = (text) => text.replace(/<\/(script|style)/gi, '<\\/$1').replace(/<!--/g, '\\x3C!--');
const escapeCss = (text) => text.replace(/<\/(script|style)/gi, '<\\/$1');
const escapeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

// ---------------------------------------------------------------------------
// 구문 검증

function syntaxErrorLine(err) {
  const head = String(err?.stack ?? '').split('\n', 1)[0];
  return /:(\d+)$/.exec(head)?.[1] ?? null;
}

// 첫 줄에서 래퍼를 열어 원본 줄 번호와 오류 줄 번호가 일치하게 한다.
function validateModuleSyntax(abs, code) {
  try {
    new vm.Script(`(async () => {"use strict";${code}\n})`, { filename: abs });
  } catch (err) {
    fail(abs, syntaxErrorLine(err), `${err.name}: ${err.message}`);
  }
}

function validateClassicSyntax(abs, code) {
  try {
    new vm.Script(code, { filename: abs });
  } catch (err) {
    fail(abs, syntaxErrorLine(err), `${err.name}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 모듈 번들러

// 지원하는 import는 한 가지 형태뿐이다: import { a, b as c } from './x.js';
const IMPORT_RE = /^import[ \t]*\{([^}]*)\}[ \t]*from[ \t]*(["'])([^"'\n]+)\2[ \t]*;?[ \t]*$/gm;
const EXPORT_RE = /^export[ \t]+(?:(?:async[ \t]+)?function|const|class)[ \t]+([A-Za-z_$][\w$]*)/gm;
const IDENT_RE = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/;
const LEFTOVER_RE = /^\s*(import|export)\b/;
const DYNAMIC_RE = /(?<![\w$.])import\s*(?:\(|\.\s*meta\b)/;
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*)/;
const SUPPORTED_HINT = "지원 구문: import { a, b as c } from './x.js'; export const|function|async function|class NAME";

function parseSpecifiers(abs, line, body) {
  const specifiers = [];
  for (const raw of body.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = IDENT_RE.exec(part);
    if (!m || m[1] === 'default') fail(abs, line, `지원하지 않는 import 지정자: "${part}". ${SUPPORTED_HINT}`);
    specifiers.push({ imported: m[1], local: m[2] ?? m[1] });
  }
  if (!specifiers.length) fail(abs, line, `비어 있는 import 구문이다. ${SUPPORTED_HINT}`);
  return specifiers;
}

function assertNoUnsupported(abs, code) {
  const lines = code.split('\n');
  lines.forEach((text, index) => {
    if (LEFTOVER_RE.test(text)) {
      fail(abs, index + 1, `지원하지 않는 import/export 구문: "${text.trim().slice(0, 80)}". ${SUPPORTED_HINT}`);
    }
    if (!COMMENT_LINE_RE.test(text) && DYNAMIC_RE.test(text)) {
      fail(abs, index + 1, `동적 import 또는 import.meta는 지원하지 않는다: "${text.trim().slice(0, 80)}"`);
    }
  });
}

/**
 * 진입 모듈에서 상대 경로 import를 따라가며 하나의 인라인 모듈 스크립트 텍스트를 만든다.
 * 각 모듈은 의존 순서대로 한 번만 async 즉시 실행 함수로 감싸 출력한다.
 */
export function bundle(entryAbsPath) {
  const entry = path.resolve(entryAbsPath);
  const VISITING = Symbol('visiting');
  const records = new Map();
  const order = [];

  const visit = (abs, from) => {
    const known = records.get(abs);
    if (known === VISITING) fail(from.abs, from.line, `순환 import는 지원하지 않는다: ${rel(abs)}`);
    if (known) return known;
    records.set(abs, VISITING);
    const record = transform(abs);
    record.id = order.length;
    order.push(record);
    records.set(abs, record);
    return record;
  };

  const resolveImport = (importer, line, spec) => {
    if (!spec.startsWith('./') && !spec.startsWith('../')) {
      fail(importer, line, `상대 경로 import만 지원한다: "${spec}"`);
    }
    const target = path.resolve(path.dirname(importer), spec);
    let isFile = false;
    try {
      isFile = statSync(target).isFile();
    } catch {
      // 존재하지 않는 경로는 아래에서 오류로 처리한다.
    }
    if (!isFile) fail(importer, line, `import 대상 파일이 없다: "${spec}"`);
    return visit(target, { abs: importer, line });
  };

  const transform = (abs) => {
    let code = readText(abs);
    const exportNames = [];

    code = code.replace(IMPORT_RE, (match, body, _quote, spec, offset) => {
      const line = lineAt(code, offset);
      const specifiers = parseSpecifiers(abs, line, body);
      const dep = resolveImport(abs, line, spec);
      for (const { imported } of specifiers) {
        if (!dep.exportNames.includes(imported)) {
          fail(abs, line, `"${spec}"에 export "${imported}"이(가) 없다.`);
        }
      }
      const names = specifiers.map(({ imported, local }) => (imported === local ? local : `${imported}: ${local}`));
      return `const { ${names.join(', ')} } = __m${dep.id};${'\n'.repeat(countNewlines(match))}`;
    });

    code = code.replace(EXPORT_RE, (match, name, offset) => {
      if (exportNames.includes(name)) fail(abs, lineAt(code, offset), `중복 export: "${name}"`);
      exportNames.push(name);
      return match.replace(/^export[ \t]+/, '');
    });

    assertNoUnsupported(abs, code);
    validateModuleSyntax(abs, code);
    return { abs, id: -1, exportNames, code };
  };

  visit(entry, { abs: entry, line: 0 });

  const parts = order.map(({ id, code, exportNames }) => {
    const exported = exportNames.length ? `{ ${exportNames.join(', ')} }` : '{}';
    return `const __m${id} = await (async () => {\n${code}\nreturn ${exported};\n})();`;
  });
  parts.push('window.__gprFrameReady?.();');
  return `${parts.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// HTML 조립 보조

// 인라인할 본문을 자리표시자로 치환해 두고, 남은 로컬 참조 검사가 본문을 훑지 않도록 한다.
class Chunks {
  #items = [];

  add(content, original = '') {
    this.#items.push(content);
    return `\u0000${this.#items.length - 1}\u0000${'\n'.repeat(countNewlines(original))}`;
  }

  resolve(html) {
    return html.replace(/\u0000(\d+)\u0000/g, (_m, index) => this.#items[Number(index)]);
  }
}

function replaceOnce(abs, text, needle, replacement) {
  const at = text.indexOf(needle);
  if (at === -1) fail(abs, 0, `자리표시자 또는 앵커 "${needle}"가 없다.`);
  return text.slice(0, at) + replacement + text.slice(at + needle.length);
}

const REF_RE = /(?<![\w-])(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

function assertNoLocalRefs(abs, skeleton) {
  for (const m of skeleton.matchAll(REF_RE)) {
    const value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!ALLOWED_REF.test(value)) {
      fail(abs, lineAt(skeleton, m.index), `인라인되지 않은 로컬 참조가 남아 있다: ${m[0]}`);
    }
  }
}

// 인라인할 CSS가 외부 파일을 다시 참조하면 file:// 환경에서 깨지므로 빌드 단계에서 막는다.
function assertSelfContainedCss(abs, css) {
  const imported = /@import\b/.exec(css);
  if (imported) fail(abs, lineAt(css, imported.index), '@import는 인라인할 수 없다.');
  for (const m of css.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) {
    if (!ALLOWED_REF.test(m[2].trim())) fail(abs, lineAt(css, m.index), `인라인되지 않은 CSS 참조가 남아 있다: ${m[0]}`);
  }
}

const dataUri = (abs, mime) => `data:${mime};base64,${readFileSync(abs).toString('base64')}`;

function readLocalText(htmlAbs, ref, line) {
  const target = path.resolve(path.dirname(htmlAbs), ref);
  try {
    return { abs: target, text: readText(target) };
  } catch (err) {
    if (err instanceof BuildError) fail(htmlAbs, line, `참조한 파일이 없다: "${ref}"`);
    throw err;
  }
}

const readShim = () => {
  const abs = path.join(PREVIEW_DIR, 'frame-shim.js');
  const text = readText(abs);
  validateClassicSyntax(abs, text);
  return text;
};

const shimHead = (kind, shim) =>
  `<script>window.__GPR_FRAME__="${kind}";</script><script>${escapeJs(shim)}</script>`;

// ---------------------------------------------------------------------------
// 확장 프레임 (srcdoc HTML)

const CLASSIC_SCRIPT_RE = /<script\s+src="([^"]+)"\s*>\s*<\/script>/gi;
const MODULE_SCRIPT_RE = /<script\s+type="module"\s+src="([^"]+)"\s*>\s*<\/script>/gi;
const STYLESHEET_RE = /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/gi;
const ICON_RE = /(?<![\w-])src="(icons\/[\w.-]+\.png)"/gi;
const HEAD_RE = /<head(?:\s[^>]*)?>/i;

function buildHtmlFrame(kind, shim) {
  const htmlAbs = path.join(EXT_DIR, `${kind}.html`);
  const chunks = new Chunks();
  let html = readText(htmlAbs);

  // 한 번의 치환 패스로 처리하므로 치환 결과가 다른 규칙에 다시 걸리지 않는다.
  const lineOf = (offset) => lineAt(html, offset);

  html = html.replace(CLASSIC_SCRIPT_RE, (match, ref, offset) => {
    if (REMOTE_REF.test(ref)) return match;
    const { abs, text } = readLocalText(htmlAbs, ref, lineOf(offset));
    validateClassicSyntax(abs, text);
    return chunks.add(`<script>${escapeJs(text)}</script>`, match);
  });

  html = html.replace(STYLESHEET_RE, (match, ref, offset) => {
    if (REMOTE_REF.test(ref)) return match;
    const { abs, text } = readLocalText(htmlAbs, ref, lineOf(offset));
    assertSelfContainedCss(abs, text);
    return chunks.add(`<style>${escapeCss(text)}</style>`, match);
  });

  html = html.replace(ICON_RE, (_match, ref, offset) => {
    const abs = path.resolve(EXT_DIR, ref);
    try {
      return `src="${dataUri(abs, 'image/png')}"`;
    } catch (err) {
      if (err.code === 'ENOENT') fail(htmlAbs, lineOf(offset), `참조한 아이콘이 없다: "${ref}"`);
      throw err;
    }
  });

  html = html.replace(MODULE_SCRIPT_RE, (match, ref, offset) => {
    if (REMOTE_REF.test(ref)) return match;
    const entry = path.resolve(path.dirname(htmlAbs), ref);
    readLocalText(htmlAbs, ref, lineOf(offset));
    return chunks.add(`<script type="module">${escapeJs(bundle(entry))}</script>`, match);
  });

  const head = HEAD_RE.exec(html);
  if (!head) fail(htmlAbs, 0, '<head> 태그가 없어 shim을 주입할 수 없다.');
  const headEnd = head.index + head[0].length;
  html = html.slice(0, headEnd) + chunks.add(shimHead(kind, shim)) + html.slice(headEnd);

  assertNoLocalRefs(htmlAbs, html);
  return chunks.resolve(html);
}

function buildBackgroundFrame(shim) {
  const code = bundle(path.join(EXT_DIR, 'background.js'));
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    shimHead('background', shim) +
    '</head><body><script type="module">' +
    escapeJs(code) +
    '</script></body></html>'
  );
}

/** kind: 'popup' | 'options' | 'background'. shim을 생략하면 preview/frame-shim.js를 읽는다. */
export function buildFrame(kind, shim = readShim()) {
  if (kind === 'background') return buildBackgroundFrame(shim);
  if (kind === 'popup' || kind === 'options') return buildHtmlFrame(kind, shim);
  throw new BuildError(`알 수 없는 프레임 종류: "${kind}"`);
}

// ---------------------------------------------------------------------------
// 셸 조립

function buildAssets(shim) {
  const manifestAbs = path.join(EXT_DIR, 'manifest.json');
  const manifest = JSON.parse(readText(manifestAbs));
  const icons = {};
  for (const size of ICON_SIZES) {
    const file = manifest.icons?.[size];
    if (!file) fail(manifestAbs, 0, `icons["${size}"] 항목이 없다.`);
    const abs = path.resolve(EXT_DIR, file);
    try {
      icons[size] = dataUri(abs, 'image/png');
    } catch (err) {
      if (err.code === 'ENOENT') fail(manifestAbs, 0, `아이콘 파일이 없다: "${file}"`);
      throw err;
    }
  }
  return {
    frames: {
      popup: buildFrame('popup', shim),
      options: buildFrame('options', shim),
      background: buildFrame('background', shim),
    },
    icons,
    manifest: { name: manifest.name, version: manifest.version },
  };
}

/** preview/shell.html의 세 자리표시자를 채운 최종 HTML 텍스트를 반환한다. */
export function buildShell(shim = readShim()) {
  const shellAbs = path.join(PREVIEW_DIR, 'shell.html');
  const cssAbs = path.join(PREVIEW_DIR, 'shell.css');
  const chunks = new Chunks();
  let html = readText(shellAbs);

  const css = readText(cssAbs);
  assertSelfContainedCss(cssAbs, css);

  html = replaceOnce(shellAbs, html, '/*@SHELL_CSS*/', chunks.add(escapeCss(css)));
  html = replaceOnce(shellAbs, html, '/*@ASSETS_JSON*/', chunks.add(escapeJson(buildAssets(shim))));
  html = replaceOnce(
    shellAbs,
    html,
    '/*@SHELL_JS*/',
    chunks.add(escapeJs(bundle(path.join(PREVIEW_DIR, 'shell.js')))),
  );

  assertNoLocalRefs(shellAbs, html);
  return chunks.resolve(html);
}

export function build() {
  const html = buildShell();
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, html);
  const kib = (statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log(`생성: ${OUT_FILE} (${kib} KiB)`);
  return OUT_FILE;
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    build();
  } catch (err) {
    if (err instanceof BuildError) console.error(`빌드 실패: ${err.message}`);
    else console.error(err);
    process.exitCode = 1;
  }
}
