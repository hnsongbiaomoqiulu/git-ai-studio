/**
 * 宠物的图片渲染(ADR-011:形象主题 = 角色图皮肤 + 锁死的双色信息环)。
 *
 * 一帧的合成顺序:
 *   1. 角色姿态图(contain 居中,可叠脉冲缩放 / 提醒抖动)
 *   2. 整体染色(source-atop,只染角色非透明像素;打标失败=红 / daemon=灰 / hook=黄)
 *   3. 双色进度环(信息层,始终清晰不受染色影响):紫弧 = AI 占比、蓝弧 = 你的占比
 *
 * 「形象即数据」在图片形象上由第 3 步承载:角色可换皮,环的色 → 数据映射(INK_AI/INK_YOU)
 * 永远锁死(见 petState.ts)。
 */

import { INK_AI, INK_YOU } from "./petState";
import type { PetTheme, StateVisual } from "./petState";

export interface DrawPetOptions {
  /** 逻辑宽高(CSS px;caller 已按 devicePixelRatio scale 过 ctx)。 */
  width: number;
  height: number;
  /** 当前姿态图(预加载的 Image;未就绪时传 null,只画信息环)。 */
  image: HTMLImageElement | null;
  /** 当前状态的视觉表现(选图 / 染色 / 抖动 / 脉冲)。 */
  visual: StateVisual;
  /** 双色环位置(窗口归一化坐标)。 */
  gauge: PetTheme["gauge"];
  /** 当周 AI 占比 [0,100];null = 无数据。 */
  aiSharePercent: number | null;
  /** 动画时间戳(ms),驱动脉冲 / 抖动相位。 */
  timeMs: number;
  /** 提醒强度 [0,1]:窗口层按设置间隔脉冲此值,驱动抖动幅度与染色加深(0 = 不提醒)。 */
  attention: number;
}

/** 绘制一帧。 */
export function drawPet(ctx: CanvasRenderingContext2D, opts: DrawPetOptions): void {
  const { width, height, image, visual, gauge, aiSharePercent, timeMs, attention } = opts;
  ctx.clearRect(0, 0, width, height);

  if (image && image.complete && image.naturalWidth > 0) {
    drawCharacter(ctx, image, visual, width, height, timeMs, attention);
  }
  drawGauge(ctx, width, height, gauge, aiSharePercent);
}

/** 画角色图:contain 居中 + 脉冲缩放 + 提醒抖动 + 整体染色。 */
function drawCharacter(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  visual: StateVisual,
  width: number,
  height: number,
  timeMs: number,
  attention: number,
): void {
  // contain 布局:留边后等比缩放、居中
  const pad = Math.min(width, height) * 0.06;
  const scale = Math.min(
    (width - 2 * pad) / image.naturalWidth,
    (height - 2 * pad) / image.naturalHeight,
  );
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;
  const ccx = width / 2;
  const ccy = dy + dh / 2;

  ctx.save();
  // 脉冲(正在打标):整体轻微缩放
  const pulse = visual.pulse ? 1 + Math.sin(timeMs / 300) * 0.04 : 1;
  // 抖动(提醒):左右快速小幅位移,幅度随 attention 衰减
  const shakeX = visual.shake ? Math.sin(timeMs / 45) * 3 * attention : 0;
  ctx.translate(ccx + shakeX, ccy);
  ctx.scale(pulse, pulse);
  ctx.translate(-ccx, -ccy);

  ctx.drawImage(image, dx, dy, dw, dh);

  // 整体染色:source-atop 只作用于角色非透明像素
  if (visual.tint) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = visual.tint;
    ctx.fillRect(dx, dy, dw, dh);
    // urgent 提醒脉冲时再叠一层,染色随节拍变深(闪一下)
    if (visual.urgent && attention > 0) {
      ctx.globalAlpha = attention * 0.35;
      ctx.fillRect(dx, dy, dw, dh);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
}

/**
 * 双色进度环(信息层,锁死语义)。从 12 点起顺时针:紫弧 = AI 占比、蓝弧 = 剩余(你)。
 * 环下垫半透明底盘 + 中心 AI% 数字,保证在任何角色 / 染色上都清晰可读。
 */
function drawGauge(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  gauge: PetTheme["gauge"],
  aiSharePercent: number | null,
): void {
  const gx = width * gauge.cx;
  const gy = height * gauge.cy;
  const gr = Math.min(width, height) * gauge.r;
  const lw = gr * 0.34;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineCap = "round";

  // 底盘:半透明深色圆,衬托白字 + 彩弧
  ctx.beginPath();
  ctx.arc(gx, gy, gr + lw * 0.9, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(18,20,28,0.58)";
  ctx.fill();

  const start = -Math.PI / 2;
  if (aiSharePercent === null) {
    // 无数据:灰环 + 问号
    ctx.beginPath();
    ctx.arc(gx, gy, gr, 0, Math.PI * 2);
    ctx.lineWidth = lw;
    ctx.strokeStyle = "rgba(180,184,196,0.7)";
    ctx.stroke();
    ctx.fillStyle = "#E8EAF0";
    ctx.font = `600 ${gr * 0.85}px system-ui, sans-serif`;
    ctx.fillText("—", gx, gy);
  } else {
    const share = Math.max(0, Math.min(100, aiSharePercent)) / 100;
    const aiEnd = start + share * Math.PI * 2;
    ctx.lineWidth = lw;
    // 蓝弧(你)先铺剩余段
    ctx.beginPath();
    ctx.arc(gx, gy, gr, aiEnd, start + Math.PI * 2);
    ctx.strokeStyle = INK_YOU;
    ctx.stroke();
    // 紫弧(AI)叠 share 段
    if (share > 0) {
      ctx.beginPath();
      ctx.arc(gx, gy, gr, start, aiEnd);
      ctx.strokeStyle = INK_AI;
      ctx.stroke();
    }
    // 中心数字
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `700 ${gr * 0.72}px system-ui, sans-serif`;
    ctx.fillText(String(Math.round(aiSharePercent)), gx, gy - gr * 0.12);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = `600 ${gr * 0.42}px system-ui, sans-serif`;
    ctx.fillText("AI%", gx, gy + gr * 0.55);
  }
  ctx.restore();
}
