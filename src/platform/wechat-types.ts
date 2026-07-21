export interface WechatTouch {
  readonly clientX: number;
  readonly clientY: number;
}

export interface WechatTouchEvent {
  readonly touches: readonly WechatTouch[];
}

export interface WechatCanvas {
  width: number;
  height: number;
  getContext(kind: "webgl2"): WebGL2RenderingContext | null;
}

export interface WechatSystemInfo {
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly pixelRatio: number;
}

export interface WechatApi {
  createCanvas(): WechatCanvas;
  getSystemInfoSync(): WechatSystemInfo;
  onTouchStart(handler: (event: WechatTouchEvent) => void): void;
}
