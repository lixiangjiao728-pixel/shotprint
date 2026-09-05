# Shotprint 扩展离线安装与自检

生产主站为 https://shotprint.xyz ，扩展与网页显示的版本必须一致。

1. 在镜谱首页点击“下载0.7.1扩展”，解压 `shotprint-extension-0.7.1.zip`，在 Chrome/Edge 的扩展管理页开启开发者模式，选择“加载已解压的扩展”。
2. 扩展详情应显示用户可见版本 0.7.1。如果同时加载了旧版镜谱扩展，请先移除或停用旧版。
3. 将“网站访问权限”改为“在所有请求的网站上”，再刷新镜谱首页。扩展只申请 tabs、scripting 和 Manifest 中列出的镜谱/三平台 host 权限，不申请 cookies、storage、webRequest、代理或隐身权限。
4. 首页自检应显示扩展0.7.1和主采集通道可用；百炼联网状态单独核验。BrowserAct是可选高级兜底，未启动时不会覆盖扩展主采集的真实错误，也不会阻塞手动导入。
5. 采集上限为 200 条评论、最多 15 次有界滚动、90 秒；验证码、403、429和登录墙会立即停止，禁止绕过。页面适配器失效时才按“BrowserAct网络响应→BrowserAct DOM→手动导入”降级。
6. 校验页同时发布的 `shotprint-extension-0.7.1.zip.sha256`。扩展不会读取或上传 Cookie、头像、用户名、用户 ID；导出内容也不包含这些身份字段。

若仍报错，请复制首页“安全诊断信息”，或记录错误码（例如 SITE_ACCESS_DENIED、SOURCE_HANDSHAKE_TIMEOUT、COMPANION_NOT_RUNNING、PAIRING_REQUIRED、NETWORK_RESPONSE_CHANGED）。不要发送 Cookie、Authorization、浏览器存储或账号截图。

视频无法直接读取时，选择录制目标视频标签页并共享标签页声音，或上传有权使用的原片。必须确认是同一作品、同一分P；录制不会自动绕过平台登录、验证码或访问限制。没有完整视频证据，不会解锁镜头和创作方案。
