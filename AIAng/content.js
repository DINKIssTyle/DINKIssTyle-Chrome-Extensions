(() => {
  const SPELLCHECK_ACTION = { id: 'spellcheck', label: '맞춤법 검사', short: '맞춤법', icon: 'check' };
  const HONORIFIC_ACTION = { id: 'honorific', label: '경어체로 교정', short: '경어체', icon: 'chat' };
  const IMPROVE_ACTION = { id: 'improve', label: '문장 개선', short: '문장 개선', icon: 'sparkle' };
  const DECORATE_ACTION = { id: 'decorate', label: '글 꾸미기', short: '글 꾸미기', icon: 'palette' };
  const TITLE_SUGGEST_ACTION = { id: 'suggest_title', label: '글 제목 추천', short: '제목 추천', icon: 'title' };
  const BODY_ACTIONS = [SPELLCHECK_ACTION, HONORIFIC_ACTION, IMPROVE_ACTION, TITLE_SUGGEST_ACTION];
  const COMMENT_ACTIONS = [SPELLCHECK_ACTION, HONORIFIC_ACTION, IMPROVE_ACTION, DECORATE_ACTION];
  const LABELS = Object.fromEntries([...BODY_ACTIONS, ...COMMENT_ACTIONS].map(action => [action.id, action.label]));
  const MEDIA_LEAF_SELECTOR = 'img, video, audio, iframe, canvas, object, embed';
  const MEDIA_WRAPPER_SELECTOR = 'figure, picture, a, [data-type="image"], [data-node-type="image"], [data-node-view-wrapper], [data-youtube-video], .image-resizer';
  const REVIEW_ICON_URL = chrome.runtime.getURL('icons/icon48.png');
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIGCAPTION', 'FIGURE',
    'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN',
    'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH',
    'THEAD', 'TR', 'UL'
  ]);
  let scanFrame = 0;
  let requestSequence = 0;
  let extensionEnabled = false;

  const ICONS = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5L20 6"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8M8 13h5"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/></svg>',
    palette: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0 0 18h1.5a1.5 1.5 0 0 0 0-3H12a2 2 0 0 1 0-4h2.5A6.5 6.5 0 0 0 21 7.5C19.3 4.8 16 3 12 3Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="10" cy="6.5" r="1"/><circle cx="15" cy="6.5" r="1"/></svg>',
    title: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h10M9 5v14M6 19h6"/><path d="m18 10 .8 2.2L21 13l-2.2.8L18 16l-.8-2.2L15 13l2.2-.8Z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>'
  };

  function scheduleScan() {
    if (scanFrame) return;
    scanFrame = requestAnimationFrame(() => {
      scanFrame = 0;
      scanPage();
    });
  }

  function scanPage() {
    cleanupDetachedToolbars();
    if (!extensionEnabled) return;

    document.querySelectorAll('[contenteditable="true"].tiptap.ProseMirror, textarea[placeholder*="댓글을 입력하세요"]')
      .forEach(editor => {
        const kind = classifyEditor(editor);
        if (kind) injectEditorToolbar(editor, kind);
      });
  }

  function classifyEditor(editor) {
    if (editor.matches('textarea[placeholder*="댓글을 입력하세요"]')) return 'comment';
    if (editor.matches('.prose-sm') || editor.querySelector('[data-placeholder*="댓글을 입력하세요"]')) return 'comment';
    if (/\/write(?:\/|$)/.test(location.pathname) && editor.matches('[contenteditable="true"].ProseMirror')) return 'body';
    return null;
  }

  function injectEditorToolbar(editor, kind) {
    if (editor._aiangToolbarSlot?.isConnected) return;
    editor.dataset.aiangEnhanced = 'true';

    const slot = document.createElement('div');
    slot.className = 'aiang-toolbar-slot';
    slot.dataset.aiangKind = kind;
    slot._aiangTarget = editor;

    const toolbar = document.createElement('div');
    toolbar.className = 'aiang-toolbar';
    toolbar.dataset.aiangKind = kind;
    toolbar._aiangTarget = editor;

    const actionGroup = document.createElement('div');
    actionGroup.className = 'aiang-action-group';
    const actions = kind === 'body' ? BODY_ACTIONS : COMMENT_ACTIONS;
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'aiang-action';
      button.dataset.action = action.id;
      button.innerHTML = `${ICONS[action.icon]}<span class="aiang-long-label">${action.label}</span><span class="aiang-short-label">${action.short}</span>`;
      button.addEventListener('click', () => {
        if (kind === 'body' && action.id === 'spellcheck') {
          runPostSpellcheck(editor, button);
        } else if (kind === 'body' && action.id === 'suggest_title') {
          runTitleSuggestions(editor, button);
        } else {
          runAction(editor, action.id, button);
        }
      });
      actionGroup.append(button);
    }
    toolbar.append(actionGroup);

    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.className = 'aiang-settings-button';
    settingsButton.title = 'AIAng 설정';
    settingsButton.setAttribute('aria-label', 'AIAng 설정');
    settingsButton.innerHTML = ICONS.settings;
    settingsButton.addEventListener('click', () => sendMessage({ type: 'OPEN_OPTIONS' }));
    toolbar.append(settingsButton);

    slot.append(toolbar);
    const insertionBoundary = findEditorInsertionBoundary(editor);
    insertionBoundary?.insertAdjacentElement('afterend', slot);
    editor._aiangToolbarSlot = slot;
  }

  function findEditorInsertionBoundary(editor) {
    if (editor instanceof HTMLTextAreaElement) return editor;

    const tiptapEditor = editor.closest('.tiptap-editor');
    if (tiptapEditor) return tiptapEditor;

    let ancestor = editor.parentElement;
    for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
      if (hasEditorBorder(ancestor)) return ancestor;
      if (ancestor.matches('form, article, main')) break;
    }
    return editor;
  }

  function hasEditorBorder(element) {
    const style = getComputedStyle(element);
    const borderedSides = [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth
    ].filter(width => Number.parseFloat(width) > 0).length;
    return borderedSides >= 2;
  }

  function cleanupDetachedToolbars() {
    document.querySelectorAll('.aiang-toolbar-slot').forEach(slot => {
      if (!slot._aiangTarget?.isConnected) slot.remove();
    });
  }

  function removeControls() {
    closeReview();
    document.querySelectorAll('.aiang-toolbar-slot').forEach(slot => {
      if (slot._aiangTarget) {
        delete slot._aiangTarget.dataset.aiangEnhanced;
        delete slot._aiangTarget._aiangToolbarSlot;
      }
      slot.remove();
    });
    document.querySelectorAll('.aiang-title-row').forEach(row => {
      const input = row.querySelector('input#title');
      if (input) row.replaceWith(input);
      else row.remove();
    });
  }

  async function runAction(target, action, button) {
    const snapshot = createTargetSnapshot(target);
    const originalText = snapshot.text;
    if (!originalText.trim()) {
      showToast('교정할 내용을 먼저 입력해 주세요.', 'warning');
      target.focus();
      return;
    }

    setButtonLoading(button, true, action);
    try {
      const result = await requestEditingResult(
        target,
        action,
        target.closest('textarea') ? 'comment' : 'editor',
        snapshot
      );
      showReview({ ...result, action });
    } catch (error) {
      showToast(error?.message || 'AI 요청에 실패했습니다.', 'error', true);
    } finally {
      setButtonLoading(button, false, action);
    }
  }

  async function runPostSpellcheck(editor, button) {
    const title = document.querySelector('input#title[placeholder*="제목"]');
    const candidates = [];
    if (title) {
      const titleSnapshot = createTargetSnapshot(title);
      if (titleSnapshot.text.trim()) {
        candidates.push({ target: title, label: '제목', targetType: 'title', snapshot: titleSnapshot });
      }
    }
    const bodySnapshot = createTargetSnapshot(editor);
    if (bodySnapshot.text.trim()) {
      candidates.push({ target: editor, label: '내용', targetType: 'editor', snapshot: bodySnapshot });
    }
    if (!candidates.length) {
      showToast('제목이나 내용을 먼저 입력해 주세요.', 'warning');
      editor.focus();
      return;
    }

    setButtonLoading(button, true, 'spellcheck');
    try {
      const settled = await Promise.allSettled(candidates.map(async candidate => ({
        ...await requestEditingResult(candidate.target, 'spellcheck', candidate.targetType, candidate.snapshot),
        label: candidate.label
      })));
      const failure = settled.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      showCombinedSpellcheckReview(settled.map(result => result.value));
    } catch (error) {
      showToast(error?.message || '제목과 내용을 검사하지 못했습니다.', 'error', true);
    } finally {
      setButtonLoading(button, false, 'spellcheck');
    }
  }

  async function requestEditingResult(target, action, targetType, snapshot = createTargetSnapshot(target)) {
    const response = await sendMessage({
      type: 'PROCESS_TEXT',
      requestId: `aiang-${Date.now()}-${++requestSequence}`,
      action,
      text: snapshot.text,
      target: targetType
    });
    if (!response?.ok) throw new Error(response?.error || 'AI 요청에 실패했습니다.');
    if (!hasValidProtectedMedia(snapshot, response.correctedText)) {
      throw new Error('AI 응답에서 이미지 위치 정보가 변경되어 결과를 적용하지 않았습니다. 다시 시도해 주세요.');
    }
    return {
      target,
      originalText: snapshot.text,
      correctedText: response.correctedText,
      suggestions: response.suggestions || [],
      snapshot
    };
  }

  async function runTitleSuggestions(editor, button) {
    const title = document.querySelector('input#title[placeholder*="제목"]');
    if (!title) {
      showToast('제목 입력창을 찾지 못했습니다.', 'error');
      return;
    }
    const snapshot = createTargetSnapshot(editor);
    if (!snapshot.text.trim()) {
      showToast('제목을 추천할 내용을 먼저 입력해 주세요.', 'warning');
      editor.focus();
      return;
    }

    setButtonLoading(button, true, 'suggest_title');
    try {
      const response = await sendMessage({
        type: 'SUGGEST_TITLES',
        requestId: `aiang-${Date.now()}-${++requestSequence}`,
        text: snapshot.text
      });
      if (!response?.ok) throw new Error(response?.error || '제목을 추천하지 못했습니다.');
      showTitleSuggestions(title, editor, snapshot, response.titles || []);
    } catch (error) {
      showToast(error?.message || '제목을 추천하지 못했습니다.', 'error', true);
    } finally {
      setButtonLoading(button, false, 'suggest_title');
    }
  }

  function setButtonLoading(button, loading, action) {
    if (!button) return;
    button.disabled = loading;
    button.classList.toggle('is-loading', loading);
    if (loading) {
      if (!button.querySelector('.aiang-loading-content')) {
        const loadingContent = document.createElement('span');
        loadingContent.className = 'aiang-loading-content';
        loadingContent.innerHTML = '<span class="aiang-spinner" aria-hidden="true"></span><span>처리 중</span>';
        button.append(loadingContent);
      }
    } else {
      button.querySelector('.aiang-loading-content')?.remove();
    }
    button.setAttribute('aria-label', loading ? `${LABELS[action]} 처리 중` : LABELS[action]);
  }

  function showReview({ target, action, originalText, correctedText, suggestions, anchor, snapshot }) {
    closeReview();
    const unchanged = originalText === correctedText;
    const panel = document.createElement('section');
    panel.className = anchor ? 'aiang-review aiang-review-popover' : 'aiang-review aiang-review-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', anchor ? 'false' : 'true');
    panel.setAttribute('aria-label', `${LABELS[action]} 결과`);

    const header = document.createElement('header');
    header.className = 'aiang-review-header';
    header.innerHTML = `<div><img class="aiang-review-badge" src="${REVIEW_ICON_URL}" alt=""><strong>${LABELS[action]}</strong></div>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'aiang-close';
    close.setAttribute('aria-label', '닫기');
    close.textContent = '×';
    close.addEventListener('click', closeReview);
    header.append(close);
    panel.append(header);

    if (snapshot.media.length) {
      const mediaNote = document.createElement('div');
      mediaNote.className = 'aiang-media-note';
      mediaNote.textContent = `이미지·미디어 ${snapshot.media.length}개는 원래 DOM과 순서를 유지합니다.`;
      panel.append(mediaNote);
    }

    if (unchanged) {
      const empty = document.createElement('div');
      empty.className = 'aiang-no-change';
      empty.innerHTML = `${ICONS.check}<strong>수정할 내용이 없습니다.</strong><span>현재 문장을 그대로 사용해도 좋습니다.</span>`;
      panel.append(empty);
    } else {
      const comparison = document.createElement('div');
      comparison.className = 'aiang-comparison';
      comparison.append(createTextCard('현재', originalText, correctedText, 'before', snapshot.media));
      comparison.append(createTextCard('제안', correctedText, originalText, 'after', snapshot.media));
      panel.append(comparison);

      if (suggestions.length) {
        panel.append(createSuggestionsDetails(suggestions));
      }
    }

    const footer = document.createElement('footer');
    footer.className = 'aiang-review-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'aiang-secondary';
    cancel.textContent = '취소';
    cancel.addEventListener('click', closeReview);
    footer.append(cancel);
    if (!unchanged) {
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'aiang-primary';
      apply.textContent = '삽입';
      apply.addEventListener('click', () => {
        try {
          if (createTargetSignature(target) !== snapshot.signature) {
            throw new Error('교정 중 입력 내용이 변경되어 결과를 적용하지 않았습니다. 다시 실행해 주세요.');
          }
          writeTargetText(target, correctedText, snapshot.media);
          closeReview();
          showToast(
            snapshot.media.length
              ? `교정문을 반영하고 이미지·미디어 ${snapshot.media.length}개를 유지했습니다.`
              : '교정문을 입력창에 반영했습니다.',
            'success'
          );
        } catch (error) {
          showToast(error?.message || '교정문을 반영하지 못했습니다.', 'error');
        }
      });
      footer.append(apply);
    }
    panel.append(footer);

    if (anchor) {
      document.body.append(panel);
      positionPopover(panel, anchor);
      panel._aiangAnchor = anchor;
    } else {
      const overlay = document.createElement('div');
      overlay.className = 'aiang-overlay';
      overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) closeReview();
      });
      overlay.append(panel);
      document.body.append(overlay);
    }
    document.addEventListener('keydown', handleReviewKeydown, true);
  }

  function showCombinedSpellcheckReview(results) {
    closeReview();
    const unchanged = results.every(result => result.originalText === result.correctedText);
    const panel = document.createElement('section');
    panel.className = 'aiang-review aiang-review-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '맞춤법 검사 결과');

    const header = document.createElement('header');
    header.className = 'aiang-review-header';
    header.innerHTML = `<div><img class="aiang-review-badge" src="${REVIEW_ICON_URL}" alt=""><strong>맞춤법 검사</strong></div>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'aiang-close';
    close.setAttribute('aria-label', '닫기');
    close.textContent = '×';
    close.addEventListener('click', closeReview);
    header.append(close);
    panel.append(header);

    const mediaCount = results.reduce((count, result) => count + result.snapshot.media.length, 0);
    if (mediaCount) {
      const mediaNote = document.createElement('div');
      mediaNote.className = 'aiang-media-note';
      mediaNote.textContent = `내용의 이미지·미디어 ${mediaCount}개는 원래 DOM과 순서를 유지합니다.`;
      panel.append(mediaNote);
    }

    const sections = document.createElement('div');
    sections.className = 'aiang-result-sections';
    for (const result of results) {
      const section = document.createElement('section');
      section.className = 'aiang-result-section';
      const title = document.createElement('h3');
      title.textContent = result.label;
      section.append(title);
      if (result.originalText === result.correctedText) {
        const noChange = document.createElement('div');
        noChange.className = 'aiang-section-no-change';
        noChange.innerHTML = `${ICONS.check}<span>수정할 내용이 없습니다.</span>`;
        section.append(noChange);
      } else {
        const comparison = document.createElement('div');
        comparison.className = 'aiang-comparison aiang-section-comparison';
        comparison.append(
          createTextCard('현재', result.originalText, result.correctedText, 'before', result.snapshot.media),
          createTextCard('제안', result.correctedText, result.originalText, 'after', result.snapshot.media)
        );
        section.append(comparison);
        if (result.suggestions.length) section.append(createSuggestionsDetails(result.suggestions));
      }
      sections.append(section);
    }
    panel.append(sections);

    const footer = document.createElement('footer');
    footer.className = 'aiang-review-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'aiang-secondary';
    cancel.textContent = '취소';
    cancel.addEventListener('click', closeReview);
    footer.append(cancel);
    if (!unchanged) {
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'aiang-primary';
      apply.textContent = '모두 삽입';
      apply.addEventListener('click', () => {
        try {
          for (const result of results) {
            if (createTargetSignature(result.target) !== result.snapshot.signature) {
              throw new Error('교정 중 제목이나 내용이 변경되어 결과를 적용하지 않았습니다. 다시 실행해 주세요.');
            }
          }
          const changed = results.filter(result => result.originalText !== result.correctedText);
          const bodyResults = changed.filter(result => !(result.target instanceof HTMLInputElement));
          const titleResults = changed.filter(result => result.target instanceof HTMLInputElement);
          for (const result of [...bodyResults, ...titleResults]) {
            writeTargetText(result.target, result.correctedText, result.snapshot.media);
          }
          closeReview();
          showToast(
            changed.length > 1 ? '제목과 내용의 교정문을 반영했습니다.' : `${changed[0].label} 교정문을 반영했습니다.`,
            'success'
          );
        } catch (error) {
          showToast(error?.message || '교정문을 반영하지 못했습니다.', 'error');
        }
      });
      footer.append(apply);
    }
    panel.append(footer);
    showModalPanel(panel);
  }

  function showTitleSuggestions(titleInput, editor, snapshot, titles) {
    const uniqueTitles = [...new Set(titles.map(title => String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean))]
      .slice(0, 5);
    if (uniqueTitles.length !== 5) throw new Error('추천 제목 5개를 확인하지 못했습니다. 다시 시도해 주세요.');

    closeReview();
    const panel = document.createElement('section');
    panel.className = 'aiang-review aiang-review-modal aiang-title-review';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '글 제목 추천 결과');

    const header = document.createElement('header');
    header.className = 'aiang-review-header';
    header.innerHTML = `<div><img class="aiang-review-badge" src="${REVIEW_ICON_URL}" alt=""><strong>글 제목 추천</strong></div>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'aiang-close';
    close.setAttribute('aria-label', '닫기');
    close.textContent = '×';
    close.addEventListener('click', closeReview);
    header.append(close);
    panel.append(header);

    const intro = document.createElement('p');
    intro.className = 'aiang-title-intro';
    intro.textContent = '사용할 제목을 선택하면 제목 입력창에 바로 반영합니다.';
    panel.append(intro);

    const list = document.createElement('div');
    list.className = 'aiang-title-list';
    uniqueTitles.forEach((title, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'aiang-title-option';
      option.innerHTML = `<span class="aiang-title-number">${index + 1}</span>`;
      const text = document.createElement('span');
      text.className = 'aiang-title-text';
      text.textContent = title;
      option.append(text);
      option.addEventListener('click', () => {
        try {
          if (createTargetSignature(editor) !== snapshot.signature) {
            throw new Error('추천 중 내용이 변경되었습니다. 제목 추천을 다시 실행해 주세요.');
          }
          writeTargetText(titleInput, title);
          closeReview();
          showToast('선택한 제목을 입력했습니다.', 'success');
          titleInput.focus();
        } catch (error) {
          closeReview();
          showToast(error?.message || '제목을 입력하지 못했습니다.', 'error');
        }
      });
      list.append(option);
    });
    panel.append(list);

    const footer = document.createElement('footer');
    footer.className = 'aiang-review-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'aiang-secondary';
    cancel.textContent = '취소';
    cancel.addEventListener('click', closeReview);
    footer.append(cancel);
    panel.append(footer);
    showModalPanel(panel);
  }

  function createSuggestionsDetails(suggestions) {
    const details = document.createElement('details');
    details.className = 'aiang-suggestions';
    details.innerHTML = `<summary>세부 교정 ${suggestions.length}개</summary>`;
    const list = document.createElement('div');
    for (const suggestion of suggestions.slice(0, 12)) {
      const item = document.createElement('div');
      item.className = 'aiang-suggestion';
      const change = document.createElement('div');
      change.className = 'aiang-suggestion-change';
      const before = document.createElement('del');
      before.textContent = suggestion.original;
      const arrow = document.createElement('span');
      arrow.textContent = '→';
      const after = document.createElement('ins');
      after.textContent = suggestion.replacement;
      change.append(before, arrow, after);
      item.append(change);
      if (suggestion.reason) {
        const reason = document.createElement('small');
        reason.textContent = suggestion.reason;
        item.append(reason);
      }
      list.append(item);
    }
    details.append(list);
    return details;
  }

  function showModalPanel(panel) {
    const overlay = document.createElement('div');
    overlay.className = 'aiang-overlay';
    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay) closeReview();
    });
    overlay.append(panel);
    document.body.append(overlay);
    document.addEventListener('keydown', handleReviewKeydown, true);
  }

  function createTextCard(label, text, otherText, side, media) {
    const card = document.createElement('div');
    card.className = `aiang-text-card aiang-${side}`;
    const heading = document.createElement('span');
    heading.className = 'aiang-card-label';
    heading.textContent = label;
    const content = document.createElement('div');
    content.className = 'aiang-card-content';
    appendDiff(content, formatMediaTokens(text, media), formatMediaTokens(otherText, media), side);
    card.append(heading, content);
    return card;
  }

  function appendDiff(container, text, otherText, side) {
    const diff = wordDiff(side === 'before' ? text : otherText, side === 'before' ? otherText : text);
    if (!diff) {
      container.textContent = text;
      return;
    }
    for (const part of diff) {
      if (side === 'before' && part.type === 'added') continue;
      if (side === 'after' && part.type === 'removed') continue;
      const span = document.createElement('span');
      span.textContent = part.value;
      if ((side === 'before' && part.type === 'removed') || (side === 'after' && part.type === 'added')) {
        span.className = 'aiang-diff';
      }
      container.append(span);
    }
  }

  function wordDiff(before, after) {
    const a = tokenize(before);
    const b = tokenize(after);
    if (a.length * b.length > 90000) return null;
    const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    const parts = [];
    let i = 0;
    let j = 0;
    const push = (type, value) => {
      const previous = parts.at(-1);
      if (previous?.type === type) previous.value += value;
      else parts.push({ type, value });
    };
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        push('same', a[i]); i += 1; j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        push('removed', a[i]); i += 1;
      } else {
        push('added', b[j]); j += 1;
      }
    }
    while (i < a.length) push('removed', a[i++]);
    while (j < b.length) push('added', b[j++]);
    return parts;
  }

  function tokenize(text) {
    return String(text).split(/(\s+|[.,!?;:…()[\]{}'"“”‘’/\\-]+)/).filter(Boolean);
  }

  function positionPopover(panel, anchor) {
    const rect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const margin = 10;
    let left = Math.min(window.innerWidth - panelRect.width - margin, Math.max(margin, rect.right - panelRect.width));
    let top = rect.bottom + 8;
    if (top + panelRect.height > window.innerHeight - margin) top = Math.max(margin, rect.top - panelRect.height - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function closeReview() {
    document.querySelectorAll('.aiang-overlay, .aiang-review-popover').forEach(element => element.remove());
    document.removeEventListener('keydown', handleReviewKeydown, true);
  }

  function handleReviewKeydown(event) {
    if (event.key === 'Escape') closeReview();
  }

  function createTargetSnapshot(target) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return { text: target.value, media: [], signature: createTargetSignature(target) };
    }

    const nonce = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const mediaRoots = collectMediaRoots(target);
    const media = mediaRoots.map((node, index) => ({
      token: `[[AIANG_MEDIA_${nonce}_${index + 1}]]`,
      label: getMediaLabel(node, index),
      node: node.cloneNode(true),
      block: isBlockElement(node)
    }));
    const mediaByNode = new Map(mediaRoots.map((node, index) => [node, media[index]]));
    return {
      text: serializeEditorContent(target, mediaByNode),
      media,
      signature: createTargetSignature(target)
    };
  }

  function createTargetSignature(target) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return `text:${target.value}`;
    const roots = collectMediaRoots(target);
    const mediaByNode = new Map(roots.map((node, index) => [node, {
      token: `[[AIANG_MEDIA_SIGNATURE_${index + 1}]]`,
      block: isBlockElement(node)
    }]));
    const mediaSignature = roots.map(node => ({
      text: node.textContent?.trim() || '',
      sources: getMediaLeaves(node).map(mediaNode => [
        mediaNode.tagName,
        mediaNode.getAttribute('src') || '',
        mediaNode.getAttribute('srcset') || '',
        mediaNode.getAttribute('data-src') || '',
        mediaNode.getAttribute('data-id') || ''
      ])
    }));
    return JSON.stringify({
      text: serializeEditorContent(target, mediaByNode),
      media: mediaSignature
    });
  }

  function getMediaLeaves(root) {
    return [
      ...(root.matches?.(MEDIA_LEAF_SELECTOR) ? [root] : []),
      ...root.querySelectorAll(MEDIA_LEAF_SELECTOR)
    ];
  }

  function collectMediaRoots(target) {
    const roots = [];
    for (const leaf of target.querySelectorAll(MEDIA_LEAF_SELECTOR)) {
      let root = leaf;
      for (let parent = leaf.parentElement; parent && parent !== target; parent = parent.parentElement) {
        if (parent.matches(MEDIA_WRAPPER_SELECTOR)) root = parent;
      }
      if (roots.some(existing => existing.contains(root))) continue;
      for (let index = roots.length - 1; index >= 0; index -= 1) {
        if (root.contains(roots[index])) roots.splice(index, 1);
      }
      roots.push(root);
    }
    return roots.sort(compareDocumentOrder);
  }

  function compareDocumentOrder(left, right) {
    const position = left.compareDocumentPosition(right);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  function getMediaLabel(node, index) {
    const image = node.matches('img') ? node : node.querySelector('img');
    const alt = image?.getAttribute('alt')?.trim();
    return alt ? `🖼 이미지 ${index + 1}: ${alt}` : `🖼 이미지·미디어 ${index + 1}`;
  }

  function isBlockElement(node) {
    return node instanceof Element && BLOCK_TAGS.has(node.tagName);
  }

  function serializeEditorContent(target, mediaByNode) {
    const serialized = Array.from(target.childNodes, node => serializeEditorNode(node, mediaByNode)).join('');
    return serialized
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\n$/, '');
  }

  function serializeEditorNode(node, mediaByNode) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (!(node instanceof Element)) return '';
    const protectedMedia = mediaByNode.get(node);
    if (protectedMedia) return `${protectedMedia.token}${protectedMedia.block ? '\n' : ''}`;
    if (node.tagName === 'BR') return '\n';

    const content = Array.from(node.childNodes, child => serializeEditorNode(child, mediaByNode)).join('');
    if (!BLOCK_TAGS.has(node.tagName)) return content;
    return `${content}\n`;
  }

  function hasValidProtectedMedia(snapshot, correctedText) {
    if (!snapshot.media.length) return true;
    const corrected = String(correctedText || '');
    let previousIndex = -1;
    for (const item of snapshot.media) {
      if (countOccurrences(corrected, item.token) !== 1) return false;
      const currentIndex = corrected.indexOf(item.token);
      if (currentIndex <= previousIndex) return false;
      previousIndex = currentIndex;
    }
    return true;
  }

  function countOccurrences(text, token) {
    let count = 0;
    let offset = 0;
    while ((offset = text.indexOf(token, offset)) >= 0) {
      count += 1;
      offset += token.length;
    }
    return count;
  }

  function formatMediaTokens(text, media) {
    let formatted = String(text || '');
    for (const item of media) formatted = formatted.split(item.token).join(item.label);
    return formatted;
  }

  function writeTargetText(target, text, media = []) {
    target.focus();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(target, text);
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (!media.every(item => countOccurrences(text, item.token) === 1)) {
      throw new Error('이미지 위치 정보가 손상되어 교정문을 반영하지 않았습니다.');
    }

    const backup = Array.from(target.childNodes, node => node.cloneNode(true));

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
      const applied = document.execCommand?.('insertText', false, text);
      selection.removeAllRanges();

      if (!applied) rebuildEditorContent(target, text, media);
      const restoredCount = restoreMediaTokens(target, media);
      if (restoredCount !== media.length) {
        rebuildEditorContent(target, text, media);
        if (countRestoredMedia(target, media) !== media.length) {
          throw new Error('이미지 복원에 실패하여 원래 내용을 되돌렸습니다.');
        }
      }
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: null }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      window.getSelection()?.removeAllRanges();
      target.replaceChildren(...backup.map(node => node.cloneNode(true)));
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: null }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      throw error;
    }
  }

  function restoreMediaTokens(target, media) {
    if (!media.length) return 0;
    const textNodes = [];
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    let restored = 0;

    for (const textNode of textNodes) {
      const matching = media.filter(item => textNode.nodeValue?.includes(item.token));
      if (!matching.length) continue;
      const exactBlock = matching.length === 1
        && matching[0].block
        && textNode.parentElement
        && textNode.parentElement.textContent?.trim() === matching[0].token
        && ['P', 'DIV'].includes(textNode.parentElement.tagName);
      if (exactBlock) {
        textNode.parentElement.replaceWith(createRestoredMediaNode(matching[0]));
        restored += 1;
        continue;
      }

      const pattern = new RegExp(matching.map(item => escapeRegExp(item.token)).join('|'), 'g');
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const match of textNode.nodeValue.matchAll(pattern)) {
        if (match.index > offset) fragment.append(document.createTextNode(textNode.nodeValue.slice(offset, match.index)));
        const item = matching.find(candidate => candidate.token === match[0]);
        fragment.append(createRestoredMediaNode(item));
        restored += 1;
        offset = match.index + match[0].length;
      }
      if (offset < textNode.nodeValue.length) fragment.append(document.createTextNode(textNode.nodeValue.slice(offset)));
      textNode.replaceWith(fragment);
    }
    return restored;
  }

  function createRestoredMediaNode(item) {
    const node = item.node.cloneNode(true);
    node._aiangRestoredToken = item.token;
    return node;
  }

  function countRestoredMedia(target, media) {
    const restoredNodes = Array.from(target.querySelectorAll('*'));
    return media.filter(item => restoredNodes.some(node => node._aiangRestoredToken === item.token)).length;
  }

  function rebuildEditorContent(target, text, media) {
    const mediaByToken = new Map(media.map(item => [item.token, item]));
    const fragment = document.createDocumentFragment();
    for (const line of text.split('\n')) {
      const blockMedia = mediaByToken.get(line.trim());
      if (blockMedia?.block) {
        fragment.append(createRestoredMediaNode(blockMedia));
        continue;
      }
      const paragraph = document.createElement('p');
      appendTextWithMedia(paragraph, line, media);
      if (!paragraph.childNodes.length) paragraph.append(document.createElement('br'));
      fragment.append(paragraph);
    }
    target.replaceChildren(fragment);
  }

  function appendTextWithMedia(parent, text, media) {
    const matching = media.filter(item => text.includes(item.token));
    if (!matching.length) {
      if (text) parent.append(document.createTextNode(text));
      return;
    }
    const pattern = new RegExp(matching.map(item => escapeRegExp(item.token)).join('|'), 'g');
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > offset) parent.append(document.createTextNode(text.slice(offset, match.index)));
      const item = matching.find(candidate => candidate.token === match[0]);
      parent.append(createRestoredMediaNode(item));
      offset = match.index + match[0].length;
    }
    if (offset < text.length) parent.append(document.createTextNode(text.slice(offset)));
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function showToast(message, kind = 'info', duration = 3200, withSettings = false) {
    document.querySelector('.aiang-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = `aiang-toast aiang-toast-${kind}`;
    const text = document.createElement('span');
    text.textContent = message;
    toast.append(text);
    if (withSettings) {
      const settings = document.createElement('button');
      settings.type = 'button';
      settings.textContent = '설정';
      settings.addEventListener('click', () => sendMessage({ type: 'OPEN_OPTIONS' }));
      toast.append(settings);
    }
    document.body.append(toast);
    setTimeout(() => toast.remove(), duration);
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.enabled) return;
    extensionEnabled = changes.enabled.newValue !== false;
    if (!extensionEnabled) removeControls();
    else scheduleScan();
  });
  window.addEventListener('resize', () => {
    const panel = document.querySelector('.aiang-review-popover');
    if (panel?._aiangAnchor) positionPopover(panel, panel._aiangAnchor);
  });
  sendMessage({ type: 'GET_SETTINGS' })
    .then(response => {
      extensionEnabled = Boolean(response?.ok && response.settings?.enabled);
      scheduleScan();
    })
    .catch(() => {});
})();
