param([string]$BrowserId = $env:SHOTPRINT_BROWSER_ID)
$ErrorActionPreference = "Stop"
$browserAct = Join-Path $env:USERPROFILE ".local\bin\browser-act.exe"
$python = Join-Path $env:APPDATA "uv\tools\browser-act-cli\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $browserAct)) { throw "未找到 BrowserAct。请先按官方方式安装 browser-act-cli。" }
if (-not (Test-Path -LiteralPath $python)) { throw "未找到 BrowserAct 的 Python 环境，请重新安装 browser-act-cli。" }
if (-not $BrowserId) {
  $matches = @(& $browserAct browser list | Select-String -Pattern '^id=(\S+).*type=chrome-direct' | ForEach-Object { $_.Matches[0].Groups[1].Value })
  if ($matches.Count -ne 1) { throw "需要且只能存在一个 chrome-direct。请先在 BrowserAct 中创建镜谱专用直连浏览器。" }
  $BrowserId = $matches[0]
}
$env:SHOTPRINT_BROWSER_ID = $BrowserId
$env:SHOTPRINT_BROWSER_ACT = $browserAct
$env:SHOTPRINT_PYTHON = $python
node (Join-Path $PSScriptRoot "server.mjs")
