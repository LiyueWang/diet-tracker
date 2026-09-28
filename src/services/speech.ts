// 语音识别封装。
// 纯 TypeScript 模块：不碰 React、不碰 UI、不碰数据库，只负责把 Web Speech API
// 包成"一个按钮能用的东西"。识别结果由调用方决定怎么用。

export type SpeechError =
  | 'not-supported' // 浏览器不支持
  | 'permission-denied' // 用户拒绝麦克风权限
  | 'no-speech' // 没听到声音
  | 'network' // 网络异常（Chrome 的识别走云服务）
  | 'aborted' // 主动中止或超时
  | 'unknown';

/**
 * Web Speech API 的类型声明不在 TS 标准 DOM lib 里（它是 WICG 草案，且 Chrome 只暴露
 * 带 webkit 前缀的版本）。这里只声明实际用到的那几个成员，并配合 unknown 收窄，
 * 避免为了类型去引第三方 @types 包。
 */
interface SpeechAlternativeLike {
  transcript: string;
}

interface SpeechResultLike {
  readonly length: number;
  readonly [index: number]: SpeechAlternativeLike | undefined;
}

interface SpeechResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechResultLike | undefined;
}

interface SpeechResultEventLike extends Event {
  readonly results: SpeechResultListLike;
}

interface SpeechErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechWindow {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export interface StartRecognitionOptions {
  /** 默认 zh-CN */
  lang?: string;
  onResult: (text: string) => void;
  onError: (error: SpeechError) => void;
  /** 识别结束（无论成功失败）都会调一次 */
  onEnd?: () => void;
}

/** 同步检测，不触发任何权限询问 */
export function isSpeechSupported(): boolean {
  return getRecognitionConstructor() !== undefined;
}

function getRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const speechWindow = window as unknown as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function mapErrorCode(code: string): SpeechError {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission-denied';
    case 'no-speech':
      return 'no-speech';
    case 'network':
      return 'network';
    case 'aborted':
      return 'aborted';
    default:
      return 'unknown';
  }
}

export function getErrorMessage(error: SpeechError): string {
  switch (error) {
    case 'not-supported':
      return '当前浏览器不支持语音输入，请使用 Chrome 或 Edge';
    case 'permission-denied':
      return '麦克风权限被拒绝，请在浏览器设置中开启后重试';
    case 'no-speech':
      return '没听清，请再试一次';
    case 'network':
      return '语音识别服务网络异常，请检查网络后重试';
    case 'aborted':
      return '语音输入已取消';
    default:
      return '语音识别失败，请重试';
  }
}

/**
 * 开始一次识别，返回可用于主动中止的句柄。
 * 不支持的环境下不抛错，而是走 onError('not-supported') + onEnd，让调用方的状态机只有一条路径。
 */
export function startRecognition(options: StartRecognitionOptions): { stop: () => void } {
  const Recognition = getRecognitionConstructor();
  if (!Recognition) {
    options.onError('not-supported');
    options.onEnd?.();
    return { stop: () => undefined };
  }

  const recognition = new Recognition();
  recognition.lang = options.lang ?? 'zh-CN';
  // 只要最终结果：interim 结果会在说话过程中反复回调，写进输入框会变成一串抖动
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  /** onend 可能重复触发（也兼容我们自己的兜底），所以只回调一次 */
  let finished = false;
  /**
   * 是不是调用方自己点的 stop。
   * 用户主动取消**不是错误**，不该走 onError（那条通道是留给"用户需要知道、
   * 可能需要采取行动"的情况，比如权限被拒、网络异常）；它只该安静地结束。
   * 这个判断属于语音层，不该泄漏给 Record 页去维护额外标志位。
   */
  let userStopped = false;
  const finish = (): void => {
    if (finished) {
      return;
    }
    finished = true;
    // 每次识别都是新实例，这里清掉只为语义完整（不会延用到下一次）
    userStopped = false;
    options.onEnd?.();
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0]?.[0]?.transcript ?? '';
    const text = transcript.trim();
    if (text !== '') {
      options.onResult(text);
    }
  };

  recognition.onerror = (event) => {
    if (event.error === 'aborted' && userStopped) {
      // 主动取消：不报错，顺手收尾（紧随其后的 onend 会被幂等挡掉）
      finish();
      return;
    }
    options.onError(mapErrorCode(event.error));
  };
  recognition.onend = () => {
    finish();
  };

  try {
    recognition.start();
  } catch (cause) {
    // 上一个实例还没结束时 start() 会抛 InvalidStateError；这里统一按未知错误上报
    console.warn('[speech] 启动识别失败:', cause);
    options.onError('unknown');
    finish();
    return { stop: () => undefined };
  }

  return {
    stop: () => {
      if (finished) {
        return;
      }
      userStopped = true;
      try {
        // stop() 会让浏览器触发 onend，由 finish() 统一收尾
        recognition.stop();
      } catch (cause) {
        // 个别实现重复 stop 或对未启动的实例 stop 会抛错，此时不会再有 onend，手动收尾
        console.warn('[speech] 中止识别失败，按已结束处理:', cause);
        finish();
      }
    },
  };
}
