# Shotprint 开发规则

## 快速验证

- Node.js 22.13+、pnpm 10。
- 常规完成条件：`pnpm run typecheck`、`pnpm test`、`pnpm run scan:secrets`、`pnpm build`、`pnpm run test:e2e`、`pnpm run lint`。
- `pnpm run test:real` 会访问真实 OSS/百炼并产生费用；没有明确授权时禁止运行。

## 生产边界

- 视频上限是 300 秒、300MB；前端、`/api/upload-session`、`.env.example` 与文档必须同步。
- 生产付费请求优先走 `SHOTPRINT_API_BASE` 指向的阿里云后端。300 秒视听分析和深度研究必须保持异步任务 + 轮询，不能退回 API 网关同步长连接。
- 异步分析失败回执必须保留服务端安全诊断码；结构修复必须同时携带原始证据、上一版 JSON 与校验问题，不能盲目重生成。
- 临时视频只进入 `shotprint-temp/` 私有 OSS。成功、失败和取消都要保留清理责任；浏览器永远不能拿到 OSS 或百炼 Secret。
- 费用调用前必须预留，完成后按 usage 结算。默认累计上限为 20 元；缺失 usage 时按完整预留计费，不能猜测低成本。

## 证据规则

- 没有真实视频证据时，锁定导演、制作、时间码和复刻方案。
- 不得把评论、网页来源或镜头机械配对；跨证据结论必须有真实匹配编号/时间码、反证和置信度。
- 300 秒结果必须通过 `validateEvidenceCoverage` 和 `validateActionability`；不得通过跳过、降低阈值或填充 fixture 让失败结果变绿。
- 300 秒模型证据与结构结果各自最多 48 个连续时间段；镜头更多时合并相邻段，但不得牺牲首中尾、每分钟覆盖或本机候选切点附近差异。
- 长时间轴压缩必须均匀保留首、中、尾，禁止 `slice(0, N)` 只传前段。
- 本地文件不能可靠恢复平台传播身份。传播时间线、共鸣和争议必须从公开视频链接入口取得规范链接/作品指纹后研究。
- 复刻只迁移结构、节拍和制作机制；人物身份、台词、作品标识与可识别 IP 必须原创。

## 入口与文档

- 主站：`app/ShotprintStudio.tsx`
- 视频分析：`app/api/analyze/route.ts`、`lib/analysis.ts`
- 链接综合：`app/api/link-analyze/route.ts`、`lib/link-analysis.ts`
- 异步后端：`worker/aliyun-backend/server.ts`
- 权威说明与运维：`docs/video-analysis.md`
- 新增路由、环境变量、持久状态或验证门槛时，同步 `README.md`、`docs/video-analysis.md` 与本文件中的硬边界。
