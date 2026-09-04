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
  { id: "audience", label: "观众反馈" }, { id: "viral", label: "走红原因" }, { id: "director", label: "镜头拆解" },
  { id: "production", label: "怎么制作" }, { id: "playbook", label: "创作方案" }, { id: "evidence", label: "依据和限制" },
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
        <div className="link-title-row"><span className="platform-stamp">{platformLabel(report.source.platform)}</span><h2>{report.source.title}</h2></div>
        <p className="link-source-line">{report.source.author} · {report.source.canonicalUrl}</p>
      </div>
      <div className="link-actions"><button onClick={() => download("shotprint-link-analysis.md", linkAnalysisToMarkdown(report), "text/markdown")}>下载分析文档</button><button onClick={() => download("shotprint-link-comments.csv", linkAnalysisToCsv(report), "text/csv")}>下载评论表格</button><button onClick={() => void copyText(JSON.stringify(report.playbook, null, 2))}>复制创作方案</button></div>
    </div>

    <div className="search-receipt" role="status"><span className="mono">公开资料</span><b>{report.searchReceipt.status === "complete" ? `找到 ${report.searchReceipt.sourceCount} 个来源` : report.searchReceipt.status === "partial" ? `只找到 ${report.searchReceipt.sourceCount} 个来源` : "没有查到公开资料"}</b><small>{report.searchReceipt.retrievedAt.slice(0, 10)}{report.searchReceipt.errorCode ? ` · ${report.searchReceipt.errorCode}` : ""}</small></div>
    {report.researchReceipt && <div className="research-receipt" role="status"><span><b>{report.researchReceipt.queryCount}</b>项搜索</span><span><b>{report.researchReceipt.sourceCount}</b>个来源</span><span><b>{report.researchReceipt.domainCount}</b>个网站</span><span><b>¥{report.researchReceipt.costCny.toFixed(3)}</b>费用</span></div>}
    <div className="link-overview-grid">
      <article className="source-card"><span className="mono">视频信息</span><strong>{platformLabel(report.source.platform)} · {report.source.author}</strong><small>{report.source.publishedAt ? `发布于 ${report.source.publishedAt.slice(0, 10)}` : "发布时间未知"}</small><div className="metric-row"><span><b>{report.collection.sampleCount}</b>条评论</span><span><b>{report.evidence.sourceCount}</b>个来源</span><span><b>{report.evidence.coveragePercent}%</b>依据充分度</span></div></article>
      <article className="viral-summary"><span className="mono">最可能的原因</span><h3>{report.viralFactors[0]?.title}</h3><p>{report.viralFactors[0]?.summary}</p><div className="confidence-line"><i style={{ width: `${(report.viralFactors[0]?.confidence ?? 0) * 100}%` }} /><span>把握 {Math.round((report.viralFactors[0]?.confidence ?? 0) * 100)}%</span></div></article>
      <article className="collection-receipt"><span className="mono">评论样本</span><b className={`receipt-dot ${report.collection.status}`}>{report.collection.status === "complete" ? "● 数量足够" : report.collection.status === "partial" ? "◐ 数量较少" : "○ 没有评论"}</b><p>{report.collection.sampleCount ? `读取了 ${report.collection.sampleCount} 条评论，没有保存用户名等身份信息。` : "没有评论，暂时不能判断观众反馈。"}</p><small>{fixture ? "示例数据，不是实时结果" : report.provenance.collector}</small></article>
    </div>

    {blocked && <div className="link-error" role="status"><b>还需要上传视频</b><span>目前只能看到评论反馈。上传原片后，才能拆镜头、标时间点并生成创作方案。</span></div>}
    <div className="dual-rail" aria-label="评论主题和视频节奏"><div className="rail-label"><span>评论主题</span><i>大家在说什么</i></div><div className="rail-track audience-rail">{report.audience.emotions.map((item) => <span key={item.label} style={{ flexGrow: item.share }}><b>{item.label}</b><small>{Math.round(item.share * 100)}%</small></span>)}</div><div className="rail-label"><span>视频节奏</span><i>每一段做什么</i></div><div className="rail-track shot-rail">{report.director.beats.length ? report.director.beats.map((item) => <span key={item.label} style={{ flexGrow: item.endMs - item.startMs }}><b>{item.label}</b><small>{(item.startMs / 1000).toFixed(1)}s</small></span>) : <span className="rail-empty"><b>还没有视频</b><small>暂无时间点</small></span>}</div><div className="rail-connectors">{report.director.beats.map((item) => <em key={item.label} title={`${item.label}：${item.intention}`} />)}</div></div>

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
  return <div className="link-audience-grid"><div><div className="emotion-bars">{report.audience.emotions.map((item) => <div key={item.label}><span><b>{item.label}</b><small>{item.evidenceCount}条评论</small></span><i style={{ width: `${item.share * 100}%` }} /><strong>{Math.round(item.share * 100)}%</strong></div>)}</div><h3 className="subhead">观众最在意什么</h3><ul className="plain-list">{report.audience.audienceNeeds.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="theme-stack">{report.audience.themes.map((theme) => <article key={theme.label}><div><span>{theme.label}</span><b>{theme.sampleCount}条</b></div><p>{theme.summary}</p><blockquote>“{theme.sampleQuotes[0]}”</blockquote><small>把握 {Math.round(theme.confidence * 100)}%</small></article>)}</div></div>;
}

function ViralPanel({ report }: { report: LinkAnalysis }) {
  const contextGroups = report.socialContext ? [["传播时间线", report.socialContext.timeline], ["观众共识", report.socialContext.audienceConsensus], ["争议与批评", report.socialContext.controversies], ["平台与社会外因", report.socialContext.externalFactors]] as const : [];
  const sourceById = new Map(report.sources.map((source) => [source.id, source]));
  return <><div className="viral-research-proof"><div><span className="mono">判断依据</span><b>{report.researchReceipt ? `${report.researchReceipt.sourceCount} 个来源 · ${report.researchReceipt.domainCount} 个网站` : `${report.searchReceipt.sourceCount} 个公开来源`}</b></div><p>这些判断来自评论、公开资料和视频时间点。账号投流、平台推荐等看不到的数据不会被当成事实。</p></div><div className="claim-grid">{report.viralFactors.map((item, index) => <article className="claim-card" key={item.title}><div className="claim-number">0{index + 1}</div><div><span className="claim-confidence">把握 {Math.round(item.confidence * 100)}%</span><h3>{item.title}</h3><p>{item.summary}</p><b>依据</b><div className="claim-evidence-links">{(item.sourceIds || []).map((id) => { const source = sourceById.get(id); return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer">{id} · {source.title}</a> : null; })}{(item.commentIds || []).length > 0 && <span>{item.commentIds!.length} 条评论</span>}{(item.timecodes || []).map((timecode) => <span key={timecode}>视频 {timecode}</span>)}{!(item.sourceIds || []).length && !(item.commentIds || []).length && <span>依据不足</span>}</div><b className="counter">还不能确认</b><small>{item.counterEvidence.join(" · ") || "暂时没有更多信息"}</small></div></article>)}</div>{contextGroups.length > 0 && <div className="social-context-grid">{contextGroups.map(([label, claims]) => <section key={label}><h3>{label}</h3>{claims.map((claim) => <article key={`${label}-${claim.title}`}><b>{claim.title}</b><p>{claim.summary}</p><div className="context-evidence">{claim.sourceIds.map((id) => { const source = sourceById.get(id); return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer">{id}</a> : null; })}<small>{claim.commentIds.length}条评论 · 把握 {Math.round(claim.confidence * 100)}%</small></div></article>)}</section>)}{report.socialContext?.unknowns.length ? <section><h3>还不知道</h3>{report.socialContext.unknowns.map((item) => <p className="boundary-note" key={item}>△ {item}</p>)}</section> : null}</div>}</>;
}

function DirectorPanel({ report }: { report: LinkAnalysis }) {
  return <div className="director-panel"><div className="director-thesis"><span className="mono">这条视频怎么讲</span><h3>{report.director.thesis}</h3><p>{report.director.audience}</p></div><div className="beat-table">{report.director.beats.map((beat) => <article key={beat.label}><span>{(beat.startMs / 1000).toFixed(1)}–{(beat.endMs / 1000).toFixed(1)}s</span><div><b>{beat.label}</b><p>{beat.intention}</p><small>{beat.evidence} · 把握 {Math.round(beat.confidence * 100)}%</small></div></article>)}</div><div className="strength-grid"><div><h4>值得借鉴</h4>{report.director.strengths.map((item) => <p key={item}>＋ {item}</p>)}</div><div><h4>可以调整</h4>{report.director.improvements.map((item) => <p key={item}>△ {item}</p>)}</div></div></div>;
}

function ProductionPanel({ report }: { report: LinkAnalysis }) {
  const groups: Array<[string, string[]]> = [["摄影", report.production.cinematography], ["画面和灯光", report.production.artAndLight], ["剪辑", report.production.editing], ["声音", report.production.sound], ["可能的制作方式", report.production.aiWorkflow]];
  return <div className="production-report"><div className="production-groups">{groups.map(([title, items]) => <article key={title}><span className="mono">{title}</span>{items.map((item) => <p key={item}>• {item}</p>)}</article>)}</div><h3 className="subhead">制作难度和简化做法</h3><div className="difficulty-grid">{report.production.difficulty.map((item) => <article key={item.label}><div><b>{item.label}</b><span className={`difficulty-${item.level}`}>{item.level}难度</span></div><p>{item.reason}</p><small>简单做法：{item.fallback}</small></article>)}</div></div>;
}

function PlaybookPanel({ report, direction, setDirection }: { report: LinkAnalysis; direction: string; setDirection: (value: string) => void }) {
  return <div className="playbook-panel"><div className="direction-row">{report.playbook.directions.map((item) => <button key={item.title} className={direction === item.title ? "active" : ""} onClick={() => setDirection(item.title)}><span>{item.title}</span><small>{item.premise}</small></button>)}</div><div className="playbook-brief"><span className="mono">当前方向：{direction}</span><h3>{report.playbook.brief.logline}</h3><p>{report.playbook.brief.audience} · {report.playbook.brief.aspectRatio} · {(report.playbook.brief.durationMs / 1000).toFixed(1)}秒</p></div><div className="beat-sheet">{report.playbook.beats.map((beat) => <article key={beat.label}><span>{(beat.startMs / 1000).toFixed(1)}–{(beat.endMs / 1000).toFixed(1)}s</span><b>{beat.label}</b><p>{beat.story}</p><small>{beat.emotion}</small></article>)}</div><div className="playbook-shots">{report.playbook.shots.map((shot) => <details key={shot.index}><summary><span>镜头 {String(shot.index).padStart(2, "0")}</span><b>{shot.startMs / 1000}–{shot.endMs / 1000}s · {shot.narrative}</b><i>{shot.difficulty}</i></summary><div><p>{shot.visual} · {shot.action}</p><p>{shot.shot} / {shot.camera} · {shot.light}</p><p>声音：{shot.audio}</p><small>拍不了时：{shot.fallback}</small></div></details>)}</div><div className="playbook-foot playbook-foot-triple"><div><b>画面规则和提示词</b>{[...report.playbook.visualBible, ...report.playbook.promptSkeletons].map((item) => <span key={item}>{item}</span>)}</div><div><b>剪辑与声音</b>{report.playbook.editAndSound.map((item) => <span key={item}>{item}</span>)}</div><div><b>预算和测试</b>{report.playbook.budgetOptions.map((item) => <span key={item.label}>{item.label} · {item.people} · {item.hours} · {item.cost}</span>)}{report.playbook.experiments.map((item) => <span key={item}>测试：{item}</span>)}{report.playbook.risks.map((item) => <span key={item}>避开：{item}</span>)}</div></div></div>;
}

function EvidencePanel({ report }: { report: LinkAnalysis }) {
  return <div className="evidence-panel"><div className="evidence-summary"><span className="evidence-score">{report.evidence.coveragePercent}%</span><div><h3>依据充分度</h3><p>{report.evidence.notes.join("；")}</p></div></div><div className="evidence-columns"><div><h4>公开资料</h4>{report.sources.length ? report.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><b>{source.id ? `${source.id} · ` : ""}{source.title}</b><p>{source.snippet || "没有摘要"}</p><small>{source.publishedAt || "日期未知"} · {source.queryIds?.join(" / ") || "类别未记录"} · 查询于 {source.retrievedAt.slice(0, 10)}</small></a>) : <p className="muted">没有查到公开资料。</p>}</div><div><h4>还不能确定</h4>{report.warnings.map((warning) => <p className="boundary-note" key={warning}>△ {warning}</p>)}<h4>评论读取记录</h4><p className="muted">{report.collection.sampleCount}/{report.collection.targetCount || report.collection.sampleCount} 条评论 · 滚动 {report.collection.scrollActions || 0} 次 · {report.collection.stopReason || "未记录"}</p><h4>视频情况</h4><p className="muted">{report.videoEvidence ? `画面：${report.videoEvidence.visualStatus} · ${report.videoEvidence.shotCount} 个镜头 · 音频：${report.videoEvidence.audioStatus === "detected" ? "已检测" : report.videoEvidence.audioStatus === "missing" ? "缺失" : "未知"}` : "还没有上传视频"}</p></div></div></div>;
}
