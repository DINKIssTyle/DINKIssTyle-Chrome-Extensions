(() => {
  const SPELLCHECK_ACTION = { id: 'spellcheck', label: '맞춤법 검사', short: '맞춤법', icon: 'check' };
  const HONORIFIC_ACTION = { id: 'honorific', label: '경어체로 교정', short: '경어체', icon: 'chat' };
  const IMPROVE_ACTION = { id: 'improve', label: '문장 개선', short: '문장 개선', icon: 'sparkle' };
  const DECORATE_ACTION = { id: 'decorate', label: '글 꾸미기', short: '글 꾸미기', icon: 'palette' };
  const TITLE_SUGGEST_ACTION = { id: 'suggest_title', label: '글 제목 추천', short: '제목 추천', icon: 'title' };
  const POST_SUMMARY_ACTION = { id: 'summarize_post', label: '게시물 요약', short: '요약', icon: 'sparkle' };
  const COMMENT_REACTION_ACTION = { id: 'summarize_reactions', label: '댓글 반응 요약', short: '댓글 요약', icon: 'chat' };
  const BODY_ACTIONS = [SPELLCHECK_ACTION, HONORIFIC_ACTION, IMPROVE_ACTION, TITLE_SUGGEST_ACTION];
  const COMMENT_ACTIONS = [SPELLCHECK_ACTION, HONORIFIC_ACTION, IMPROVE_ACTION, DECORATE_ACTION];
  const LABELS = Object.fromEntries([...BODY_ACTIONS, ...COMMENT_ACTIONS, POST_SUMMARY_ACTION, COMMENT_REACTION_ACTION]
    .map(action => [action.id, action.label]));
  const MEDIA_LEAF_SELECTOR = 'img, video, audio, iframe, canvas, object, embed';
  const MEDIA_WRAPPER_SELECTOR = 'figure, picture, a, [data-type="image"], [data-node-type="image"], [data-node-view-wrapper], [data-youtube-video], .image-resizer';
  const POST_EDITOR_PATH_PATTERN = /\/(?:write|edit)(?:\/|$)/;
  const POST_VIEW_PATH_PATTERN = /^\/[^/?#]+\/\d+(?:\/|$)/;
  const POST_SUMMARY_SOURCE_LIMIT = 15000;
  const COMMENT_REACTION_POST_LIMIT = 6000;
  const COMMENT_REACTION_COMMENTS_LIMIT = 9000;
  const ARTICLE_BODY_SELECTORS = [
    '[data-aiang-article-body]',
    '[itemprop="articleBody"]',
    '#bo_v_con',
    '.bo_v_con',
    '.board-view-content',
    '.article-content',
    '.article-body',
    '.post-content',
    '.view-content',
    '.view_content',
    '.xe_content'
  ];
  const ARTICLE_CONTENT_EXCLUDE_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'nav', 'aside', 'footer', 'form',
    'button', 'input', 'textarea', 'select', '[contenteditable="true"]', '[hidden]',
    '[aria-hidden="true"]', '.aiang-summary-slot', '[class*="comment"]', '[id*="comment"]',
    '[class*="advert"]', '[id*="advert"]', '[class~="ad"]', '[id^="ad-"]',
    '[class*="share"]', '[class*="reaction"]', '[class*="signature"]'
  ].join(',');
  const COMMENT_ROOT_SELECTORS = [
    '[data-aiang-comments]',
    '[data-role="comments"]',
    '#comments',
    '#comment',
    '.comments',
    '.comment-list',
    '.comments-list',
    '[class*="comment-list"]',
    '[id*="comment-list"]'
  ];
  const COMMENT_ITEM_SELECTORS = [
    '[data-aiang-comment]',
    '[data-comment-id]',
    '[data-role="comment"]',
    '.comment-item',
    '.comment-row',
    '.reply-item',
    'li[class*="comment"]'
  ];
  const COMMENT_TEXT_SELECTORS = [
    '[data-aiang-comment-text]',
    '[data-comment-content]',
    '[data-role="comment-content"]',
    '.comment-content',
    '.comment-body',
    '.reply-content',
    '.comment_text',
    '.cmt-content',
    '.prose-sm'
  ];
  const COMMENT_CONTENT_EXCLUDE_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'nav', 'aside', 'footer', 'form',
    'button', 'input', 'textarea', 'select', 'time', '[contenteditable="true"]', '[hidden]',
    '[aria-hidden="true"]', '.aiang-toolbar-slot', '.aiang-summary-slot',
    '[class*="author"]', '[class*="profile"]', '[class*="avatar"]', '[class*="meta"]',
    '[class*="action"]', '[class*="control"]', '[class*="vote"]', '[class*="reaction"]'
  ].join(',');
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
  let inlineReviewSession = null;
  let inlineReviewFrame = 0;
  let toastToolbarAnchor = null;
  const buttonRequestStates = new WeakMap();

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
    cleanupDetachedControls();
    if (!extensionEnabled) return;

    document.querySelectorAll('[contenteditable="true"].tiptap.ProseMirror, textarea[placeholder*="댓글을 입력하세요"]')
      .forEach(editor => {
        const kind = classifyEditor(editor);
        if (kind) injectEditorToolbar(editor, kind);
      });
    scanArticleSummary();
  }

  function classifyEditor(editor) {
    if (editor.matches('textarea[placeholder*="댓글을 입력하세요"]')) return 'comment';
    if (editor.matches('.prose-sm') || editor.querySelector('[data-placeholder*="댓글을 입력하세요"]')) return 'comment';
    if (POST_EDITOR_PATH_PATTERN.test(location.pathname) && editor.matches('[contenteditable="true"].ProseMirror')) return 'body';
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
    toolbar.className = 'aiang-toolbar aiang-no-select';
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
        toastToolbarAnchor = toolbar;
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

  function cleanupDetachedControls() {
    document.querySelectorAll('.aiang-toolbar-slot').forEach(slot => {
      if (!slot._aiangTarget?.isConnected) slot.remove();
    });
    document.querySelectorAll('.aiang-summary-slot').forEach(slot => {
      if (!slot._aiangTarget?.isConnected) slot.remove();
    });
  }

  function removeControls() {
    closeReview();
    document.querySelectorAll('.aiang-action.is-loading, .aiang-summary-button.is-loading')
      .forEach(cancelButtonRequest);
    document.querySelectorAll('.aiang-toolbar-slot').forEach(slot => {
      if (slot._aiangTarget) {
        delete slot._aiangTarget.dataset.aiangEnhanced;
        delete slot._aiangTarget._aiangToolbarSlot;
      }
      slot.remove();
    });
    document.querySelectorAll('.aiang-summary-slot').forEach(slot => {
      if (slot._aiangTarget) delete slot._aiangTarget._aiangSummarySlot;
      slot.remove();
    });
    document.querySelectorAll('.aiang-title-row').forEach(row => {
      const input = row.querySelector('input#title');
      if (input) row.replaceWith(input);
      else row.remove();
    });
  }

  function scanArticleSummary() {
    const fixtureBody = document.querySelector('[data-aiang-article-body]');
    if (POST_EDITOR_PATH_PATTERN.test(location.pathname)
      || (!POST_VIEW_PATH_PATTERN.test(location.pathname) && !fixtureBody)) return;
    const articleBody = fixtureBody || findArticleBody();
    if (!articleBody || articleBody._aiangSummarySlot?.isConnected) return;

    const slot = document.createElement('div');
    slot.className = 'aiang-summary-slot aiang-no-select';
    slot._aiangTarget = articleBody;

    const postButton = document.createElement('button');
    postButton.type = 'button';
    postButton.className = 'aiang-summary-button';
    postButton.innerHTML = `${ICONS[POST_SUMMARY_ACTION.icon]}<span>${POST_SUMMARY_ACTION.label}</span>`;
    postButton.addEventListener('click', () => {
      toastToolbarAnchor = slot;
      runPostSummary(articleBody, postButton);
    });

    const reactionButton = document.createElement('button');
    reactionButton.type = 'button';
    reactionButton.className = 'aiang-summary-button';
    reactionButton.innerHTML = `${ICONS[COMMENT_REACTION_ACTION.icon]}<span>${COMMENT_REACTION_ACTION.label}</span>`;
    reactionButton.addEventListener('click', () => {
      toastToolbarAnchor = slot;
      runCommentReactionSummary(articleBody, reactionButton);
    });
    slot.append(postButton, reactionButton);
    articleBody.insertAdjacentElement('beforebegin', slot);
    articleBody._aiangSummarySlot = slot;
  }

  function findArticleBody() {
    for (const selector of ARTICLE_BODY_SELECTORS) {
      const candidate = Array.from(document.querySelectorAll(selector)).find(isLikelyArticleBody);
      if (candidate) return candidate;
    }

    const roots = Array.from(document.querySelectorAll([
      'article',
      'main article',
      'main [role="article"]',
      'main .text-card-foreground.flex.flex-col'
    ].join(',')));
    const candidates = roots.flatMap(root => [
      ...root.querySelectorAll(':scope > section, :scope > div, :scope > div > section, :scope > div > div, :scope > div > div > section, :scope > div > div > div')
    ]).filter(isLikelyArticleBody);
    return candidates.sort((left, right) => scoreArticleBody(right) - scoreArticleBody(left))[0] || null;
  }

  function isLikelyArticleBody(candidate) {
    if (!(candidate instanceof HTMLElement)
      || candidate.matches(ARTICLE_CONTENT_EXCLUDE_SELECTOR)
      || candidate.closest('[class*="comment"], [id*="comment"], aside, footer, nav')
      || candidate.querySelector('[contenteditable="true"]')) return false;
    const textLength = extractArticleText(candidate).length;
    return textLength >= 20 || Boolean(candidate.querySelector('img, video, iframe, blockquote'));
  }

  function scoreArticleBody(candidate) {
    const textLength = extractArticleText(candidate).length;
    const mediaCount = candidate.querySelectorAll('img, video, iframe, blockquote').length;
    const controlPenalty = candidate.querySelectorAll('button, input, nav, [class*="share"], [class*="reaction"]').length * 120;
    const visibleHeight = Math.min(candidate.getBoundingClientRect().height, 2400);
    return textLength + mediaCount * 160 + visibleHeight / 4 - controlPenalty;
  }

  function extractArticleText(articleBody) {
    const bodyMarkdown = Array.from(articleBody.childNodes).map(convertArticleNodeToMarkdown).join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const title = findArticleTitle(articleBody);
    return [title ? `# ${title}` : '', bodyMarkdown].filter(Boolean).join('\n\n');
  }

  function convertArticleNodeToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) return String(node.nodeValue || '').replace(/\s+/g, ' ');
    if (!(node instanceof HTMLElement) || node.matches(ARTICLE_CONTENT_EXCLUDE_SELECTOR)) return '';
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return '';

    const tag = node.tagName;
    if (tag === 'BR') return '\n';
    if (tag === 'IMG') {
      const alternative = String(node.getAttribute('alt') || '').trim();
      return alternative ? `\n[이미지: ${alternative}]\n` : '';
    }
    if (node.matches('VIDEO, AUDIO, IFRAME')) {
      const title = String(node.getAttribute('title') || node.getAttribute('aria-label') || '').trim();
      return title ? `\n[미디어: ${title}]\n` : '';
    }
    if (tag === 'PRE') return `\n\`\`\`\n${node.textContent || ''}\n\`\`\`\n`;
    if (tag === 'TABLE') return convertArticleTableToMarkdown(node);

    let content = Array.from(node.childNodes).map(convertArticleNodeToMarkdown).join('');
    if (!content.trim()) return '';
    if (/^H[1-6]$/.test(tag)) return `\n${'#'.repeat(Number(tag[1]))} ${content.trim()}\n`;
    if (tag === 'STRONG' || tag === 'B') return `**${content.trim()}**`;
    if (tag === 'EM' || tag === 'I') return `*${content.trim()}*`;
    if (tag === 'DEL' || tag === 'S') return `~~${content.trim()}~~`;
    if (tag === 'CODE') return `\`${content.trim()}\``;
    if (tag === 'BLOCKQUOTE') {
      return `\n${content.trim().split('\n').map(line => `> ${line}`).join('\n')}\n`;
    }
    if (tag === 'LI') {
      const parent = node.parentElement;
      const marker = parent?.tagName === 'OL'
        ? `${Array.from(parent.children).indexOf(node) + 1}.`
        : '-';
      return `\n${marker} ${content.trim()}`;
    }
    if (tag === 'UL' || tag === 'OL') return `\n${content.trim()}\n`;
    if (tag === 'HR') return '\n---\n';
    if (BLOCK_TAGS.has(tag)) return `\n${content.trim()}\n`;
    return content;
  }

  function convertArticleTableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr')).map(row => Array.from(row.querySelectorAll('th, td'))
      .map(cell => cell.textContent.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')));
    if (!rows.length || !rows[0].length) return '';
    const width = Math.max(...rows.map(row => row.length));
    const formatRow = row => `| ${Array.from({ length: width }, (_, index) => row[index] || '').join(' | ')} |`;
    return `\n${formatRow(rows[0])}\n${formatRow(Array(width).fill('---'))}\n${rows.slice(1).map(formatRow).join('\n')}\n`;
  }

  function findArticleTitle(articleBody) {
    const root = articleBody.closest('article, [role="article"], .text-card-foreground.flex.flex-col')
      || articleBody.parentElement;
    const headings = root ? Array.from(root.querySelectorAll('h1, h2')) : [];
    const heading = headings.find(candidate => !articleBody.contains(candidate)
      && Boolean(candidate.compareDocumentPosition(articleBody) & Node.DOCUMENT_POSITION_FOLLOWING));
    const title = String(heading?.textContent || '').replace(/\s+/g, ' ').trim();
    return title.slice(0, 300);
  }

  function limitPostSummarySource(text, limit = POST_SUMMARY_SOURCE_LIMIT, tailLength = 3000) {
    if (text.length <= limit) return text;
    const headLength = limit - tailLength - 80;
    return `${text.slice(0, headLength).trimEnd()}\n\n[중간 본문 일부 생략: 입력 길이 제한]\n\n${text.slice(-tailLength).trimStart()}`;
  }

  async function runPostSummary(articleBody, button) {
    if (cancelButtonRequest(button)) return;
    const text = limitPostSummarySource(extractArticleText(articleBody));
    if (!text) {
      showToast('요약할 게시물 본문을 찾지 못했습니다.', 'warning');
      return;
    }
    closeReview();
    const requestState = beginButtonRequest(button, POST_SUMMARY_ACTION.id);
    try {
      const response = await sendMessage({
        type: 'SUMMARIZE_POST',
        requestId: createTrackedRequestId(button),
        text
      });
      if (!response?.ok) throw new Error(response?.error || '게시물을 요약하지 못했습니다.');
      showPostSummary(response.summary, POST_SUMMARY_ACTION.label);
    } catch (error) {
      showRequestError(error, requestState, '게시물을 요약하지 못했습니다.');
    } finally {
      finishButtonRequest(button, requestState);
    }
  }

  async function runCommentReactionSummary(articleBody, button) {
    if (cancelButtonRequest(button)) return;
    const comments = collectCommentTexts(articleBody);
    if (!comments.length) {
      const declaredCount = getDeclaredDamoangCommentCount(articleBody);
      showToast(
        declaredCount > 0
          ? '댓글을 아직 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
          : '요약할 댓글이 아직 없습니다.',
        'info'
      );
      return;
    }

    const postText = limitPostSummarySource(
      extractArticleText(articleBody),
      COMMENT_REACTION_POST_LIMIT,
      1200
    );
    const commentsSource = buildCommentReactionSource(comments);
    closeReview();
    const requestState = beginButtonRequest(button, COMMENT_REACTION_ACTION.id);
    try {
      const response = await sendMessage({
        type: 'SUMMARIZE_REACTIONS',
        requestId: createTrackedRequestId(button),
        postText,
        commentsText: commentsSource.text,
        commentCount: comments.length,
        sampledCommentCount: commentsSource.sampledCount
      });
      if (!response?.ok) throw new Error(response?.error || '댓글 반응을 요약하지 못했습니다.');
      showPostSummary(response.summary, COMMENT_REACTION_ACTION.label);
    } catch (error) {
      showRequestError(error, requestState, '댓글 반응을 요약하지 못했습니다.');
    } finally {
      finishButtonRequest(button, requestState);
    }
  }

  function collectCommentTexts(articleBody) {
    const followsArticle = element => Boolean(articleBody.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
    const damoangRoot = findDamoangCommentRoot(articleBody);
    if (damoangRoot) {
      const commentBodies = Array.from(damoangRoot.querySelectorAll('li.comment-item .comment-body'));
      return normalizeCollectedCommentTexts(commentBodies);
    }

    const roots = findCommentRoots(articleBody);
    const commentItemSelector = COMMENT_ITEM_SELECTORS.join(',');
    const explicitContents = COMMENT_TEXT_SELECTORS.flatMap(selector => Array.from(document.querySelectorAll(selector)))
      .filter(element => followsArticle(element)
        && !element.matches('[contenteditable="true"]')
        && !element.closest('.aiang-toolbar-slot')
        && (roots.some(root => root.contains(element)) || Boolean(element.closest(commentItemSelector))));
    let candidates = keepInnermostElements(explicitContents);

    if (!candidates.length) {
      const items = COMMENT_ITEM_SELECTORS.flatMap(selector => Array.from(document.querySelectorAll(selector)))
        .filter(followsArticle);
      candidates = items.map(item => COMMENT_TEXT_SELECTORS
        .map(selector => item.querySelector(selector)).find(Boolean) || item);
    }

    if (!candidates.length) {
      candidates = roots.flatMap(root => Array.from(root.querySelectorAll('p, li, [class*="content"], [class*="body"], [class*="text"]')))
        .filter(element => !element.querySelector('p, li, [class*="content"], [class*="body"], [class*="text"]'));
    }

    return normalizeCollectedCommentTexts(candidates);
  }

  function normalizeCollectedCommentTexts(candidates) {
    const seen = new Set();
    return candidates.map(extractCommentText)
      .map(text => text.trim())
      .filter(text => text.length >= 2 && !isCommentInterfaceText(text))
      .filter(text => {
        const key = text.replace(/\s+/g, ' ').toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function findDamoangCommentRoot(articleBody) {
    const root = document.querySelector('#comments');
    return root && Boolean(articleBody.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING)
      ? root
      : null;
  }

  function getDeclaredDamoangCommentCount(articleBody) {
    const root = findDamoangCommentRoot(articleBody);
    const heading = root && Array.from(root.querySelectorAll('h1, h2, h3, h4'))
      .find(element => /^댓글(?:\s|\(|$)/.test(element.textContent.trim()));
    const match = heading?.textContent.match(/댓글\s*\(?\s*(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function findCommentRoots(articleBody) {
    const followsArticle = element => Boolean(articleBody.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
    const roots = COMMENT_ROOT_SELECTORS.flatMap(selector => Array.from(document.querySelectorAll(selector)))
      .filter(followsArticle);
    document.querySelectorAll('textarea[placeholder*="댓글을 입력하세요"]').forEach(editor => {
      const root = editor.closest('[data-role="comments"], section, [class*="comment"]') || editor.parentElement?.parentElement;
      if (root && followsArticle(root)) roots.push(root);
    });
    return keepOutermostElements(roots);
  }

  function keepInnermostElements(elements) {
    const unique = [...new Set(elements)].filter(element => element instanceof HTMLElement && element.isConnected);
    return unique.filter(element => !unique.some(other => other !== element && element.contains(other)));
  }

  function keepOutermostElements(elements) {
    const unique = [...new Set(elements)].filter(element => element instanceof HTMLElement && element.isConnected);
    return unique.filter(element => !unique.some(other => other !== element && other.contains(element)));
  }

  function extractCommentText(element) {
    const chunks = [];
    const visit = node => {
      if (node.nodeType === Node.TEXT_NODE) {
        chunks.push(node.nodeValue || '');
        return;
      }
      if (!(node instanceof HTMLElement) || node.matches(COMMENT_CONTENT_EXCLUDE_SELECTOR)) return;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      if (node.tagName === 'A' && /(?:member|profile|user|author)/i.test(node.getAttribute('href') || '')) return;
      if (node.tagName === 'BR') {
        chunks.push('\n');
        return;
      }
      if (node.tagName === 'IMG') {
        const alternative = String(node.getAttribute('alt') || '').trim();
        if (alternative && !/프로필|아바타/i.test(alternative)) chunks.push(`[이미지: ${alternative}]`);
        return;
      }
      const block = BLOCK_TAGS.has(node.tagName);
      if (block) chunks.push('\n');
      node.childNodes.forEach(visit);
      if (block) chunks.push('\n');
    };
    element.childNodes.forEach(visit);
    return chunks.join('')
      .split('\n')
      .map(line => line.replace(/[ \t\f\v]+/g, ' ').trim())
      .filter(line => line && !isCommentMetaLine(line))
      .join('\n')
      .trim();
  }

  function isCommentMetaLine(line) {
    return /^(?:답글|신고|수정|삭제|차단|추천|비추천|공감|더보기)(?:\s|$)/.test(line)
      || /^(?:방금|\d+\s*(?:초|분|시간|일)\s*전)$/.test(line)
      || /^\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(line);
  }

  function isCommentInterfaceText(text) {
    return /^(?:댓글|댓글을 입력하세요|등록|새 댓글|댓글 없음|댓글이 없습니다)(?:\s*\d+)?$/.test(text.trim());
  }

  function buildCommentReactionSource(comments) {
    const maximumSamples = 40;
    const sampleCount = Math.min(comments.length, maximumSamples);
    const indices = Array.from({ length: sampleCount }, (_, index) => sampleCount === 1
      ? 0
      : Math.round(index * (comments.length - 1) / (sampleCount - 1)));
    const sampled = indices.map(index => comments[index]);
    const perCommentLimit = Math.max(120, Math.floor(
      (COMMENT_REACTION_COMMENTS_LIMIT - sampled.length * 20) / Math.max(1, sampled.length)
    ));
    const text = sampled.map((comment, index) => {
      const shortened = comment.length > perCommentLimit
        ? `${comment.slice(0, perCommentLimit - 1).trimEnd()}…`
        : comment;
      return `[댓글 ${indices[index] + 1}]\n${shortened}`;
    }).join('\n\n');
    return { text, sampledCount: sampled.length };
  }

  async function runAction(target, action, button) {
    if (cancelButtonRequest(button)) return;
    const snapshot = createTargetSnapshot(target);
    const originalText = snapshot.text;
    if (!originalText.trim()) {
      showToast('교정할 내용을 먼저 입력해 주세요.', 'warning');
      target.focus();
      return;
    }

    closeReview();
    const requestState = beginButtonRequest(button, action);
    try {
      const result = await requestEditingResult(
        target,
        action,
        target.closest('textarea') ? 'comment' : 'editor',
        snapshot,
        createTrackedRequestId(button)
      );
      showInlineReview([{ ...result, action }]);
    } catch (error) {
      showRequestError(error, requestState, 'AI 요청에 실패했습니다.');
    } finally {
      finishButtonRequest(button, requestState);
    }
  }

  async function runPostSpellcheck(editor, button) {
    if (cancelButtonRequest(button)) return;
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

    closeReview();
    const requestState = beginButtonRequest(button, 'spellcheck');
    try {
      const settled = await Promise.allSettled(candidates.map(async candidate => ({
        ...await requestEditingResult(
          candidate.target,
          'spellcheck',
          candidate.targetType,
          candidate.snapshot,
          createTrackedRequestId(button)
        ),
        label: candidate.label
      })));
      const failure = settled.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      showInlineReview(settled.map(result => ({ ...result.value, action: 'spellcheck' })));
    } catch (error) {
      showRequestError(error, requestState, '제목과 내용을 검사하지 못했습니다.');
    } finally {
      finishButtonRequest(button, requestState);
    }
  }

  async function requestEditingResult(
    target,
    action,
    targetType,
    snapshot = createTargetSnapshot(target),
    requestId = createRequestId()
  ) {
    const response = await sendMessage({
      type: 'PROCESS_TEXT',
      requestId,
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
    if (cancelButtonRequest(button)) return;
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

    closeReview();
    const requestState = beginButtonRequest(button, 'suggest_title');
    try {
      const response = await sendMessage({
        type: 'SUGGEST_TITLES',
        requestId: createTrackedRequestId(button),
        text: snapshot.text
      });
      if (!response?.ok) throw new Error(response?.error || '제목을 추천하지 못했습니다.');
      showTitleSuggestions(title, editor, snapshot, response.titles || []);
    } catch (error) {
      showRequestError(error, requestState, '제목을 추천하지 못했습니다.');
    } finally {
      finishButtonRequest(button, requestState);
    }
  }

  function createRequestId() {
    return `aiang-${Date.now()}-${++requestSequence}`;
  }

  function beginButtonRequest(button, action) {
    const state = { action, requestIds: new Set(), cancelRequested: false };
    buttonRequestStates.set(button, state);
    setButtonLoading(button, true, action);
    return state;
  }

  function createTrackedRequestId(button) {
    const requestId = createRequestId();
    buttonRequestStates.get(button)?.requestIds.add(requestId);
    return requestId;
  }

  function finishButtonRequest(button, state) {
    if (buttonRequestStates.get(button) !== state) return;
    buttonRequestStates.delete(button);
    setButtonLoading(button, false, state.action);
  }

  function cancelButtonRequest(button) {
    const state = buttonRequestStates.get(button);
    if (!state) return false;
    if (!state.cancelRequested) {
      state.cancelRequested = true;
      button.classList.add('is-cancelling');
      const label = button.querySelector('.aiang-loading-label');
      if (label) label.textContent = '취소 중';
      button.setAttribute('aria-label', `${LABELS[state.action]} 요청 취소 중`);
      state.requestIds.forEach(requestId => {
        sendMessage({ type: 'CANCEL_REQUEST', requestId }).catch(() => {});
      });
    }
    return true;
  }

  function showRequestError(error, state, fallbackMessage) {
    const message = error?.message || fallbackMessage;
    const cancelled = state?.cancelRequested || error?.name === 'AbortError' || message === '요청을 취소했습니다.';
    if (cancelled) {
      showToast('요청을 취소했습니다.', 'info', 1800);
      return;
    }
    showToast(message, 'error', 3200, true);
  }

  function setButtonLoading(button, loading, action) {
    if (!button) return;
    button.disabled = false;
    button.classList.toggle('is-loading', loading);
    button.classList.toggle('is-cancelling', false);
    button.setAttribute('aria-busy', String(loading));
    if (loading) {
      if (!button.querySelector('.aiang-loading-content')) {
        const loadingContent = document.createElement('span');
        loadingContent.className = 'aiang-loading-content';
        loadingContent.innerHTML = [
          '<span class="aiang-spinner" aria-hidden="true"></span>',
          '<span class="aiang-loading-label">처리 중</span>',
          '<span class="aiang-loading-cancel" aria-hidden="true">×</span>'
        ].join('');
        button.append(loadingContent);
      }
    } else {
      button.querySelector('.aiang-loading-content')?.remove();
    }
    button.setAttribute(
      'aria-label',
      loading ? `${LABELS[action]} 처리 중, 다시 누르면 취소` : LABELS[action]
    );
  }

  function showInlineReview(results) {
    closeReview();
    const entries = results.map((result, entryIndex) => {
      const changes = createInlineChanges(result, entryIndex);
      return {
        target: result.target,
        action: result.action,
        label: result.label || LABELS[result.action],
        snapshot: result.snapshot,
        currentText: result.originalText,
        changes
      };
    }).filter(entry => entry.changes.length);

    if (!entries.length) {
      showToast('수정할 내용이 없습니다.', 'success');
      return;
    }

    const layer = document.createElement('div');
    layer.className = 'aiang-inline-layer';
    const navigator = createInlineNavigator();
    document.body.append(layer, navigator);

    inlineReviewSession = {
      entries,
      layer,
      navigator,
      tooltip: null,
      activeChangeId: entries[0].changes[0].id,
      applying: false,
      resizeObserver: typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleInlineReviewRender) : null,
      inputHandlers: new Map(),
      safeSpaceStyles: new Map()
    };

    reserveInlineReviewSafeSpace(inlineReviewSession);
    for (const entry of entries) {
      const handleInput = () => {
        if (inlineReviewSession?.applying) return;
        closeInlineReview();
        showToast('입력 내용이 변경되어 교정 표시를 닫았습니다. 다시 실행해 주세요.', 'warning');
      };
      entry.target.addEventListener('input', handleInput);
      inlineReviewSession.inputHandlers.set(entry.target, handleInput);
      inlineReviewSession.resizeObserver?.observe(entry.target);
    }
    document.addEventListener('scroll', scheduleInlineReviewRender, true);
    document.addEventListener('keydown', handleReviewKeydown, true);
    window.addEventListener('resize', scheduleInlineReviewRender);
    renderInlineReview();
    focusInlineChange(inlineReviewSession.activeChangeId);
  }

  function reserveInlineReviewSafeSpace(session) {
    const reservedSpace = Math.ceil(session.navigator.getBoundingClientRect().height) + 20;
    for (const target of new Set(session.entries.map(entry => entry.target))) {
      if (!(target instanceof HTMLTextAreaElement) && !target.isContentEditable) continue;
      const computed = getComputedStyle(target);
      const properties = ['padding-bottom', 'scroll-padding-bottom'];
      const previous = Object.fromEntries(properties.map(property => [property, {
        value: target.style.getPropertyValue(property),
        priority: target.style.getPropertyPriority(property)
      }]));
      session.safeSpaceStyles.set(target, previous);

      const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
      const scrollPaddingBottom = Number.parseFloat(computed.scrollPaddingBottom) || 0;
      target.style.setProperty('padding-bottom', `${paddingBottom + reservedSpace}px`, 'important');
      target.style.setProperty('scroll-padding-bottom', `${scrollPaddingBottom + reservedSpace}px`);
    }
  }

  function restoreInlineReviewSafeSpace(session) {
    for (const [target, properties] of session.safeSpaceStyles || []) {
      for (const [property, previous] of Object.entries(properties)) {
        if (previous.value) target.style.setProperty(property, previous.value, previous.priority);
        else target.style.removeProperty(property);
      }
    }
    session.safeSpaceStyles?.clear();
  }

  function createInlineChanges(result, entryIndex) {
    const supplied = result.action === 'spellcheck' && Array.isArray(result.suggestions)
      ? result.suggestions.map(suggestion => ({
        original: String(suggestion.original || ''),
        replacement: String(suggestion.replacement || ''),
        start: Number(suggestion.start),
        end: Number(suggestion.end),
        reason: String(suggestion.reason || '').trim()
      }))
      : [];
    const candidates = supplied.length
      ? supplied
      : buildInlineChangesFromDiff(result.originalText, result.correctedText, LABELS[result.action]);
    return candidates
      .filter(change => Number.isInteger(change.start)
        && Number.isInteger(change.end)
        && change.start >= 0
        && change.end >= change.start
        && result.originalText.slice(change.start, change.end) === change.original
        && change.original !== change.replacement)
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .filter((change, index, list) => index === 0 || change.start >= list[index - 1].end)
      .map((change, changeIndex) => ({
        ...change,
        id: `aiang-change-${Date.now()}-${entryIndex}-${changeIndex}`,
        reason: change.reason || `${LABELS[result.action]} 제안`
      }));
  }

  function buildInlineChangesFromDiff(originalText, correctedText, reason = '') {
    if (originalText === correctedText) return [];
    const parts = wordDiff(originalText, correctedText);
    if (!parts) {
      let prefix = 0;
      const limit = Math.min(originalText.length, correctedText.length);
      while (prefix < limit && originalText[prefix] === correctedText[prefix]) prefix += 1;
      let originalEnd = originalText.length;
      let correctedEnd = correctedText.length;
      while (originalEnd > prefix && correctedEnd > prefix
        && originalText[originalEnd - 1] === correctedText[correctedEnd - 1]) {
        originalEnd -= 1;
        correctedEnd -= 1;
      }
      return [{
        original: originalText.slice(prefix, originalEnd),
        replacement: correctedText.slice(prefix, correctedEnd),
        start: prefix,
        end: originalEnd,
        reason
      }];
    }

    const changes = [];
    let originalOffset = 0;
    let pending = null;
    const flush = () => {
      if (!pending) return;
      changes.push({ ...pending, end: pending.start + pending.original.length, reason });
      pending = null;
    };
    for (const part of parts) {
      if (part.type === 'same') {
        flush();
        originalOffset += part.value.length;
        continue;
      }
      if (!pending) pending = { original: '', replacement: '', start: originalOffset };
      if (part.type === 'removed') {
        pending.original += part.value;
        originalOffset += part.value.length;
      } else if (part.type === 'added') {
        pending.replacement += part.value;
      }
    }
    flush();
    return changes;
  }

  function createInlineNavigator() {
    const navigator = document.createElement('div');
    navigator.className = 'aiang-inline-navigator aiang-no-select';
    navigator.setAttribute('role', 'toolbar');
    navigator.setAttribute('aria-label', 'AI 교정 제안');
    navigator.innerHTML = [
      '<button type="button" class="aiang-inline-cancel" data-aiang-inline="close" title="교정 취소">취소</button>',
      '<button type="button" class="aiang-inline-apply-all" data-aiang-inline="apply-all" title="모든 교정 적용">모두 적용</button>'
    ].join('');
    navigator.querySelector('[data-aiang-inline="apply-all"]').addEventListener('click', applyAllInlineChanges);
    navigator.querySelector('[data-aiang-inline="close"]').addEventListener('click', closeInlineReview);
    return navigator;
  }

  function getInlineChangeRecords() {
    if (!inlineReviewSession) return [];
    return inlineReviewSession.entries.flatMap(entry => entry.changes.map(change => ({ entry, change })));
  }

  function findInlineChangeRecord(changeId) {
    return getInlineChangeRecords().find(record => record.change.id === changeId) || null;
  }

  function updateInlineNavigator() {
    if (!inlineReviewSession) return;
    const records = getInlineChangeRecords();
    let index = records.findIndex(record => record.change.id === inlineReviewSession.activeChangeId);
    if (index < 0 && records.length) {
      index = 0;
      inlineReviewSession.activeChangeId = records[0].change.id;
    }
    positionInlineNavigator(records[index]?.entry?.target || inlineReviewSession.entries[0]?.target);
  }

  function positionInlineNavigator(target) {
    const session = inlineReviewSession;
    const navigator = session?.navigator;
    if (!navigator?.isConnected || !target?.isConnected) return;

    const targetRect = target.getBoundingClientRect();
    const navigatorRect = navigator.getBoundingClientRect();
    const margin = 10;
    const floatingBottomGap = window.innerWidth <= 680 ? 12 : 24;
    const desiredCenter = targetRect.left + targetRect.width / 2;
    const halfWidth = Math.min(
      navigatorRect.width / 2,
      Math.max(0, window.innerWidth / 2 - margin)
    );
    const minimumCenter = margin + halfWidth;
    const maximumCenter = window.innerWidth - margin - halfWidth;
    const center = minimumCenter <= maximumCenter
      ? Math.min(Math.max(desiredCenter, minimumCenter), maximumCenter)
      : window.innerWidth / 2;

    navigator.style.left = `${center}px`;
    const boundaryBottom = Math.max(...session.entries
      .filter(entry => entry.target.isConnected)
      .map(entry => entry.target.getBoundingClientRect().bottom));
    const floatingTop = window.innerHeight - floatingBottomGap - navigatorRect.height;
    navigator.style.top = `${Math.min(floatingTop, boundaryBottom - margin - navigatorRect.height)}px`;
    navigator.style.bottom = 'auto';
  }

  function focusInlineChange(changeId) {
    if (!inlineReviewSession) return;
    const record = findInlineChangeRecord(changeId);
    if (!record) return;
    inlineReviewSession.activeChangeId = changeId;
    scheduleInlineReviewRender();
    requestAnimationFrame(() => {
      if (!inlineReviewSession) return;
      renderInlineReview();
      showInlineTooltip(changeId);
    });
  }

  function applyInlineChange(changeId) {
    const record = findInlineChangeRecord(changeId);
    if (!record || !inlineReviewSession) return;
    const { entry, change } = record;
    try {
      assertInlineEntryCurrent(entry);
      const replacementText = entry.currentText.slice(0, change.start)
        + change.replacement
        + entry.currentText.slice(change.end);
      inlineReviewSession.applying = true;
      writeTargetText(entry.target, replacementText, entry.snapshot.media);
      inlineReviewSession.applying = false;
      const delta = change.replacement.length - (change.end - change.start);
      entry.currentText = replacementText;
      entry.changes = entry.changes.filter(candidate => candidate.id !== change.id).map(candidate => {
        if (candidate.start < change.end) return candidate;
        return { ...candidate, start: candidate.start + delta, end: candidate.end + delta };
      });
      entry.snapshot.signature = createTargetSignature(entry.target);

      const records = getInlineChangeRecords();
      if (!records.length) {
        closeInlineReview();
        showToast('모든 교정을 반영했습니다.', 'success');
        return;
      }
      inlineReviewSession.activeChangeId = records[0].change.id;
      renderInlineReview();
      focusInlineChange(inlineReviewSession.activeChangeId);
    } catch (error) {
      if (inlineReviewSession) inlineReviewSession.applying = false;
      closeInlineReview();
      showToast(error?.message || '교정문을 반영하지 못했습니다.', 'error');
    }
  }

  function applyAllInlineChanges() {
    if (!inlineReviewSession) return;
    const session = inlineReviewSession;
    try {
      session.entries.forEach(assertInlineEntryCurrent);
      session.applying = true;
      for (const entry of session.entries) {
        let text = entry.currentText;
        for (const change of [...entry.changes].sort((left, right) => right.start - left.start)) {
          text = text.slice(0, change.start) + change.replacement + text.slice(change.end);
        }
        writeTargetText(entry.target, text, entry.snapshot.media);
      }
      session.applying = false;
      closeInlineReview();
      showToast('모든 교정을 반영했습니다.', 'success');
    } catch (error) {
      session.applying = false;
      closeInlineReview();
      showToast(error?.message || '교정문을 반영하지 못했습니다.', 'error');
    }
  }

  function assertInlineEntryCurrent(entry) {
    if (!entry.target.isConnected || createTargetSignature(entry.target) !== entry.snapshot.signature) {
      throw new Error('교정 중 입력 내용이 변경되어 결과를 적용하지 않았습니다. 다시 실행해 주세요.');
    }
  }

  function closeInlineReview() {
    cancelAnimationFrame(inlineReviewFrame);
    inlineReviewFrame = 0;
    const session = inlineReviewSession;
    if (!session) return;
    for (const [target, handler] of session.inputHandlers) target.removeEventListener('input', handler);
    session.resizeObserver?.disconnect();
    restoreInlineReviewSafeSpace(session);
    document.removeEventListener('scroll', scheduleInlineReviewRender, true);
    document.removeEventListener('keydown', handleReviewKeydown, true);
    window.removeEventListener('resize', scheduleInlineReviewRender);
    session.layer.remove();
    session.navigator.remove();
    session.tooltip?.remove();
    document.querySelectorAll('.aiang-inline-mirror').forEach(element => element.remove());
    inlineReviewSession = null;
  }

  function scheduleInlineReviewRender() {
    if (!inlineReviewSession || inlineReviewFrame) return;
    inlineReviewFrame = requestAnimationFrame(() => {
      inlineReviewFrame = 0;
      renderInlineReview();
    });
  }

  function renderInlineReview() {
    const session = inlineReviewSession;
    if (!session) return;
    session.layer.replaceChildren();
    document.querySelectorAll('.aiang-inline-mirror').forEach(element => element.remove());

    for (const entry of session.entries) {
      if (!entry.target.isConnected) {
        closeInlineReview();
        return;
      }
      const rectsByChange = entry.target instanceof HTMLInputElement || entry.target instanceof HTMLTextAreaElement
        ? getTextControlChangeRects(entry)
        : getContentEditableChangeRects(entry);
      for (const change of entry.changes) {
        for (const rect of rectsByChange.get(change.id) || []) {
          const marker = document.createElement('button');
          marker.type = 'button';
          marker.className = 'aiang-inline-marker';
          marker.classList.toggle('is-active', change.id === session.activeChangeId);
          marker.dataset.aiangChangeId = change.id;
          marker.setAttribute('aria-label', `${change.original || '삽입 위치'} 교정 제안`);
          marker.style.left = `${rect.left}px`;
          marker.style.top = `${rect.top}px`;
          marker.style.width = `${Math.max(3, rect.width)}px`;
          marker.style.height = `${Math.max(3, rect.height)}px`;
          marker.addEventListener('mouseenter', () => {
            clearTimeout(session.tooltipHideTimer);
            session.activeChangeId = change.id;
            updateInlineNavigator();
            showInlineTooltip(change.id);
            session.layer.querySelectorAll('.aiang-inline-marker').forEach(element => {
              element.classList.toggle('is-active', element.dataset.aiangChangeId === change.id);
            });
          });
          marker.addEventListener('mouseleave', scheduleInlineTooltipHide);
          marker.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            session.activeChangeId = change.id;
            showInlineTooltip(change.id);
          });
          session.layer.append(marker);
        }
      }
    }
    updateInlineNavigator();
    if (session.tooltip && session.activeChangeId) positionInlineTooltip(session.activeChangeId);
  }

  function showInlineTooltip(changeId) {
    const session = inlineReviewSession;
    const record = findInlineChangeRecord(changeId);
    if (!session || !record) return;
    clearTimeout(session.tooltipHideTimer);
    session.tooltip?.remove();

    const tooltip = document.createElement('div');
    tooltip.className = 'aiang-inline-tooltip';
    tooltip.dataset.aiangChangeId = changeId;
    const replacement = document.createElement('button');
    replacement.type = 'button';
    replacement.className = 'aiang-inline-replacement';
    replacement.textContent = record.change.replacement || '(삭제)';
    replacement.title = '이 교정 적용';
    replacement.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      applyInlineChange(changeId);
    });
    tooltip.append(replacement);
    if (record.change.reason) {
      const reason = document.createElement('span');
      reason.className = 'aiang-inline-reason';
      reason.textContent = record.change.reason;
      tooltip.append(reason);
    }
    tooltip.addEventListener('mouseenter', () => clearTimeout(session.tooltipHideTimer));
    tooltip.addEventListener('mouseleave', scheduleInlineTooltipHide);
    document.body.append(tooltip);
    session.tooltip = tooltip;
    positionInlineTooltip(changeId);
  }

  function positionInlineTooltip(changeId) {
    const session = inlineReviewSession;
    const tooltip = session?.tooltip;
    if (!session || !tooltip) return;
    const markers = Array.from(session.layer.querySelectorAll('.aiang-inline-marker'))
      .filter(marker => marker.dataset.aiangChangeId === changeId);
    if (!markers.length) {
      tooltip.hidden = true;
      return;
    }
    tooltip.hidden = false;
    const markerRect = markers[0].getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 10;
    const left = Math.min(
      Math.max(margin, markerRect.left),
      window.innerWidth - tooltipRect.width - margin
    );
    let top = markerRect.top - tooltipRect.height - 8;
    if (top < margin) top = Math.min(window.innerHeight - tooltipRect.height - margin, markerRect.bottom + 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(margin, top)}px`;
  }

  function scheduleInlineTooltipHide() {
    const session = inlineReviewSession;
    if (!session) return;
    clearTimeout(session.tooltipHideTimer);
    session.tooltipHideTimer = window.setTimeout(() => {
      if (!inlineReviewSession) return;
      inlineReviewSession.tooltip?.remove();
      inlineReviewSession.tooltip = null;
    }, 140);
  }

  function getContentEditableChangeRects(entry) {
    const output = new Map();
    const mapped = buildContentEditableMap(entry);
    if (!mapped || mapped.text !== entry.currentText) return output;
    const targetRect = entry.target.getBoundingClientRect();
    for (const change of entry.changes) {
      const startPosition = mapped.units[change.start]?.start
        || mapped.units[change.start - 1]?.end
        || mapped.start;
      const endPosition = change.end > change.start
        ? mapped.units[change.end - 1]?.end
        : startPosition;
      if (!startPosition || !endPosition) continue;
      const range = document.createRange();
      try {
        range.setStart(startPosition.container, startPosition.offset);
        range.setEnd(endPosition.container, endPosition.offset);
      } catch {
        continue;
      }
      let rects = Array.from(range.getClientRects());
      if (!rects.length) rects = [range.getBoundingClientRect()];
      output.set(change.id, rects.map(rect => clipInlineRect(rect, targetRect)).filter(Boolean));
    }
    return output;
  }

  function buildContentEditableMap(entry) {
    const target = entry.target;
    const roots = collectMediaRoots(target);
    const mediaByNode = new Map(roots.map((node, index) => [node, entry.snapshot.media[index]]));
    const units = [];
    const positionBefore = node => ({
      container: node.parentNode,
      offset: Array.prototype.indexOf.call(node.parentNode?.childNodes || [], node)
    });
    const positionAfter = node => {
      const position = positionBefore(node);
      return { ...position, offset: position.offset + 1 };
    };
    const appendVirtual = (text, start, end) => {
      for (const char of text) units.push({ char, start, end });
    };
    const visit = node => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.nodeValue || '';
        for (let index = 0; index < value.length; index += 1) {
          units.push({
            char: value[index],
            start: { container: node, offset: index },
            end: { container: node, offset: index + 1 }
          });
        }
        return;
      }
      if (!(node instanceof Element)) return;
      const media = mediaByNode.get(node);
      if (media) {
        appendVirtual(media.token, positionBefore(node), positionAfter(node));
        if (media.block) appendVirtual('\n', positionAfter(node), positionAfter(node));
        return;
      }
      if (node.tagName === 'BR') {
        appendVirtual('\n', positionBefore(node), positionAfter(node));
        return;
      }
      Array.from(node.childNodes).forEach(visit);
      if (BLOCK_TAGS.has(node.tagName)) appendVirtual('\n', positionAfter(node), positionAfter(node));
    };
    Array.from(target.childNodes).forEach(visit);
    const normalized = normalizeMappedUnits(units);
    return {
      units: normalized,
      text: normalized.map(unit => unit.char).join(''),
      start: { container: target, offset: 0 },
      end: { container: target, offset: target.childNodes.length }
    };
  }

  function normalizeMappedUnits(units) {
    const normalized = [];
    for (const source of units) {
      const unit = source.char === '\u00a0' ? { ...source, char: ' ' } : source;
      if (unit.char === '\n') {
        while (normalized.length && [' ', '\t'].includes(normalized.at(-1).char)) normalized.pop();
        let newlineCount = 0;
        for (let index = normalized.length - 1; index >= 0 && normalized[index].char === '\n'; index -= 1) {
          newlineCount += 1;
        }
        if (newlineCount >= 2) continue;
      }
      normalized.push(unit);
    }
    if (normalized.at(-1)?.char === '\n') normalized.pop();
    return normalized;
  }

  function getTextControlChangeRects(entry) {
    const output = new Map();
    const target = entry.target;
    const targetRect = target.getBoundingClientRect();
    if (targetRect.width <= 0 || targetRect.height <= 0) return output;
    const style = getComputedStyle(target);
    const mirror = document.createElement('div');
    mirror.className = 'aiang-inline-mirror';
    const properties = [
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'fontStretch',
      'lineHeight', 'letterSpacing', 'textAlign', 'textIndent', 'textTransform',
      'wordSpacing', 'tabSize', 'direction'
    ];
    for (const property of properties) mirror.style[property] = style[property];
    Object.assign(mirror.style, {
      position: 'fixed',
      left: `${targetRect.left}px`,
      top: `${targetRect.top}px`,
      width: `${targetRect.width}px`,
      height: `${targetRect.height}px`,
      boxSizing: 'border-box',
      whiteSpace: target instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre',
      overflowWrap: target instanceof HTMLTextAreaElement ? 'break-word' : 'normal',
      wordBreak: style.wordBreak,
      overflow: target instanceof HTMLTextAreaElement ? style.overflow : 'hidden',
      visibility: 'hidden',
      pointerEvents: 'none'
    });

    const spans = new Map();
    let offset = 0;
    for (const change of entry.changes) {
      if (change.start > offset) mirror.append(document.createTextNode(entry.currentText.slice(offset, change.start)));
      const span = document.createElement('span');
      span.dataset.aiangChangeId = change.id;
      span.textContent = entry.currentText.slice(change.start, change.end) || '\u200b';
      mirror.append(span);
      spans.set(change.id, span);
      offset = change.end;
    }
    if (offset < entry.currentText.length) mirror.append(document.createTextNode(entry.currentText.slice(offset)));
    if (target instanceof HTMLTextAreaElement) mirror.append(document.createTextNode('\u200b'));
    document.body.append(mirror);
    mirror.scrollTop = target.scrollTop;
    mirror.scrollLeft = target.scrollLeft;

    for (const [changeId, span] of spans) {
      const rects = Array.from(span.getClientRects())
        .map(rect => clipInlineRect(rect, targetRect))
        .filter(Boolean);
      output.set(changeId, rects);
    }
    return output;
  }

  function clipInlineRect(rect, clippingRect) {
    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const left = Math.max(rect.left, clippingRect.left, viewport.left);
    const top = Math.max(rect.top, clippingRect.top, viewport.top);
    const right = Math.min(rect.right, clippingRect.right, viewport.right);
    const bottom = Math.min(rect.bottom, clippingRect.bottom, viewport.bottom);
    if (right < left || bottom < top) return null;
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    if (width === 0 && height === 0) return null;
    return { left, top, width, height };
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
    header.className = 'aiang-review-header aiang-no-select';
    header.innerHTML = `<div><img class="aiang-review-badge" src="${REVIEW_ICON_URL}" alt=""><strong>${LABELS[action]}</strong></div>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'aiang-close';
    close.setAttribute('aria-label', '닫기');
    close.textContent = '×';
    close.addEventListener('click', closeReview);
    header.append(close);
    panel.append(header);

    const body = document.createElement('div');
    body.className = 'aiang-review-body';

    if (snapshot.media.length) {
      const mediaNote = document.createElement('div');
      mediaNote.className = 'aiang-media-note';
      mediaNote.textContent = `이미지·미디어 ${snapshot.media.length}개는 원래 DOM과 순서를 유지합니다.`;
      body.append(mediaNote);
    }

    if (unchanged) {
      const empty = document.createElement('div');
      empty.className = 'aiang-no-change';
      empty.innerHTML = `${ICONS.check}<strong>수정할 내용이 없습니다.</strong><span>현재 문장을 그대로 사용해도 좋습니다.</span>`;
      body.append(empty);
    } else {
      const comparison = document.createElement('div');
      comparison.className = 'aiang-comparison';
      comparison.append(createTextCard('현재', originalText, correctedText, 'before', snapshot.media));
      comparison.append(createTextCard('제안', correctedText, originalText, 'after', snapshot.media));
      body.append(comparison);

      if (suggestions.length) {
        body.append(createSuggestionsDetails(suggestions));
      }
    }
    panel.append(body);

    const footer = document.createElement('footer');
    footer.className = 'aiang-review-footer aiang-no-select';
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
    header.className = 'aiang-review-header aiang-no-select';
    header.innerHTML = `<div><img class="aiang-review-badge" src="${REVIEW_ICON_URL}" alt=""><strong>맞춤법 검사</strong></div>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'aiang-close';
    close.setAttribute('aria-label', '닫기');
    close.textContent = '×';
    close.addEventListener('click', closeReview);
    header.append(close);
    panel.append(header);

    const body = document.createElement('div');
    body.className = 'aiang-review-body';

    const mediaCount = results.reduce((count, result) => count + result.snapshot.media.length, 0);
    if (mediaCount) {
      const mediaNote = document.createElement('div');
      mediaNote.className = 'aiang-media-note';
      mediaNote.textContent = `내용의 이미지·미디어 ${mediaCount}개는 원래 DOM과 순서를 유지합니다.`;
      body.append(mediaNote);
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
    body.append(sections);
    panel.append(body);

    const footer = document.createElement('footer');
    footer.className = 'aiang-review-footer aiang-no-select';
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
    header.className = 'aiang-review-header aiang-no-select';
    header.innerHTML = `<div><img class="aiang-review-badge" src="${REVIEW_ICON_URL}" alt=""><strong>글 제목 추천</strong></div>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'aiang-close';
    close.setAttribute('aria-label', '닫기');
    close.textContent = '×';
    close.addEventListener('click', closeReview);
    header.append(close);
    panel.append(header);

    const body = document.createElement('div');
    body.className = 'aiang-review-body';

    const intro = document.createElement('p');
    intro.className = 'aiang-title-intro';
    intro.textContent = '사용할 제목을 선택하면 제목 입력창에 바로 반영합니다.';
    body.append(intro);

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
    body.append(list);
    panel.append(body);

    const footer = document.createElement('footer');
    footer.className = 'aiang-review-footer aiang-no-select';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'aiang-secondary';
    cancel.textContent = '취소';
    cancel.addEventListener('click', closeReview);
    footer.append(cancel);
    panel.append(footer);
    showModalPanel(panel);
  }

  function showPostSummary(summary, title = POST_SUMMARY_ACTION.label) {
    const text = String(summary || '').trim();
    if (!text) throw new Error('AI가 빈 요약을 반환했습니다. 다시 시도해 주세요.');

    closeReview();
    const panel = document.createElement('section');
    panel.className = 'aiang-review aiang-review-modal aiang-title-review aiang-summary-review';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', `${title} 결과`);

    const header = document.createElement('header');
    header.className = 'aiang-review-header aiang-no-select';
    header.innerHTML = `<div><img class="aiang-review-badge" src="${REVIEW_ICON_URL}" alt=""><strong>${title}</strong></div>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'aiang-close';
    close.setAttribute('aria-label', '닫기');
    close.textContent = '×';
    close.addEventListener('click', closeReview);
    header.append(close);
    panel.append(header);

    const body = document.createElement('div');
    body.className = 'aiang-review-body';
    const content = document.createElement('div');
    content.className = 'aiang-summary-content';
    renderSummaryMarkdown(content, text);
    body.append(content);
    panel.append(body);

    const footer = document.createElement('footer');
    footer.className = 'aiang-review-footer aiang-no-select';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'aiang-secondary';
    done.textContent = '닫기';
    done.addEventListener('click', closeReview);
    footer.append(done);
    panel.append(footer);
    showModalPanel(panel);
  }

  function renderSummaryMarkdown(container, markdown) {
    container.replaceChildren();
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      const fence = line.match(/^\s*```([\w+-]*)\s*$/);
      if (fence) {
        const codeLines = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) codeLines.push(lines[index++]);
        if (index < lines.length) index += 1;
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        if (fence[1]) code.className = `language-${fence[1].toLowerCase()}`;
        code.textContent = codeLines.join('\n');
        pre.append(code);
        container.append(pre);
        continue;
      }

      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        const element = document.createElement(`h${heading[1].length}`);
        appendSummaryInlineMarkdown(element, heading[2]);
        container.append(element);
        index += 1;
        continue;
      }

      if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        container.append(document.createElement('hr'));
        index += 1;
        continue;
      }

      if (line.includes('|') && index + 1 < lines.length && isMarkdownTableDivider(lines[index + 1])) {
        const tableLines = [line];
        index += 2;
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) tableLines.push(lines[index++]);
        container.append(createSummaryMarkdownTable(tableLines));
        continue;
      }

      if (/^\s*>/.test(line)) {
        const quoteLines = [];
        while (index < lines.length && /^\s*>/.test(lines[index])) {
          quoteLines.push(lines[index++].replace(/^\s*>\s?/, ''));
        }
        const blockquote = document.createElement('blockquote');
        renderSummaryMarkdown(blockquote, quoteLines.join('\n'));
        container.append(blockquote);
        continue;
      }

      const listMatch = line.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
      if (listMatch) {
        const ordered = Boolean(listMatch[2]);
        const list = document.createElement(ordered ? 'ol' : 'ul');
        while (index < lines.length) {
          const itemMatch = lines[index].match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
          if (!itemMatch || Boolean(itemMatch[2]) !== ordered) break;
          const item = document.createElement('li');
          appendSummaryInlineMarkdown(item, itemMatch[3]);
          list.append(item);
          index += 1;
        }
        container.append(list);
        continue;
      }

      const paragraphLines = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() && !isSummaryMarkdownBlockStart(lines, index)) {
        paragraphLines.push(lines[index].trim());
        index += 1;
      }
      const paragraph = document.createElement('p');
      paragraphLines.forEach((paragraphLine, lineIndex) => {
        if (lineIndex) paragraph.append(document.createElement('br'));
        appendSummaryInlineMarkdown(paragraph, paragraphLine);
      });
      container.append(paragraph);
    }
  }

  function isSummaryMarkdownBlockStart(lines, index) {
    const line = lines[index];
    return /^\s*```/.test(line)
      || /^\s{0,3}#{1,6}\s+/.test(line)
      || /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
      || /^\s*>/.test(line)
      || /^\s*(?:[-+*]|\d+[.)])\s+/.test(line)
      || (line.includes('|') && index + 1 < lines.length && isMarkdownTableDivider(lines[index + 1]));
  }

  function isMarkdownTableDivider(line) {
    const cells = splitMarkdownTableRow(line);
    return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
  }

  function splitMarkdownTableRow(line) {
    return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
  }

  function createSummaryMarkdownTable(lines) {
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    const rows = lines.map(splitMarkdownTableRow);
    const appendRow = (parent, cells, cellName) => {
      const row = document.createElement('tr');
      cells.forEach(value => {
        const cell = document.createElement(cellName);
        appendSummaryInlineMarkdown(cell, value);
        row.append(cell);
      });
      parent.append(row);
    };
    appendRow(thead, rows[0], 'th');
    rows.slice(1).forEach(row => appendRow(tbody, row, 'td'));
    table.append(thead, tbody);
    return table;
  }

  function appendSummaryInlineMarkdown(parent, source) {
    const text = String(source || '');
    const tokenPattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\s]+\)|\*[^*\n]+\*|_[^_\n]+_)/g;
    let offset = 0;
    for (const match of text.matchAll(tokenPattern)) {
      if (match.index > offset) parent.append(document.createTextNode(text.slice(offset, match.index)));
      const token = match[0];
      if (token.startsWith('`')) {
        const code = document.createElement('code');
        code.textContent = token.slice(1, -1);
        parent.append(code);
      } else if (token.startsWith('**') || token.startsWith('__')) {
        const strong = document.createElement('strong');
        appendSummaryInlineMarkdown(strong, token.slice(2, -2));
        parent.append(strong);
      } else if (token.startsWith('~~')) {
        const deletion = document.createElement('del');
        appendSummaryInlineMarkdown(deletion, token.slice(2, -2));
        parent.append(deletion);
      } else if (token.startsWith('[')) {
        const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        const link = linkMatch ? createSafeSummaryLink(linkMatch[1], linkMatch[2]) : null;
        parent.append(link || document.createTextNode(linkMatch?.[1] || token));
      } else {
        const emphasis = document.createElement('em');
        appendSummaryInlineMarkdown(emphasis, token.slice(1, -1));
        parent.append(emphasis);
      }
      offset = match.index + token.length;
    }
    if (offset < text.length) parent.append(document.createTextNode(text.slice(offset)));
  }

  function createSafeSummaryLink(label, href) {
    try {
      const url = new URL(href, location.href);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
      const link = document.createElement('a');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = label;
      return link;
    } catch {
      return null;
    }
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
    closeInlineReview();
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
    const scrollState = captureScrollState(target);
    try {
      target.focus({ preventScroll: true });
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
    } finally {
      restoreScrollState(scrollState);
    }
  }

  function captureScrollState(target) {
    const elements = [];
    for (let element = target; element; element = element.parentElement) elements.push(element);
    if (document.scrollingElement && !elements.includes(document.scrollingElement)) {
      elements.push(document.scrollingElement);
    }
    return {
      viewportLeft: window.scrollX,
      viewportTop: window.scrollY,
      elements: elements.map(element => ({
        element,
        left: element.scrollLeft,
        top: element.scrollTop
      }))
    };
  }

  function restoreScrollState(state) {
    for (const item of state.elements) {
      item.element.scrollLeft = item.left;
      item.element.scrollTop = item.top;
    }
    if (window.scrollX !== state.viewportLeft || window.scrollY !== state.viewportTop) {
      window.scrollTo(state.viewportLeft, state.viewportTop);
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
    const previous = document.querySelector('.aiang-toast');
    previous?._aiangCleanup?.();
    previous?.remove();
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
    let positionFrame = 0;
    let removeTimer = 0;
    const schedulePosition = () => {
      if (positionFrame || !toast.isConnected) return;
      positionFrame = requestAnimationFrame(() => {
        positionFrame = 0;
        positionToastAboveToolbar(toast);
      });
    };
    const cleanup = () => {
      clearTimeout(removeTimer);
      cancelAnimationFrame(positionFrame);
      document.removeEventListener('scroll', schedulePosition, true);
      window.removeEventListener('resize', schedulePosition);
    };
    toast._aiangCleanup = cleanup;
    document.addEventListener('scroll', schedulePosition, true);
    window.addEventListener('resize', schedulePosition);
    positionToastAboveToolbar(toast);
    removeTimer = window.setTimeout(() => {
      cleanup();
      toast.remove();
    }, duration);
  }

  function positionToastAboveToolbar(toast) {
    if (!toast?.isConnected) return;
    const visibleToolbars = Array.from(document.querySelectorAll('.aiang-toolbar'))
      .filter(toolbar => {
        const rect = toolbar.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
      });
    const preferredRect = toastToolbarAnchor?.isConnected ? toastToolbarAnchor.getBoundingClientRect() : null;
    const anchor = preferredRect?.width > 0 && preferredRect?.height > 0
      && preferredRect.bottom > 0 && preferredRect.top < window.innerHeight
      ? toastToolbarAnchor
      : visibleToolbars[0];
    if (!anchor) {
      toast.style.left = '50%';
      toast.style.right = 'auto';
      toast.style.top = 'auto';
      toast.style.bottom = '72px';
      toast.style.transform = 'translateX(-50%)';
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const toastRect = toast.getBoundingClientRect();
    const margin = 10;
    const left = Math.min(
      Math.max(margin, anchorRect.left + (anchorRect.width - toastRect.width) / 2),
      window.innerWidth - toastRect.width - margin
    );
    let top = anchorRect.top - toastRect.height - margin;
    if (top < margin) top = Math.min(window.innerHeight - toastRect.height - margin, anchorRect.bottom + margin);
    toast.style.left = `${left}px`;
    toast.style.right = 'auto';
    toast.style.top = `${Math.max(margin, top)}px`;
    toast.style.bottom = 'auto';
    toast.style.transform = 'none';
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
