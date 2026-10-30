/** 返回受管理校准内容；角点坐标为逻辑画布 CSS 像素。 */
export function calibrationMarkup(): string {
  return `<header><p class="eyebrow">DISPLAY LAB / 校准页</p><h1>让画面与点击对齐</h1><p>中文：天地玄黄，虚拟桌面。 English: Clear type, precise input.</p></header>
  <div class="patterns"><div class="circle"></div><div class="grid"></div><div><h2>形状检查</h2><p>圆形应为正圆，方格应为正方形。</p><p>请结合实体屏影像验证。</p></div></div>
  <p id="hit-status" aria-live="polite">四角命中：0 / 4</p>
  <button class="target tl" data-corner="tl">左上</button><button class="target tr" data-corner="tr">右上</button><button class="target bl" data-corner="bl">左下</button><button class="target br" data-corner="br">右下</button>`;
}
