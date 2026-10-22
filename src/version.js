// 版本检查仅请求同源静态清单，不发送图片、字段、账号或其他输入。
function compatibleRelease(value) {
  return value && typeof value.buildId === 'string' && /^[a-f0-9]{16}$/.test(value.buildId)
    && Array.isArray(value.protocols) && value.protocols.every(item => typeof item === 'string');
}
let versionRequest = null, lastVersionCheck = 0;
async function checkVersion(force = false) {
  if (!['http:', 'https:'].includes(location.protocol)) return;
  if (versionRequest) return versionRequest;
  if (!force && Date.now() - lastVersionCheck < 60000) return;
  lastVersionCheck = Date.now();
  const request = (async () => {
    let timeout;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 1200);
      const url = new URL('./version.json', location.href);
      const response = await fetch(url, {cache:'no-store', credentials:'omit', redirect:'error', signal:controller.signal});
      if (!response.ok) throw Error('version unavailable');
      const remote = await response.json();
      if (!compatibleRelease(remote)) throw Error('invalid version manifest');
      if (remote.buildId !== BUILD_INFO.buildId) {
        $('update-notice').classList.remove('hidden');
        $('update-message').textContent = `发现新版检查器 ${remote.buildId.slice(0,8)}，当前版本 ${BUILD_INFO.buildId.slice(0,8)}。更新后请重新选择图片；当前分析不会中断。`;
        $('version-state').textContent = '发现新版';
      } else { $('version-state').textContent = '已检查版本'; $('update-notice').classList.add('hidden'); }
    } catch {
      $('version-state').textContent = '版本检查不可用 · 可继续离线识别';
    } finally { clearTimeout(timeout); }
  })();
  // 即使fetch同步抛错，先发布请求引用，再于await后清理，避免永远复用已失败的Promise。
  versionRequest = request;
  try { await request; } finally { if (versionRequest === request) versionRequest = null; }
}
const isLocalPreview = ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
$('build-version').textContent = `${isLocalPreview ? '本地测试版' : '静态版'} · ${BUILD_INFO.buildId.slice(0,8)}`;
$('supported-protocols').textContent = `支持协议 ${BUILD_INFO.protocols.join(' / ')} · WEB`;
$('update-page').onclick = () => { const url = new URL(location.href); url.searchParams.set('build',Date.now().toString()); location.replace(url.href); };
window.addEventListener('focus', () => { void checkVersion(); });
void checkVersion(true);
