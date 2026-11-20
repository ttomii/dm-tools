// Connected ink regions let the browser test measure the actual ring and glyph, not style metadata.
export const blackComponents = (pixels, width, height) => {
  const seen = new Uint8Array(width * height);
  const result = [];
  const isInk = index => pixels[index * 4 + 3] > 127 && pixels[index * 4] < 128 && pixels[index * 4 + 1] < 128 && pixels[index * 4 + 2] < 128;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !isInk(start)) continue;
    const queue = [start]; seen[start] = 1;
    let left = width, top = height, right = -1, bottom = -1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor], x = index % width, y = Math.floor(index / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen[next] || !isInk(next)) continue;
        seen[next] = 1; queue.push(next);
      }
    }
    result.push({width: right-left+1, height: bottom-top+1, centerX: (left+right)/2, centerY: (top+bottom)/2});
  }
  return result;
};
