"use client";

import { useState } from "react";
import { linkAnalysisToCsv, linkAnalysisToMarkdown, type LinkAnalysis } from "../lib/link-analysis";

type LinkTab = "audience" | "viral" | "director" | "production" | "playbook" | "evidence";

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyText(body: string) {
  await navigator.clipboard?.writeText(body);
}

const tabs: Array<{ id: LinkTab; label: string }> = [
  { id: "audience", label: "观众怎么说" }, { id: "viral", label: "为什么爆" }, { id: "director", label: "导演拆解" },
  { id: "production", label: "制作拆解" }, { id: "playbook", label: "复刻作战书" }, { id: "evidence", label: "证据与边界" },
];

function platformLabel(platform: LinkAnalysis["source"]["platform"]) {
  return platform === "douyin" ? "抖音" : platform === "bilibili" ? "B站" : platform === "xiaohongshu" ? "小红书" : "未知平台";
}

export default function LinkAnalysisDesk({ report, fixture = false }: { report: LinkAnalysis; fixture?: boolean }) {
  const [tab, setTab] = useState<LinkTab>("audience");
  const [direction, setDirection] = useState(report.playbook.recommendedDirection);
  const blocked = report.videoStatus === "blocked" || report.analysisStatus === "audience_only";
  return <section className="link-desk" id="link-result">
    <div className="link-desk-head">
      <div>
        <p className="eyebrow">LINK FORENSICS / 链接取证</p>
        <div className="link-title-row"><span className="platform-stamp">{platformLabel(report.source.platform)}</span><h2>{report.source.title}</h2></div>
        <p className="link-source-line">{report.source.author} · {report.source.canonicalUrl}</p>
      </div>
      <div className="link-actions"><button onClick={() => download("shotprint-link-analysis.md", linkAnalysisToMarkdown(report), "text/markdown")}>导出完整作战书</button><button onClick={() => download("shotprint-link-comments.csv", linkAnalysisToCsv(report), "text/csv")}>逐镜/评论 CSV</button><button onClick={() => void copyText(JSON.stringify(report.playbook, null, 2))}>复制 AI 生成包</button></div>
    </div>

    <div className="search-receipt" role="status"><span className="mono">SEARCH RECEIPT</span><b>{report.searchReceipt.status === "complete" ? `百炼联网已取得 ${report.searchReceipt.sourceCount} 个来源` : report.searchReceipt.status === "partial" ? `联网来源不足：${report.searchReceipt.sourceCount} 个` : "联网搜索不可用"}</b><small>{report.searchReceipt.provider} · 检索于 {report.searchReceipt.retrievedAt.slice(0, 10)}{report.searchReceipt.errorCode ? ` · ${report.searchReceipt.errorCode}` : ""}</small></div>
    {report.researchReceipt && <div className="research-receipt" role="status"><span><b>{report.researchReceipt.queryCount}</b>组深度查询</span><span><b>{report.researchReceipt.sourceCount}</b>个来源</span><span><b>{report.researchReceipt.domainCount}</b>个域名</span><span><b>¥{report.researchReceipt.costCny.toFixed(3)}</b>本次费用</span></div>}
    <div className="link-overview-grid">
      <article className="source-card"><span className="mono">SOURCE PROFILE</span><strong>{platformLabel(report.source.platform)} · {report.source.author}</strong><small>{report.source.publishedAt ? `发布于 ${report.source.publishedAt.slice(0, 10)}` : "发布时间待确认"}</small><div className="metric-row"><span><b>{report.collection.sampleCount}</b>条评论</span><span><b>{report.evidence.sourceCount}</b>个来源</span><span><b>{report.evidence.coveragePercent}%</b>证据覆盖</span></div></article>
      <article className="viral-summary"><span className="mono">WORKING HYPOTHESIS</span><h3>{report.viralFactors[0]?.title}</h3><p>{report.viralFactors[0]?.summary}</p><div className="confidence-line"><i style={{ width: `${(report.viralFactors[0]?.confidence ?? 0) * 100}%` }} /><span>{Math.round((report.viralFactors[0]?.confidence ?? 0) * 100)}% 置信度</span></div></article>
      <article className="collection-receipt"><span className="mono">COLLECTION RECEIPT</span><b className={`receipt-dot ${report.collection.status}`}>{report.collection.status === "complete" ? "● 已完成" : report.collection.status === "partial" ? "◐ 部分完成" : "○ 样本不足"}</b><p>{report.collection.sampleCount ? `保留 ${report.collection.sampleCount} 条去标识化评论，未保存账号身份字段。` : "没有评论样本，舆情结论仅作结构假设。"}</p><small>{fixture ? "内置演示 fixture · 不代表实时采集" : report.provenance.collector}</small></article>
    </div>

    {blocked && <div className="link-error" role="status"><b>已完成观众层，等待视频证据</b><span>当前只有链接页和去标识化评论。请切换到“上传本地视频”，完成视听分析后，导演拆解、制作拆解、时间码和复刻作战书才会解锁。</span></div>}
    <div className="dual-rail" aria-label="观众反应和视频镜头的证据双轨"><div className="rail-label"><span>观众反应轨</span><i>评论主题 / 情绪</i></div><div className="rail-track audience-rail">{report.audience.emotions.map((item) => <span key={item.label} style={{ flexGrow: item.share }}><b>{item.label}</b><small>{Math.round(item.share * 100)}%</small></span>)}</div><div className="rail-label"><span>视频镜头轨</span><i>节拍 / 时间码</i></div><div className="rail-track shot-rail">{report.director.beats.length ? report.director.beats.map((item) => <span key={item.label} style={{ flexGrow: item.endMs - item.startMs }}><b>{item.label}</b><small>{(item.startMs / 1000).toFixed(1)}s</small></span>) : <span className="rail-empty"><b>未取得视频</b><small>无时间码</small></span>}</div><div className="rail-connectors">{report.director.beats.map((item) => <em key={item.label} title={`${item.label}：${item.intention}`} />)}</div></div>

    <nav className="link-tabs" role="tablist" aria-label="链接分析章节">{tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
    <div className="link-panel">
      {tab === "audience" && <AudiencePanel report={report} />}
      {tab === "viral" && <ViralPanel report={report} />}
      {tab === "director" && <DirectorPanel report={report} />}
      {tab === "production" && <ProductionPanel report={report} />}
      {tab === "playbook" && <PlaybookPanel report={report} direction={direction} setDirection={setDirection} />}
      {tab === "evidence" && <EvidencePanel report={report} />}
    </div>
  </section>;
}

function AudiencePanel({ report }: { report: LinkAnalysis }) {
  return <div className="link-audience-grid"><div><div className="emotion-bars">{report.audience.emotions.map((item) => <div key={item.label}><span><b>{item.label}</b><small>{item.evidenceCount}条证据</small></span><i style={{ width: `${item.share * 100}%` }} /><strong>{Math.round(item.share * 100)}%</strong></div>)}</div><h3 className="subhead">观众真正想要什么</h3><ul className="plain-list">{report.audience.audienceNeeds.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="theme-stack">{report.audience.themes.map((theme) => <article key={theme.label}><div><span>{theme.label}</span><b>{theme.sampleCount}条</b></div><p>{theme.summary}</p><blockquote>“{theme.sampleQuotes[0]}”</blockquote><small>{Math.round(theme.confidence * 100)}% 置信度</small></article>)}</div></div>;
}

function ViralPanel({ report }: { report: LinkAnalysis }) {
  const contextGroups = report.socialContext ? [["传播时间线", report.socialContext.timeline], ["观众共识", report.socialContext.audienceConsensus], ["争议与批评", report.socialContext.controversies], ["平台与社会外因", report.socialContext.externalFactors]] as const : [];
  const sourceById = new Map(report.sources.map((source) => [source.id, source]));
  return <><div className="viral-research-proof"><div><span className="mono">CONNECTED EVIDENCE / 联网核验</span><b>{report.researchReceipt ? `${report.researchReceipt.queryCount} 组检索 · ${report.researchReceipt.sourceCount} 个来源 · ${report.researchReceipt.domainCount} 个域名` : `${report.searchReceipt.sourceCount} 个联网来源`}</b></div><p>以下结论由匿名评论、公开网页与真实视频时间码交叉生成；点击来源可直接核验。无法公开确认的投流和推荐权重保留为未知。</p></div><div className="claim-grid">{report.viralFactors.map((item, index) => <article className="claim-card" key={item.title}><div className="claim-number">0{index + 1}</div><div><span className="claim-confidence">{Math.round(item.confidence * 100)}%</span><h3>{item.title}</h3><p>{item.summary}</p><b>证据</b><div className="claim-evidence-links">{(item.sourceIds || []).map((id) => { const source = sourceById.get(id); return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer">{id} · {source.title}</a> : null; })}{(item.commentIds || []).length > 0 && <span>{item.commentIds!.length} 条匿名评论</span>}{(item.timecodes || []).map((timecode) => <span key={timecode}>视频 {timecode}</span>)}{!(item.sourceIds || []).length && !(item.commentIds || []).length && <span>公开证据不足</span>}</div><b className="counter">反证与未知</b><small>{item.counterEvidence.join(" · ") || "暂无可用反证"}</small></div></article>)}</div>{contextGroups.length > 0 && <div className="social-context-grid">{contextGroups.map(([label, claims]) => <section key={label}><h3>{label}</h3>{claims.map((claim) => <article key={`${label}-${claim.title}`}><b>{claim.title}</b><p>{claim.summary}</p><div className="context-evidence">{claim.sourceIds.map((id) => { const source = sourceById.get(id); return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer">{id}</a> : null; })}<small>{claim.evidenceType} · {claim.commentIds.length}条评论 · {Math.round(claim.confidence * 100)}%</small></div></article>)}</section>)}{report.socialContext?.unknowns.length ? <section><h3>未知项</h3>{report.socialContext.unknowns.map((item) => <p className="boundary-note" key={item}>△ {item}</p>)}</section> : null}</div>}</>;
}

function DirectorPanel({ report }: { report: LinkAnalysis }) {
  return <div className="director-panel"><div className="director-thesis"><span className="mono">DIRECTOR&apos;S THESIS</span><h3>{report.director.thesis}</h3><p>{report.director.audience}</p></div><div className="beat-table">{report.director.beats.map((beat) => <article key={beat.label}><span>{(beat.startMs / 1000).toFixed(1)}–{(beat.endMs / 1000).toFixed(1)}s</span><div><b>{beat.label}</b><p>{beat.intention}</p><small>{beat.evidence} · {Math.round(beat.confidence * 100)}%</small></div></article>)}</div><div className="strength-grid"><div><h4>有效选择</h4>{report.director.strengths.map((item) => <p key={item}>＋ {item}</p>)}</div><div><h4>可改进</h4>{report.director.improvements.map((item) => <p key={item}>△ {item}</p>)}</div></div></div>;
}

function ProductionPanel({ report }: { report: LinkAnalysis }) {
  const groups: Array<[string, string[]]> = [["摄影", report.production.cinematography], ["美术与灯光", report.production.artAndLight], ["剪辑", report.production.editing], ["声音", report.production.sound], ["AI工作流", report.production.aiWorkflow]];
  return <div className="production-report"><div className="production-groups">{groups.map(([title, items]) => <article key={title}><span className="mono">{title}</span>{items.map((item) => <p key={item}>• {item}</p>)}</article>)}</div><h3 className="subhead">制作难度与替代方案</h3><div className="difficulty-grid">{report.production.difficulty.map((item) => <article key={item.label}><div><b>{item.label}</b><span className={`difficulty-${item.level}`}>{item.level}难度</span></div><p>{item.reason}</p><small>替代：{item.fallback}</small></article>)}</div></div>;
}

function PlaybookPanel({ report, direction, setDirection }: { report: LinkAnalysis; direction: string; setDirection: (value: string) => void }) {
  return <div className="playbook-panel"><div className="direction-row">{report.playbook.directions.map((item) => <button key={item.title} className={direction === item.title ? "active" : ""} onClick={() => setDirection(item.title)}><span>{item.title}</span><small>{item.premise}</small></button>)}</div><div className="playbook-brief"><span className="mono">RECOMMENDED BLUEPRINT / {direction}</span><h3>{report.playbook.brief.logline}</h3><p>{report.playbook.brief.audience} · {report.playbook.brief.aspectRatio} · {(report.playbook.brief.durationMs / 1000).toFixed(1)}秒</p></div><div className="beat-sheet">{report.playbook.beats.map((beat) => <article key={beat.label}><span>{(beat.startMs / 1000).toFixed(1)}–{(beat.endMs / 1000).toFixed(1)}s</span><b>{beat.label}</b><p>{beat.story}</p><small>{beat.emotion}</small></article>)}</div><div className="playbook-shots">{report.playbook.shots.map((shot) => <details key={shot.index}><summary><span>SHOT {String(shot.index).padStart(2, "0")}</span><b>{shot.startMs / 1000}–{shot.endMs / 1000}s · {shot.narrative}</b><i>{shot.difficulty}</i></summary><div><p>{shot.visual} · {shot.action}</p><p>{shot.shot} / {shot.camera} · {shot.light}</p><p>声音：{shot.audio}</p><small>失败替代：{shot.fallback}</small></div></details>)}</div><div className="playbook-foot playbook-foot-triple"><div><b>视觉圣经 / 提示词骨架</b>{[...report.playbook.visualBible, ...report.playbook.promptSkeletons].map((item) => <span key={item}>{item}</span>)}</div><div><b>剪辑与声音</b>{report.playbook.editAndSound.map((item) => <span key={item}>{item}</span>)}</div><div><b>预算与验证</b>{report.playbook.budgetOptions.map((item) => <span key={item.label}>{item.label} · {item.people} · {item.hours} · {item.cost}</span>)}{report.playbook.experiments.map((item) => <span key={item}>实验：{item}</span>)}{report.playbook.risks.map((item) => <span key={item}>风险替换：{item}</span>)}</div></div></div>;
}

function EvidencePanel({ report }: { report: LinkAnalysis }) {
  return <div className="evidence-panel"><div className="evidence-summary"><span className="evidence-score">{report.evidence.coveragePercent}%</span><div><h3>证据覆盖率</h3><p>{report.evidence.notes.join("；")}</p></div></div><div className="evidence-columns"><div><h4>网页来源</h4>{report.sources.length ? report.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><b>{source.id ? `${source.id} · ` : ""}{source.title}</b><p>{source.snippet || "无可核验摘要"}</p><small>{source.publishedAt || "日期未提供"} · {source.queryIds?.join(" / ") || "未标查询类别"} · 检索于 {source.retrievedAt.slice(0, 10)}</small></a>) : <p className="muted">未配置联网搜索服务。</p>}</div><div><h4>判断边界</h4>{report.warnings.map((warning) => <p className="boundary-note" key={warning}>△ {warning}</p>)}<h4>采集回执</h4><p className="muted">{report.collection.sampleCount}/{report.collection.targetCount || report.collection.sampleCount} 条评论 · {report.collection.scrollActions || 0}次滚动 · {report.collection.stopReason || "unknown"} · {report.provenance.collector}</p><h4>视听证据</h4><p className="muted">{report.videoEvidence ? `${report.videoEvidence.acquisition} · 画面 ${report.videoEvidence.visualStatus} · ${report.videoEvidence.shotCount}个镜头 · 音频 ${report.videoEvidence.audioStatus === "detected" ? "已检测" : report.videoEvidence.audioStatus === "missing" ? "缺失" : "未知"}` : "尚未提供视频"}</p></div></div></div>;
}
