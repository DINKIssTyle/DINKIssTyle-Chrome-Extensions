(() => {
  const VALID_PRESENTATIONS = new Set(['inline', 'modal']);

  /*
   * 교정 결과 표시 방식 설정
   *
   * 사용 가능한 값:
   * - 'inline': 편집기 위에서 변경 항목을 바로 검토
   * - 'modal': 현재 문장과 제안 문장을 모달에서 비교
   *
   * 기능 이름: spellcheck, honorific, improve, decorate, suggest_title
   * 브라우저/기기 이름:
   * - Chrome: desktop, tablet, mobile
   * - Safari: mac, ipad, iphone
   *
   * 적용 우선순위:
   * 1. overrides의 브라우저 + 기기 + 기능 설정
   * 2. defaults의 desktop/tablet/mobile + 기능 설정
   * 3. defaults의 desktop/tablet/mobile 기본값
   * 4. defaults.default (마지막 안전 기본값)
   *
   * 예시:
   * - Chrome 데스크톱의 문장 개선을 인라인으로 표시:
   *   overrides.chrome.desktop에 improve: 'inline' 추가
   * - 모든 태블릿의 맞춤법 검사를 인라인으로 표시:
   *   defaults.tablet에 spellcheck: 'inline' 추가
   *
   * 설정하지 않은 기능은 해당 기기 유형의 default 값을 따릅니다.
   */
  const REVIEW_PRESENTATION_POLICY = deepFreeze({
    defaults: {
      default: 'modal',
      desktop: { default: 'modal' },
      tablet: { default: 'modal' },
      mobile: { default: 'modal' }
    },
    overrides: {
      chrome: {
        desktop: { spellcheck: 'inline' },
        tablet: { spellcheck: 'modal' }
      },
      safari: {
        mac: { spellcheck: 'inline' },
        ipad: {},
        iphone: {}
      }
    }
  });

  function deepFreeze(value) {
    Object.values(value).forEach(child => {
      if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
    });
    return Object.freeze(value);
  }

  function detectRuntimeProfile(environment = globalThis) {
    const runtime = environment.chrome?.runtime ?? environment.browser?.runtime;
    const extensionBaseURL = runtime?.getURL?.('') || '';
    const browser = extensionBaseURL.startsWith('safari-web-extension:') ? 'safari' : 'chrome';
    const navigatorValue = environment.navigator ?? {};
    const userAgent = String(navigatorValue.userAgent || '');
    const platform = String(navigatorValue.platform || '');
    const maxTouchPoints = Number(navigatorValue.maxTouchPoints || 0);
    const isIPadOS = /iPad/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
    const isTablet = isIPadOS
      || /Tablet|PlayBook|Silk/i.test(userAgent)
      || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent));
    const isMobile = !isTablet && /iPhone|iPod|Mobile|Android/i.test(userAgent);
    const formFactor = isTablet ? 'tablet' : (isMobile ? 'mobile' : 'desktop');
    const target = browser === 'safari'
      ? ({ desktop: 'mac', tablet: 'ipad', mobile: 'iphone' })[formFactor]
      : formFactor;

    return Object.freeze({ browser, target, formFactor });
  }

  function resolveReviewPresentation(action, profile = detectRuntimeProfile(), policy = REVIEW_PRESENTATION_POLICY) {
    const actionId = typeof action === 'string' ? action : action?.id;
    const targetPolicy = policy.overrides?.[profile.browser]?.[profile.target];
    const formFactorPolicy = policy.defaults?.[profile.formFactor];
    const candidates = [
      targetPolicy?.[actionId],
      formFactorPolicy?.[actionId],
      formFactorPolicy?.default,
      policy.defaults?.default,
      'modal'
    ];
    return candidates.find(value => VALID_PRESENTATIONS.has(value)) || 'modal';
  }

  const api = Object.freeze({
    REVIEW_PRESENTATION_POLICY,
    detectRuntimeProfile,
    resolveReviewPresentation
  });

  globalThis.AIAngReviewPresentation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
