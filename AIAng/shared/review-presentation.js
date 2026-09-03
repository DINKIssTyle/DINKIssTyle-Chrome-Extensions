(() => {
  const VALID_PRESENTATIONS = new Set(['inline', 'modal']);
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
