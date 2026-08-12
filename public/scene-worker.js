/* Browser-only scene detector. It receives 16x9 luma samples and returns cuts. */
self.onmessage = (event) => {
  const { frames, durationMs } = event.data;
  if (!Array.isArray(frames) || frames.length < 2) {
    self.postMessage({ cuts: [0, durationMs], scores: [] });
    return;
  }

  const scores = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1].luma;
    const current = frames[index].luma;
    let delta = 0;
    for (let pixel = 0; pixel < current.length; pixel += 1) {
      delta += Math.abs(current[pixel] - previous[pixel]);
    }
    scores.push({ timeMs: frames[index].timeMs, score: delta / current.length / 255 });
  }

  const sorted = scores.map((item) => item.score).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const threshold = Math.max(0.19, median * 3.1);
  const cuts = [0];
  for (const item of scores) {
    if (item.score >= threshold && item.timeMs - cuts[cuts.length - 1] >= 650) cuts.push(item.timeMs);
  }
  if (durationMs - cuts[cuts.length - 1] < 650 && cuts.length > 1) cuts.pop();
  cuts.push(durationMs);
  self.postMessage({ cuts, scores, threshold });
};
