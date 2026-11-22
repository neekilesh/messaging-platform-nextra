export async function analyzeAudioBlobToWaveform(blob: Blob, numBars = 32): Promise<number[]> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return Array(numBars).fill(0.35);
    const audioCtx = new AudioCtx();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    const blockSize = Math.floor(channelData.length / numBars);
    const result: number[] = [];

    for (let i = 0; i < numBars; i++) {
      let sum = 0;
      const start = i * blockSize;
      const end = Math.min(channelData.length, start + blockSize);
      for (let j = start; j < end; j++) {
        sum += Math.abs(channelData[j]);
      }
      const avg = end > start ? sum / (end - start) : 0;
      const scaled = Math.min(1.0, Math.max(0.12, avg * 3.8));
      result.push(Number(scaled.toFixed(3)));
    }
    audioCtx.close().catch(() => {});
    return result;
  } catch {
    return Array(numBars).fill(0.35);
  }
}

export async function analyzeAudioUrlToWaveform(url: string, numBars = 32): Promise<number[]> {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await analyzeAudioBlobToWaveform(blob, numBars);
  } catch {
    return Array(numBars).fill(0.35);
  }
}
