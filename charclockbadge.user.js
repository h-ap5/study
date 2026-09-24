// ==UserScript==
// @name         Crack Char Clock Badge (크랙 글자수·시간 배지) 🕒
// @namespace    crack char clock badge
// @version      1.2.8-integrated.1
// @description  글자수·시간 배지, 선택 글자수, 입력 감싸기, 수정창 줄바꿈 붙여넣기를 통합합니다.
// @author       Assistant
// @match        https://crack.wrtn.ai/*
// @match        https://*.crack.wrtn.ai/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @license      MIT
// ==/UserScript==
/*
 * Integrated from the enabled 2026-09-24 Tampermonkey backup versions.
 * Preserves the Char Clock Badge script identity and GM settings; the other
 * components retain their DOM IDs, CSS, localStorage keys and interaction UI.
 * No remote @updateURL is set because its upstream contains only one component.
 */
(() => {
  'use strict';
  const INTEGRATED_GUARD = '__crack_input_utilities_integrated_20260924__';
  if (globalThis[INTEGRATED_GUARD]) return;
  globalThis[INTEGRATED_GUARD] = true;
  const onMainHost = location.hostname === 'crack.wrtn.ai';
  // Edit Paste Linebreak Fix v0.2.0: attach capture listener immediately.
  if (onMainHost) {
(() => {
  'use strict';

  const PREFIX = '[Crack Edit Paste Fix]';

  function normalizeText(value) {
    return String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, '');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function isVisible(el) {
    if (!(el instanceof HTMLElement) || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function buttonText(el) {
    return String(el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function hasEditDoneButton(root) {
    if (!(root instanceof Element)) return false;
    return Array.from(root.querySelectorAll('button, [role="button"]'))
      .some(el => isVisible(el) && buttonText(el) === '수정 완료');
  }

  function findEditorFromEventTarget(target) {
    if (!(target instanceof Element)) return null;

    const direct = target.closest?.(
      '.tiptap.ProseMirror[contenteditable="true"], .ProseMirror[contenteditable="true"]'
    );
    if (direct) return direct;

    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active.matches?.('.tiptap.ProseMirror[contenteditable="true"], .ProseMirror[contenteditable="true"]')
    ) {
      return active;
    }

    return null;
  }

  function isCrackEditEditor(editor) {
    if (!(editor instanceof HTMLElement)) return false;

    if (!editor.matches(
      '.tiptap.ProseMirror[contenteditable="true"], .ProseMirror[contenteditable="true"]'
    )) {
      return false;
    }

    const dialog = editor.closest('[role="dialog"]');
    if (dialog && hasEditDoneButton(dialog)) return true;

    let node = editor.parentElement;
    for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
      if (hasEditDoneButton(node)) return true;
    }

    const visibleEditors = Array.from(
      document.querySelectorAll(
        '.tiptap.ProseMirror[contenteditable="true"], .ProseMirror[contenteditable="true"]'
      )
    ).filter(isVisible);

    const visibleDone = Array.from(
      document.querySelectorAll('button, [role="button"]')
    ).some(el => isVisible(el) && buttonText(el) === '수정 완료');

    return visibleDone && visibleEditors.length === 1 && visibleEditors[0] === editor;
  }

  /*
   * 핵심:
   * 절대로 줄마다 <p>를 만들지 않는다.
   *
   * Crack 저장기가 ProseMirror의 paragraph 경계를 빈 줄로 직렬화하는 것으로 보여,
   * 전문 전체를 하나의 <p> 안에 두고 원문의 모든 개행을 <br>로 표현한다.
   *
   * 원문:
   * A
   * B
   *
   * C
   *
   * DOM:
   * <p>A<br>B<br><br>C</p>
   */
  function plainTextToSingleParagraphHtml(text) {
    const value = normalizeText(text);

    if (value === '') {
      return '<p><br></p>';
    }

    return `<p>${value.split('\n').map(escapeHtml).join('<br>')}</p>`;
  }

  function insertHtmlAtSelection(editor, html, plainText) {
    editor.focus();

    try {
      if (document.queryCommandSupported?.('insertHTML')) {
        const ok = document.execCommand('insertHTML', false, html);
        if (ok) return true;
      }
    } catch (error) {
      console.warn(PREFIX, 'insertHTML 실패, fallback 사용', error);
    }

    try {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;

      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) return false;

      range.deleteContents();

      const template = document.createElement('template');
      template.innerHTML = html;

      const fragment = template.content;
      const lastNode = fragment.lastChild;
      range.insertNode(fragment);

      if (lastNode) {
        range.setStartAfter(lastNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      try {
        editor.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertFromPaste',
          data: plainText,
        }));
      } catch (_) {
        editor.dispatchEvent(new Event('input', {
          bubbles: true,
          composed: true,
        }));
      }

      return true;
    } catch (error) {
      console.error(PREFIX, 'fallback 삽입 실패', error);
      return false;
    }
  }

  function handlePaste(event) {
    const editor = findEditorFromEventTarget(event.target);
    if (!editor || !isCrackEditEditor(editor)) return;

    const clipboard = event.clipboardData;
    if (!clipboard) return;

    const plain = normalizeText(clipboard.getData('text/plain'));

    // 이미지/파일 붙여넣기, 단일 한 줄 텍스트는 Crack 기본 동작 유지.
    if (!plain || !plain.includes('\n')) return;

    const html = plainTextToSingleParagraphHtml(plain);

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const ok = insertHtmlAtSelection(editor, html, plain);

    if (ok) {
      console.debug(PREFIX, 'v0.2.0 단일 문단 줄바꿈 보존 적용');
    } else {
      console.warn(PREFIX, '보정 붙여넣기 실패');
    }
  }

  // ProseMirror의 기본 paste 처리보다 먼저 가로챈다.
  document.addEventListener('paste', handlePaste, true);

  console.debug(PREFIX, 'loaded v0.2.0');
})();
  }

  // Char Clock Badge v1.2.8: original episode-route scope.
  if (onMainHost && /^\/stories\/[^/]+\/episodes\//.test(location.pathname)) {
(function () {
    'use strict';

    const API_BASE = 'https://crack-api.wrtn.ai/crack-gen/v3';
    const SCRIPT_NS = 'crack-char-clock-badge';
    const LOG_PREFIX = '[Crack Char Clock Badge]';
    const BADGE_CLASS = `${SCRIPT_NS}-badge`;
    const COMPARE_BUTTON_RE = /답변\s*비교\s*(\d+)\s*\/\s*(\d+)/;
    const USER_PAD_ABS_PLACEMENT = 'user-pad-abs';
    const USER_NOVEL_PAD_ABS_PLACEMENT = 'user-novel-pad-abs';
    const USER_FLOW_ROW_CLASS = `${SCRIPT_NS}-flow-row`;
    const USER_BUBBLE_FLOW_PLACEMENT = 'user-bubble-flow';
    const USER_NOVEL_FLOW_PLACEMENT = 'user-novel-flow';
    const MESSAGE_SELECTOR = 'div[data-message-group-id]';
    const MESSAGE_LIMIT = 200;

    const SETTING_KEYS = {
        showChars: `${SCRIPT_NS}:showChars`,
        showTime: `${SCRIPT_NS}:showTime`
    };

    const DEFAULT_SETTINGS = {
        showChars: true,
        showTime: true
    };

    // 답변 비교 n/m 상태에서 data-message-group-id가 실제 현재 답변 ID가 아닐 수 있어서,
    // API 메시지 목록을 읽어 현재 표시 중인 리롤 답변의 시간/글자수를 보정합니다.
    // API 실패 시에는 DOM의 data-message-group-id 기준 시간으로 fallback합니다.
    const RESOLVE_COMPARE_BY_API = true;

    // 새 답변이 생성된 직후에는 기존 messages API 캐시에 새 messageId가 없을 수 있습니다.
    // 글자수 미해결 상태에서만 캐시를 제한적으로 새로고침해, 새 메시지 글자수가 계속 time-only로 남는 문제를 막습니다.
    const API_FORCE_REFRESH_MIN_INTERVAL = 1600;

    let lastUrlKey = getUrlKey();
    let scanTimer = null;
    let apiCache = null;
    let apiPromise = null;
    let forcedApiRefreshPromise = null;
    let lastForcedApiRefreshAt = 0;
    const resultCache = new Map();
    const queuedGroups = new Set();
    const retryGroups = new Set();
    let fullScanPending = false;

    function getUrlKey() {
        return location.origin + location.pathname + location.search;
    }

    function resetPageCacheIfNeeded() {
        const key = getUrlKey();
        if (key === lastUrlKey) return;

        lastUrlKey = key;
        retryGroups.clear();
        apiCache = null;
        apiPromise = null;
        resultCache.clear();
    }

    function legacySettingKey(name) {
        const oldNs = 'crack-message-info-badge';
        if (name === 'showChars') return `${oldNs}:showChars`;
        if (name === 'showTime') return `${oldNs}:showTime`;
        return '';
    }

    function getSetting(name) {
        const key = SETTING_KEYS[name];
        const fallback = DEFAULT_SETTINGS[name];
        const legacyKey = legacySettingKey(name);

        try {
            if (typeof GM_getValue === 'function') {
                const saved = GM_getValue(key, undefined);
                if (typeof saved !== 'undefined') return saved !== false;

                if (legacyKey) {
                    const legacy = GM_getValue(legacyKey, undefined);
                    if (typeof legacy !== 'undefined') return legacy !== false;
                }

                return fallback;
            }
        } catch (e) {}

        try {
            const saved = localStorage.getItem(key);
            if (saved != null) return saved !== 'false';

            if (legacyKey) {
                const legacy = localStorage.getItem(legacyKey);
                if (legacy != null) return legacy !== 'false';
            }

            return fallback;
        } catch (e) {
            return fallback;
        }
    }

    function setSetting(name, value) {
        const key = SETTING_KEYS[name];
        const bool = !!value;

        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(key, bool);
            }
        } catch (e) {}

        try {
            localStorage.setItem(key, String(bool));
        } catch (e) {}
    }

    function anyInfoEnabled() {
        return getSetting('showChars') || getSetting('showTime');
    }

    function needApiForInfo() {
        // 글자수뿐 아니라 역할 보정에도 messages API를 씁니다.
        return anyInfoEnabled();
    }

    function toggleSetting(name, label) {
        const next = !getSetting(name);
        setSetting(name, next);

        // 설정 변경 후 기존 캐시를 버려야 껐다 켰을 때 글자수/API 보정이 즉시 반영됩니다.
        resultCache.clear();

        if (!anyInfoEnabled()) {
            retryGroups.clear();
            removeAllBadges();
        } else {
            scanAllVisibleGroups();
        }

        console.info(`${LOG_PREFIX} ${label}: ${next ? 'ON' : 'OFF'}`);
    }

    function registerMenuCommands() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        GM_registerMenuCommand('글자수 On/Off', () => {
            toggleSetting('showChars', '글자수');
        });

        GM_registerMenuCommand('생성 시간 On/Off', () => {
            toggleSetting('showTime', '생성 시간');
        });
    }

    function normalizeText(text = '') {
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function countChars(text = '') {
        // [...str] 기준이라 이모지/서로게이트 페어를 1글자로 세는 쪽에 가깝습니다.
        return [...String(text || '')].length;
    }

    function formatNumber(value) {
        if (typeof value !== 'number' || !Number.isFinite(value)) return '';
        return value.toLocaleString('ko-KR');
    }

    function getCookie(name) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    }

    function getCommonHeaders() {
        const token = getCookie('access_token');
        const headers = {
            accept: 'application/json, text/plain, */*',
            platform: 'web',
            'wrtn-locale': 'ko-KR'
        };

        if (token) headers.authorization = `Bearer ${token}`;

        const wrtnId = getCookie('__w_id');
        if (wrtnId) headers['x-wrtn-id'] = wrtnId;

        const mixpanelId = getCookie('Mixpanel-Distinct-Id');
        if (mixpanelId) headers['mixpanel-distinct-id'] = mixpanelId;

        return headers;
    }

    function extractChatIdFromUrl(url = location.href) {
        const str = String(url || '');
        const patterns = [
            /\/episodes\/([a-f0-9]{24})(?:[/?#]|$)/i,
            /\/chats\/([a-f0-9]{24})(?:[/?#]|$)/i,
            /"chatId":"([a-f0-9]{24})"/i
        ];

        for (const pattern of patterns) {
            const match = str.match(pattern);
            if (match) return match[1];
        }

        return null;
    }

    function findChatId() {
        const fromUrl = extractChatIdFromUrl();
        if (fromUrl) return fromUrl;

        try {
            return extractChatIdFromUrl(document.documentElement.innerHTML);
        } catch (e) {
            return null;
        }
    }

    async function fetchAllMessagesOnce(options = {}) {
        const force = !!options.force;

        if (!force && apiCache) return apiCache;
        if (apiPromise) return apiPromise;

        if (force) apiCache = null;

        const chatId = findChatId();
        if (!chatId) throw new Error('chatId not found');

        apiPromise = fetch(`${API_BASE}/chats/${chatId}/messages?limit=${MESSAGE_LIMIT}`, {
            method: 'GET',
            credentials: 'include',
            headers: getCommonHeaders()
        })
            .then(async res => {
                if (!res.ok) throw new Error(`messages fetch failed: ${res.status}`);
                const json = await res.json();
                const messages = json?.data?.messages || json?.messages || [];
                const list = Array.isArray(messages) ? messages : [];
                apiCache = buildApiCache(list);
                return apiCache;
            })
            .catch(err => {
                console.warn(`${LOG_PREFIX} API resolve failed:`, err);
                apiCache = null;
                throw err;
            })
            .finally(() => {
                apiPromise = null;
            });

        return apiPromise;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function refreshApiCacheThrottled() {
        if (forcedApiRefreshPromise) return forcedApiRefreshPromise;

        forcedApiRefreshPromise = (async () => {
            const elapsed = Date.now() - lastForcedApiRefreshAt;
            const wait = Math.max(0, API_FORCE_REFRESH_MIN_INTERVAL - elapsed);
            if (wait > 0) await sleep(wait);

            lastForcedApiRefreshAt = Date.now();
            return fetchAllMessagesOnce({ force: true });
        })().finally(() => {
            forcedApiRefreshPromise = null;
        });

        return forcedApiRefreshPromise;
    }

    function hasResolvedChars(resolved) {
        return typeof resolved?.charCount === 'number' && Number.isFinite(resolved.charCount);
    }

    function buildApiCache(messages) {
        const idMap = new Map();
        const apiIndexMap = new Map();

        messages.forEach((msg, index) => {
            const id = messageIdOf(msg);
            if (!id) return;
            idMap.set(id, msg);
            apiIndexMap.set(id, index);
        });

        return { messages, idMap, apiIndexMap };
    }

    function messageIdOf(msg) {
        return msg?._id || msg?.id || msg?.messageId || '';
    }

    function isAssistantMessage(msg) {
        return String(msg?.role || '').toLowerCase() === 'assistant';
    }

    function isUserResolvedMessage(resolved) {
        return String(resolved?.role || '').toLowerCase() === 'user';
    }

    function messageContentOf(msg) {
        if (!msg) return '';

        const direct = msg.content ?? msg.text ?? msg.message ?? msg.answer ?? msg.response ?? '';
        if (typeof direct === 'string') return direct;

        if (Array.isArray(direct)) {
            return direct.map(item => {
                if (typeof item === 'string') return item;
                if (item && typeof item === 'object') {
                    return item.text || item.content || item.value || '';
                }
                return '';
            }).join('');
        }

        if (direct && typeof direct === 'object') {
            return direct.text || direct.content || direct.value || '';
        }

        return '';
    }

    function sortVariantsUiOrder(variants, apiIndexMap) {
        // 크랙 메시지 API는 보통 최신 리롤이 앞에 옵니다.
        // UI의 답변 1 → n 순서로 보려면 API index가 큰 것부터 정렬합니다.
        return [...variants].sort((a, b) => {
            const ai = apiIndexMap.get(messageIdOf(a)) ?? 0;
            const bi = apiIndexMap.get(messageIdOf(b)) ?? 0;
            return bi - ai;
        });
    }

    function getGroupMessageId(group) {
        return group?.getAttribute?.('data-message-group-id') || '';
    }

    function isObjectId(value = '') {
        return /^[a-f0-9]{24}$/i.test(String(value || ''));
    }

    function objectIdToDate(objectId = '') {
        if (!isObjectId(objectId)) return null;

        const seconds = parseInt(String(objectId).slice(0, 8), 16);
        if (!Number.isFinite(seconds) || seconds <= 0) return null;

        const date = new Date(seconds * 1000);
        if (Number.isNaN(date.getTime())) return null;

        return date;
    }

    function findCompareButtonInGroup(group) {
        if (!group) return null;

        const buttons = Array.from(group.querySelectorAll('button'));
        return buttons.find(btn => COMPARE_BUTTON_RE.test(normalizeText(btn.textContent || ''))) || null;
    }

    function parseCompareButton(group) {
        const btn = findCompareButtonInGroup(group);
        if (!btn) return null;

        const text = normalizeText(btn.textContent || '');
        const match = text.match(COMPARE_BUTTON_RE);
        if (!match) return null;

        return {
            current: Number(match[1]),
            total: Number(match[2])
        };
    }

    function makeCacheKey(group) {
        const id = getGroupMessageId(group);
        const compare = parseCompareButton(group);
        return compare ? `${id}:${compare.current}/${compare.total}` : id;
    }

    function resolveByDomId(group) {
        const domId = getGroupMessageId(group);
        const date = objectIdToDate(domId);

        return {
            messageId: domId,
            date,
            source: 'dom',
            role: null,
            note: date ? 'DOM messageId 기준 생성 시각' : 'ObjectId 형식이 아니어서 시간 계산 불가',
            charCount: null
        };
    }

    function enrichResolvedWithMessage(resolved, msg, sourceNote) {
        if (!msg) return resolved;

        const currentId = messageIdOf(msg) || resolved.messageId;
        const content = messageContentOf(msg);

        return {
            ...resolved,
            messageId: currentId,
            date: objectIdToDate(currentId) || resolved.date,
            source: sourceNote || resolved.source,
            role: String(msg?.role || resolved.role || '').toLowerCase() || null,
            note: sourceNote === 'api-current-reroll'
                ? resolved.note
                : 'messages API 기준 메시지 본문/생성 시각',
            charCount: content ? countChars(content) : null
        };
    }

    async function resolveCurrentMessageInfo(group, options = {}) {
        const fallback = resolveByDomId(group);
        const compare = parseCompareButton(group);

        const shouldUseApi =
            needApiForInfo() ||
            (RESOLVE_COMPARE_BY_API && compare && compare.total > 1);

        if (!shouldUseApi) return fallback;
        if (!fallback.messageId || !isObjectId(fallback.messageId)) return fallback;

        try {
            const { messages, idMap, apiIndexMap } = await fetchAllMessagesOnce(options);

            if (RESOLVE_COMPARE_BY_API && compare && compare.total > 1) {
                const anchor = idMap.get(fallback.messageId);

                if (!anchor || !isAssistantMessage(anchor) || !anchor.parentTurnId) {
                    return enrichResolvedWithMessage(fallback, idMap.get(fallback.messageId), 'api-message');
                }

                const variants = messages.filter(msg =>
                    isAssistantMessage(msg) &&
                    msg.parentTurnId &&
                    msg.parentTurnId === anchor.parentTurnId &&
                    messageIdOf(msg)
                );

                if (variants.length !== compare.total) {
                    return enrichResolvedWithMessage(fallback, idMap.get(fallback.messageId), 'api-message');
                }

                const ordered = sortVariantsUiOrder(variants, apiIndexMap);
                const currentMsg = ordered[compare.current - 1];
                const currentId = messageIdOf(currentMsg);
                const date = objectIdToDate(currentId);

                if (!date) {
                    return enrichResolvedWithMessage(fallback, currentMsg, 'api-current-reroll');
                }

                return enrichResolvedWithMessage({
                    messageId: currentId,
                    date,
                    source: 'api-current-reroll',
                    note: `답변 비교 ${compare.current}/${compare.total} 현재 답변 기준`
                }, currentMsg, 'api-current-reroll');
            }

            return enrichResolvedWithMessage(fallback, idMap.get(fallback.messageId), 'api-message');
        } catch (e) {
            return fallback;
        }
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function formatBadgeDate(date) {
        if (!date) return '';

        // 요청 형식: 0000.00.00. 24:00
        // 실제 표기는 24시간제 HH:mm으로 표시합니다.
        return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}. ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    }

    function formatFullDate(date) {
        if (!date) return '';

        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
            `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
    }

    function buildBadgeParts(resolved) {
        const parts = [];

        // 요청 순서: 몇 자 · 시간
        if (getSetting('showChars') && hasResolvedChars(resolved)) {
            parts.push(`${formatNumber(resolved.charCount)}자`);
        }

        if (getSetting('showTime') && resolved?.date) {
            parts.push(formatBadgeDate(resolved.date));
        }

        return parts;
    }

    function findMessageOptionAnchor(group) {
        if (!group) return null;

        const optionButton = group.querySelector('button[aria-label="메시지 옵션"]');
        if (!optionButton) return null;

        return optionButton.closest('.dropdown-button') || optionButton;
    }

    function findRerollButtonAnchor(group) {
        if (!group) return null;

        const buttons = Array.from(group.querySelectorAll('button'));
        const compareButton = findCompareButtonInGroup(group);
        const optionButton = group.querySelector('button[aria-label="메시지 옵션"]');

        return buttons.find(btn => {
            if (!btn || btn === compareButton || btn === optionButton) return false;
            if (btn.closest('.dropdown-button')) return false;

            const text = normalizeText(btn.textContent || '');
            if (COMPARE_BUTTON_RE.test(text)) return false;

            const html = btn.innerHTML || '';
            return (
                html.includes('M3.8 12a8.2') ||
                html.includes('M3.8 12') ||
                html.includes('A9.8 9.8') ||
                html.includes('A8.21 8.21') ||
                /viewBox="0 0 24 24"[\s\S]*?M3\.8\s+12/.test(html)
            );
        }) || null;
    }

    function findSmartAnchor(group) {
        // AI 답변: 답변 비교 버튼 왼쪽 → 리롤 버튼 왼쪽 → ... 메뉴 왼쪽
        // 유저 메시지/지나간 메시지: ... 메뉴 왼쪽
        const compareButton = findCompareButtonInGroup(group);
        if (compareButton) {
            return {
                anchor: compareButton,
                placement: 'compare-left'
            };
        }

        const rerollButton = findRerollButtonAnchor(group);
        if (rerollButton) {
            return {
                anchor: rerollButton,
                placement: 'reroll-left'
            };
        }

        const optionAnchor = findMessageOptionAnchor(group);
        if (optionAnchor) {
            return {
                anchor: optionAnchor,
                placement: 'option-left'
            };
        }

        return {
            anchor: null,
            placement: 'fallback'
        };
    }

    function getVisibleRect(el) {
        if (!el || typeof el.getBoundingClientRect !== 'function') return null;
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        return rect;
    }

    function findUserPadAbsContainer(group) {
        if (!group) return null;

        // UI 2 기준 유저 말풍선 바깥 wrapper:
        // div.flex.flex-col.gap-2.relative.mb-5.w-full.items-end
        // 이미 relative + mb-5를 가진 이 컨테이너의 기존 아래 여백을 배지 자리로 재활용합니다.
        const selectors = [
            ':scope > div.relative.mb-5.w-full.items-end',
            ':scope > div.relative.mb-5.items-end',
            'div.relative.mb-5.w-full.items-end',
            'div.relative.mb-5.items-end'
        ];

        for (const selector of selectors) {
            try {
                const found = group.querySelector(selector);
                if (found && getVisibleRect(found)) return found;
            } catch (e) {}
        }

        return null;
    }

    function ensurePositionAnchor(el) {
        if (!el) return;

        try {
            const position = getComputedStyle(el).position;
            if (!position || position === 'static') {
                el.style.position = 'relative';
            }
        } catch (e) {
            el.style.position = 'relative';
        }
    }

    function findUserNovelPadAbsContainer(group) {
        if (!group) return null;

        // UI 2 소설형 유저 메시지 기준 박스:
        // div.flex.flex-row.gap-4.w-full.items-end.justify-between.border-y.border-outline_tertiary.py-5
        // 이 박스의 아래쪽 py-5 패딩 영역을 배지 자리로 재활용합니다.
        // 말풍선형은 mb-5 + bg-surface_chat_secondary 쪽을 쓰므로 여기와 분리됩니다.
        const selectors = [
            ':scope div.flex.flex-row.gap-4.w-full.items-end.justify-between.border-y.border-outline_tertiary.py-5',
            ':scope div.border-y.border-outline_tertiary.py-5',
            ':scope div[class*="border-y"][class*="border-outline_tertiary"][class*="py-5"]',
            ':scope div[class*="border-y"][class*="py-5"]'
        ];

        for (const selector of selectors) {
            try {
                const found = group.querySelector(selector);
                if (found && getVisibleRect(found)) return found;
            } catch (e) {}
        }

        return null;
    }

    function ensureUserFlowRowAfter(box) {
        const parent = box?.parentElement;
        if (!parent) return null;

        let row = box.nextElementSibling;
        if (!row || !row.classList?.contains(USER_FLOW_ROW_CLASS)) {
            row = document.createElement('div');
            row.className = USER_FLOW_ROW_CLASS;
            parent.insertBefore(row, box.nextSibling);
        }
        return row;
    }

    function ensureUserFlowRowInside(wrap) {
        if (!wrap) return null;

        let row = wrap.querySelector(`:scope > .${USER_FLOW_ROW_CLASS}`);
        if (!row) {
            row = document.createElement('div');
            row.className = USER_FLOW_ROW_CLASS;
            wrap.appendChild(row);
        } else if (row !== wrap.lastElementChild) {
            wrap.appendChild(row);
        }
        return row;
    }

    function ensureUserPadAbs(group, badge) {
        if (!group || !badge) return false;

        // 소설형 UI 2: border-y + py-5 박스는 flex-row라 박스 안에 넣으면 옆으로 붙습니다.
        // 박스 바로 아래에 normal-flow 줄을 만들어 그 안에 배지를 넣습니다. (absolute 제거)
        const novelBox = findUserNovelPadAbsContainer(group);
        if (novelBox) {
            const row = ensureUserFlowRowAfter(novelBox);
            if (row) {
                if (badge.parentElement !== row) row.appendChild(badge);
                badge.dataset.placement = USER_NOVEL_FLOW_PLACEMENT;
                return true;
            }
        }

        // 말풍선형 UI: flex-col items-end wrapper의 마지막 자식 줄로 넣으면
        // 말풍선 아래에 우측 정렬로 자연스럽게 쌓입니다. (absolute 제거)
        const bubbleWrap = findUserPadAbsContainer(group);
        if (bubbleWrap) {
            const row = ensureUserFlowRowInside(bubbleWrap);
            if (row) {
                if (badge.parentElement !== row) row.appendChild(badge);
                badge.dataset.placement = USER_BUBBLE_FLOW_PLACEMENT;
                return true;
            }
        }

        return false;
    }

    function ensureBadge(group, resolved) {
        let badge = group.querySelector(`.${BADGE_CLASS}`);

        if (!badge) {
            badge = document.createElement('span');
            badge.className = `${BADGE_CLASS} relative inline-flex items-center justify-center overflow-hidden whitespace-nowrap font-medium transition-colors duration-200 h-6 rounded px-2 py-1 text-xs bg-transparent text-line-gray-2`;
            badge.setAttribute('aria-label', '메시지 정보');
        }

        // 유저 메시지는 UI 유형별 기존 여백에 absolute로 얹습니다.
        // 새 줄을 만들지 않고, 말풍선 옆 flex 공간도 먹지 않고, 본문 끝에 섞이지도 않게 합니다.
        if (isUserResolvedMessage(resolved) && ensureUserPadAbs(group, badge)) {
            return badge;
        }

        const { anchor, placement } = findSmartAnchor(group);

        if (anchor?.parentElement) {
            if (badge.parentElement !== anchor.parentElement || badge.nextElementSibling !== anchor) {
                anchor.parentElement.insertBefore(badge, anchor);
            }
            badge.dataset.placement = placement;
        } else if (badge.parentElement !== group) {
            group.appendChild(badge);
            badge.dataset.placement = 'fallback';
        }

        return badge;
    }

    function removeBadge(group) {
        group?.querySelector?.(`.${BADGE_CLASS}`)?.remove();
    }

    function removeAllBadges() {
        document.querySelectorAll(`.${BADGE_CLASS}`).forEach(el => el.remove());
    }

    function setBadge(group, resolved) {
        const parts = buildBadgeParts(resolved);

        if (!parts.length) {
            removeBadge(group);
            return;
        }

        const badge = ensureBadge(group, resolved);

        // 다운그레이드 방지:
        // 글자수가 이미 붙어있는데, API 실패/미스 fallback 결과가 뒤늦게 와서
        // 시간-only 배지로 덮어쓰는 것을 막습니다.
        const wantChars = getSetting('showChars');
        const hasCharsNow = /\d[\d,]*자/.test(badge.textContent || '');
        const hasCharsNew = hasResolvedChars(resolved);
        if (wantChars && hasCharsNow && !hasCharsNew) return;

        const label = parts.join(' · ');
        const full = formatFullDate(resolved.date);

        const titleLines = [
            label,
            full ? `생성 시각: ${full}` : '',
            hasResolvedChars(resolved) ? `글자수: ${formatNumber(resolved.charCount)}자 (API content 기준)` : '',
            resolved.note || '',
            resolved.messageId ? `messageId: ${resolved.messageId}` : ''
        ].filter(Boolean);

        const title = titleLines.join('\n');
        const source = resolved.source || 'dom';

        // 값이 실제로 바뀐 경우에만 DOM 갱신합니다.
        // textContent를 같은 값으로 다시 써도 childList mutation이 발생할 수 있어서,
        // 자기 MutationObserver를 계속 깨우는 무한 루프를 차단합니다.
        if (badge.textContent !== label) badge.textContent = label;
        if (badge.title !== title) badge.title = title;
        if (badge.dataset.source !== source) badge.dataset.source = source;

        const role = resolved.role || '';
        if (role && badge.dataset.role !== role) badge.dataset.role = role;
        if (!role && 'role' in badge.dataset) delete badge.dataset.role;

        if (resolved.source === 'api-current-reroll') {
            if (badge.dataset.rerollResolved !== 'true') badge.dataset.rerollResolved = 'true';
        } else if ('rerollResolved' in badge.dataset) {
            delete badge.dataset.rerollResolved;
        }
    }

    function isUserGroupByDom(group) {
        // messages API role 응답 전에도, 유저 말풍선/소설형 박스 구조만 보고 유저 메시지를 판정합니다.
        // ensureUserPadAbs가 실제로 노리는 컨테이너와 동일 기준이라, 최종 배치와 어긋나지 않습니다.
        if (!group) return false;
        return !!(findUserNovelPadAbsContainer(group) || findUserPadAbsContainer(group));
    }

    function applyDomUserRole(group, resolved) {
        if (!resolved || resolved.role || !isUserGroupByDom(group)) return resolved;
        return { ...resolved, role: 'user' };
    }

    function cacheResolvedIfReady(key, resolved) {
        if (!getSetting('showChars') || hasResolvedChars(resolved)) {
            resultCache.set(key, resolved);
        }
    }

    function processGroup(group) {
        if (!group?.isConnected || !group.matches?.(MESSAGE_SELECTOR)) return;

        if (!anyInfoEnabled()) {
            removeBadge(group);
            return;
        }

        const key = makeCacheKey(group);
        if (!key) return;

        const cached = resultCache.get(key);

        if (cached) {
            retryGroups.delete(group);
            setBadge(group, cached);
            return;
        }

        retryGroups.add(group);
        const fallback = applyDomUserRole(group, resolveByDomId(group));

        if (fallback.date && getSetting('showTime')) {
            // API 보정 전에도 바로 보이게 가볍게 붙입니다.
            setBadge(group, fallback);
        }

        resolveCurrentMessageInfo(group).then(resolved => {
            resolved = applyDomUserRole(group, resolved);

            // 글자수가 필요한데 못 구한 결과(fallback/API 미스)는 캐시에 박지 않습니다.
            // 한 번 실패한 time-only 결과가 영구 캐시되어 글자수 재시도를 막는 문제를 방지합니다.
            const needChars = getSetting('showChars');
            const gotChars = hasResolvedChars(resolved);

            cacheResolvedIfReady(key, resolved);
            setBadge(group, resolved);

            // 새 답변은 기존 messages API 캐시에 아직 없을 수 있습니다.
            // 글자수가 필요하지만 못 구한 경우에만 API 캐시를 한 번 새로고침한 뒤 재확인합니다.
            if (needChars && !gotChars && group.isConnected) {
                refreshApiCacheThrottled()
                    .then(() => {
                        if (!group.isConnected || resultCache.has(key)) return null;
                        return resolveCurrentMessageInfo(group, { force: false });
                    })
                    .then(retryResolved => {
                        if (!retryResolved) return;

                        retryResolved = applyDomUserRole(group, retryResolved);
                        cacheResolvedIfReady(key, retryResolved);
                        setBadge(group, retryResolved);
                    })
                    .catch(err => {
                        console.warn(`${LOG_PREFIX} API refresh retry failed:`, err);
                    });
            }
        });
    }

    function collectGroupsFromNode(node) {
        if (!node) return [];
        const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!el) return [];
        const owner = el.closest?.(MESSAGE_SELECTOR);
        if (owner) return [owner];
        return Array.from(el.querySelectorAll?.(MESSAGE_SELECTOR) || []);
    }

    function scanAllVisibleGroups() {
        resetPageCacheIfNeeded();

        if (!anyInfoEnabled()) {
            removeAllBadges();
            return;
        }

        document.querySelectorAll(MESSAGE_SELECTOR).forEach(processGroup);
    }

    function scheduleScan(nodes = null) {
        if (nodes === null) fullScanPending = true;
        else for (const node of nodes) {
            for (const group of collectGroupsFromNode(node)) if (group.isConnected) queuedGroups.add(group);
        }
        if (!fullScanPending && !queuedGroups.size) return;
        // Coalesce a burst without discarding earlier groups or starving under streaming.
        if (scanTimer !== null) return;
        scanTimer = setTimeout(() => {
            scanTimer = null;
            const full = fullScanPending || getUrlKey() !== lastUrlKey;
            fullScanPending = false;
            const groups = Array.from(queuedGroups);
            queuedGroups.clear();
            resetPageCacheIfNeeded();
            if (!anyInfoEnabled()) {
                retryGroups.clear();
                removeAllBadges();
                return;
            }
            if (full) scanAllVisibleGroups();
            else groups.forEach(group => { if (group.isConnected) processGroup(group); });
        }, 120);
    }

    function injectStyles() {
        GM_addStyle(`
            .${BADGE_CLASS} {
                flex: 0 0 auto;
                width: fit-content;
                max-width: 100%;
                height: 1.5rem;
                min-height: 1.5rem;
                margin: 0;
                padding: .25rem .5rem;
                border: 0 !important;
                border-radius: 4px;
                background-color: var(--transparent) !important;
                background-image: none !important;
                color: hsl(var(--line-gray-2)) !important;
                font-size: 12px;
                font-weight: 500;
                line-height: inherit;
                letter-spacing: inherit;
                white-space: nowrap;
                user-select: none;
                pointer-events: none;
                opacity: 1;
                box-sizing: border-box;
                vertical-align: middle;
                -webkit-font-smoothing: antialiased;
                transition-property: color, background-color, border-color, text-decoration-color, fill, stroke;
                transition-timing-function: cubic-bezier(.4,0,.2,1);
                transition-duration: .2s;
            }

            .${BADGE_CLASS}[data-placement="fallback"] {
                margin: 4px 10px 0 auto;
            }

            .${BADGE_CLASS}[data-placement="compare-left"],
            .${BADGE_CLASS}[data-placement="reroll-left"],
            .${BADGE_CLASS}[data-placement="option-left"] {
                align-self: center;
            }

            /* 유저 배지: absolute 대신 normal-flow 줄에 배치 (입력창 위로 떠오름 방지) */
            .${USER_FLOW_ROW_CLASS} {
                width: 100%;
                flex-basis: 100%;
                text-align: right;
                pointer-events: none;
            }

            .${BADGE_CLASS}[data-placement="user-bubble-flow"],
            .${BADGE_CLASS}[data-placement="user-novel-flow"] {
                position: static;
                display: inline-flex;
                align-items: center;
                justify-content: flex-end;
                flex: 0 0 auto;
                width: fit-content;
                max-width: 100%;
                height: 18px;
                min-height: 18px;
                max-height: 18px;
                margin: 0;
                padding: 0;
                border: 0 !important;
                border-radius: 0;
                background-color: transparent !important;
                background-image: none !important;
                color: hsl(var(--line-gray-2)) !important;
                font-size: 12px;
                font-weight: 500;
                line-height: 18px;
                white-space: nowrap;
                overflow: visible;
                opacity: .76;
                pointer-events: none;
                user-select: none;
            }

            .${BADGE_CLASS}[data-placement="user-novel-flow"] {
                margin-top: 2px;
            }

            .${BADGE_CLASS}[data-reroll-resolved="true"] {
                color: hsl(var(--line-gray-2)) !important;
                background-color: var(--transparent) !important;
            }

            body[data-theme="dark"] .${BADGE_CLASS},
            [data-theme="dark"] .${BADGE_CLASS} {
                color: hsl(var(--line-gray-2)) !important;
            }

            @media (prefers-color-scheme: dark) {
                body:not([data-theme="light"]) .${BADGE_CLASS} {
                    color: hsl(var(--line-gray-2)) !important;
                }
            }

            @media (max-width: 720px) {
                .${BADGE_CLASS} {
                    font-size: 12px;
                    opacity: 1;
                }

                .${BADGE_CLASS}[data-placement="fallback"] {
                    margin: 4px 8px 0 auto;
                }

                .${BADGE_CLASS}[data-placement="user-bubble-flow"],
                .${BADGE_CLASS}[data-placement="user-novel-flow"] {
                    font-size: 12px;
                    opacity: 1;
                }
            }
        `);
    }

    function init() {
        injectStyles();
        registerMenuCommands();

        const ready = () => {
            if (!document.body) return;

            scanAllVisibleGroups();

            const observer = new MutationObserver(mutations => {
                const nodes = [];
                for (const mutation of mutations) {
                    const target = mutation.target?.nodeType === Node.ELEMENT_NODE
                        ? mutation.target : mutation.target?.parentElement;
                    if (target?.closest?.(`.${BADGE_CLASS}`)) continue;
                    const onlyOwnAddition = mutation.type === 'childList' && !mutation.removedNodes.length &&
                        mutation.addedNodes.length && Array.from(mutation.addedNodes).every(node =>
                            node.nodeType === Node.ELEMENT_NODE && node.matches?.(`.${BADGE_CLASS}, .${USER_FLOW_ROW_CLASS}`));
                    if (onlyOwnAddition) continue;
                    const owner = target?.closest?.(MESSAGE_SELECTOR);
                    if (owner) nodes.push(owner);
                    mutation.addedNodes?.forEach(node => nodes.push(node));
                }
                scheduleScan(nodes);
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true
            });

            // Placement may change through root theme classes or responsive layout,
            // without replacing messages. Recover on these actual changes, not every 3.5s.
            const rootThemeSignature = () => [document.documentElement, document.body]
                .map(el => `${el?.className || ''}|${el?.getAttribute('data-theme') || ''}`).join('\n');
            let lastRootTheme = rootThemeSignature();
            const rootThemeObserver = new MutationObserver(() => {
                const next = rootThemeSignature();
                if (next === lastRootTheme) return;
                lastRootTheme = next;
                scheduleScan();
            });
            for (const root of [document.documentElement, document.body]) {
                rootThemeObserver.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] });
            }
            window.addEventListener('resize', () => scheduleScan(), { passive: true });
            document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleScan(); });

            // DOM remounts are handled above. Keep API-miss recovery without scanning history.
            setInterval(() => {
                if (document.hidden) return;
                if (getUrlKey() !== lastUrlKey) { scheduleScan(); return; }
                if (!anyInfoEnabled()) { retryGroups.clear(); return; }
                for (const group of retryGroups) {
                    if (!group.isConnected || resultCache.has(makeCacheKey(group))) retryGroups.delete(group);
                    else processGroup(group);
                }
            }, 3500);
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', ready, { once: true });
        } else {
            ready();
        }
    }

    init();
})();
  }

  // Selection Text Counter v1.0.1-fixed-corner: original main-host scope.
  if (onMainHost) {
(function () {
    'use strict';

    const SCRIPT_NS = 'crack-selection-text-counter';
    const POPUP_ID = `${SCRIPT_NS}-popup`;

    const DEBOUNCE_MS = 70;
    const HIDE_DELAY_MS = 160;
    const MIN_CHARS_TO_SHOW = 1;

    // true로 바꾸면 팝업에 "공백 제외"도 같이 표시합니다.
    // 기본은 아주 작게 보이도록 false.
    const SHOW_WITHOUT_SPACE = false;

    let debounceTimer = null;
    let hideTimer = null;
    let lastText = '';

    function normalizeSelectedText(text = '') {
        return String(text || '')
            .replace(/\r\n/g, '\n')
            .replace(/\u00A0/g, ' ')
            .trim();
    }

    function countChars(text = '') {
        // JS의 [...문자열]은 이모지/복합문자도 비교적 자연스럽게 1글자 단위로 셉니다.
        return [...String(text || '')].length;
    }

    function countCharsWithoutSpace(text = '') {
        return [...String(text || '').replace(/\s+/g, '')].length;
    }

    function getActiveInputSelection() {
        const el = document.activeElement;

        if (!el) return null;

        const tag = String(el.tagName || '').toLowerCase();
        const isTextInput =
            tag === 'textarea' ||
            (tag === 'input' && /^(text|search|url|tel|email|password)?$/i.test(el.type || 'text'));

        if (!isTextInput) return null;

        const start = el.selectionStart;
        const end = el.selectionEnd;

        if (typeof start !== 'number' || typeof end !== 'number' || start === end) return null;

        const text = normalizeSelectedText(String(el.value || '').slice(start, end));
        if (!text) return null;

        const rect = el.getBoundingClientRect();

        return {
            text,
            rect: {
                left: rect.left + Math.min(rect.width * 0.5, Math.max(24, rect.width - 24)),
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height
            },
            source: 'input'
        };
    }

    function getWindowSelectionInfo() {
        const selection = window.getSelection?.();

        if (!selection || selection.rangeCount <= 0 || selection.isCollapsed) return null;

        const text = normalizeSelectedText(selection.toString());
        if (!text) return null;

        let rect = null;

        try {
            const range = selection.getRangeAt(0);
            rect = range.getBoundingClientRect();

            if (!rect || (!rect.width && !rect.height)) {
                const rects = Array.from(range.getClientRects());
                rect = rects[rects.length - 1] || rects[0] || null;
            }
        } catch (e) {
            rect = null;
        }

        if (!rect) return null;

        return { text, rect, source: 'selection' };
    }

    function getSelectionInfo() {
        return getActiveInputSelection() || getWindowSelectionInfo();
    }

    function ensurePopup() {
        let popup = document.getElementById(POPUP_ID);

        if (!popup) {
            popup = document.createElement('div');
            popup.id = POPUP_ID;
            popup.setAttribute('aria-hidden', 'true');
            document.body.appendChild(popup);
        }

        return popup;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function positionPopup(popup, rect) {
        // v1.0.1: 선택 영역 근처가 아니라 화면 오른쪽 아래 고정 표시.
        // rect 인자는 이전 버전 호환용으로만 유지합니다.
        popup.style.left = '';
        popup.style.top = '';
    }

    function showPopup(info) {
        const text = normalizeSelectedText(info?.text || '');
        const total = countChars(text);

        if (total < MIN_CHARS_TO_SHOW) {
            hidePopup();
            return;
        }

        const noSpace = countCharsWithoutSpace(text);
        const popup = ensurePopup();

        popup.innerHTML = SHOW_WITHOUT_SPACE
            ? `<b>${total.toLocaleString()}자</b><span>공백 제외 ${noSpace.toLocaleString()}</span>`
            : `<b>${total.toLocaleString()}자</b>`;

        popup.title = `공백 포함: ${total.toLocaleString()}자\n공백 제외: ${noSpace.toLocaleString()}자`;
        popup.dataset.visible = 'true';

        // 내용 반영 후 실제 크기로 위치 계산
        requestAnimationFrame(() => positionPopup(popup, info.rect));

        lastText = text;
    }

    function hidePopup() {
        const popup = document.getElementById(POPUP_ID);
        if (popup) popup.dataset.visible = 'false';
        lastText = '';
    }

    function scheduleHide() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            const info = getSelectionInfo();
            if (!info?.text) hidePopup();
        }, HIDE_DELAY_MS);
    }

    function updateCounter() {
        clearTimeout(debounceTimer);

        debounceTimer = setTimeout(() => {
            const info = getSelectionInfo();

            if (!info?.text) {
                scheduleHide();
                return;
            }

            const text = normalizeSelectedText(info.text);

            // 같은 선택 텍스트여도 스크롤/화면 위치가 바뀔 수 있으니 위치는 다시 잡습니다.
            showPopup({ ...info, text });
        }, DEBOUNCE_MS);
    }

    function injectStyles() {
        GM_addStyle(`
            #${POPUP_ID} {
                position: fixed;
                right: max(16px, env(safe-area-inset-right));
                bottom: max(22px, calc(env(safe-area-inset-bottom) + 22px));
                z-index: 2147483003;
                display: inline-flex;
                align-items: center;
                gap: 5px;
                max-width: min(220px, calc(100vw - 16px));
                min-height: 24px;
                padding: 4px 8px;
                border: 1px solid var(--stc-border, rgba(0, 0, 0, .08));
                border-radius: 999px;
                background: var(--stc-bg, rgba(255, 255, 255, .94));
                color: var(--stc-text, #242321);
                box-shadow: 0 6px 20px rgba(0, 0, 0, .14);
                font-family: Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                font-size: 12px;
                line-height: 1;
                pointer-events: none;
                user-select: none;
                opacity: 0;
                transform: translateY(2px) scale(.98);
                transition: opacity .12s ease, transform .12s ease;
                backdrop-filter: blur(10px);
                box-sizing: border-box;
            }

            #${POPUP_ID}[data-visible="true"] {
                opacity: 1;
                transform: translateY(0) scale(1);
            }

            #${POPUP_ID} b {
                display: inline-flex;
                align-items: center;
                color: inherit;
                font-size: 12px;
                font-weight: 850;
                white-space: nowrap;
            }

            #${POPUP_ID} span {
                color: var(--stc-muted, rgba(36, 35, 33, .62));
                font-size: 11px;
                font-weight: 750;
                white-space: nowrap;
            }

            body[data-theme="dark"] #${POPUP_ID},
            [data-theme="dark"] #${POPUP_ID} {
                --stc-bg: rgba(36, 35, 33, .94);
                --stc-border: rgba(255, 255, 255, .12);
                --stc-text: #F0EFEB;
                --stc-muted: rgba(240, 239, 235, .62);
            }

            @media (prefers-color-scheme: dark) {
                body:not([data-theme="light"]) #${POPUP_ID} {
                    --stc-bg: rgba(36, 35, 33, .94);
                    --stc-border: rgba(255, 255, 255, .12);
                    --stc-text: #F0EFEB;
                    --stc-muted: rgba(240, 239, 235, .62);
                }
            }

            @media (max-width: 720px) {
                #${POPUP_ID} {
                    min-height: 23px;
                    padding: 4px 7px;
                    font-size: 11px;
                }

                #${POPUP_ID} b {
                    font-size: 11px;
                }
            }
        `);
    }

    function init() {
        injectStyles();

        const ready = () => {
            if (!document.body) return;

            document.addEventListener('selectionchange', updateCounter, { passive: true });
            document.addEventListener('mouseup', updateCounter, { passive: true });
            document.addEventListener('keyup', updateCounter, { passive: true });
            document.addEventListener('touchend', updateCounter, { passive: true });
            window.addEventListener('blur', hidePopup);
            window.addEventListener('resize', updateCounter, { passive: true });
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape') hidePopup();
            });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', ready, { once: true });
        } else {
            ready();
        }
    }

    init();
})();
  }

  // Input Wrapper Popup v0.1.8: original main/subdomain, top-frame scope.
  if (window.top === window.self) {
(() => {
  'use strict';

  const NS = 'ciw';
  const TOOLBAR_WRAPPER_ID = 'ciw-toolbar-wrapper';
  const TOOLBAR_BUTTON_ID = 'ciw-toolbar-button';
  const SELECTION_BAR_ID = 'ciw-selection-bar';
  const SETTINGS_ID = 'ciw-settings-overlay';
  const TOAST_ID = 'ciw-toast';

  const TOOLS_KEY = 'CrackInputWrapperPopup_Tools_v1';
  const SETTINGS_KEY = 'CrackInputWrapperPopup_Settings_v1';

  const DEFAULT_TOOLS = [
    { id: 'double', label: '쌍따옴표', icon: '“”', pre: '"', suf: '"', enabled: true },
    { id: 'single', label: '작은따옴표', icon: '‘’', pre: "'", suf: "'", enabled: true },
    { id: 'jp-double', label: '『 』', icon: '『』', pre: '『', suf: '』', enabled: true },
    { id: 'jp-single', label: '「 」', icon: '「」', pre: '「', suf: '」', enabled: true },
    { id: 'paren', label: '소괄호', icon: '()', pre: '(', suf: ')', enabled: true },
    { id: 'bold', label: '굵게', icon: '**', pre: '**', suf: '**', enabled: true },
    { id: 'strike', label: '취소선', icon: '~~', pre: '~~', suf: '~~', enabled: true },
    { id: 'codeblock', label: '코드블럭', icon: '⋮', pre: '```\n', suf: '\n```', enabled: true }
  ];

  const DEFAULT_SETTINGS = {
    showToolbarButton: true,
    showOnSelection: true,
    keepInnerSelected: false
  };

  let tools = loadTools();
  let settings = loadSettings();

  let savedRange = null;
  let savedEditor = null;
  let savedText = '';
  let hideTimer = 0;
  let scanTimer = 0;
  let routeKey = location.href;

  function isChatRoomPage() {
    const path = location.pathname || '';
    return (
      /\/stories\/[^/]+\/episodes\/[^/]+/.test(path) ||
      /\/characters\/[^/]+\/chats\/[^/]+/.test(path) ||
      /\/u\/[^/]+\/c\/[^/]+/.test(path) ||
      /\/(?:episodes|chats?)\/[a-zA-Z0-9_-]{8,}/.test(path)
    );
  }

  function safeJsonParse(text, fallback) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return fallback;
    }
  }

  function loadTools() {
    const saved = safeJsonParse(localStorage.getItem(TOOLS_KEY), null);
    if (!Array.isArray(saved) || !saved.length) return cloneTools(DEFAULT_TOOLS);

    return saved
      .filter(item => item && typeof item === 'object')
      .map((item, index) => ({
        id: String(item.id || `custom-${index}-${Date.now()}`),
        label: String(item.label || '도구'),
        icon: String(item.icon || item.label || '?').slice(0, 8),
        pre: String(item.pre ?? ''),
        suf: String(item.suf ?? ''),
        enabled: item.enabled !== false
      }));
  }

  function saveTools() {
    localStorage.setItem(TOOLS_KEY, JSON.stringify(tools));
    renderSelectionBar();
  }

  function cloneTools(list) {
    return JSON.parse(JSON.stringify(list));
  }

  function loadSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, safeJsonParse(localStorage.getItem(SETTINGS_KEY), {}) || {});
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function escapedValue(value) {
    return String(value ?? '').replace(/\n/g, '\\n');
  }

  function unescapedValue(value) {
    return String(value ?? '').replace(/\\n/g, '\n');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getSelectionBar() {
    return document.getElementById(SELECTION_BAR_ID);
  }

  function getToast() {
    let toast = document.getElementById(TOAST_ID);

    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      document.documentElement.appendChild(toast);
    }

    return toast;
  }

  function toast(text) {
    const el = getToast();
    el.textContent = text;
    el.dataset.show = 'true';

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      el.dataset.show = 'false';
    }, 1200);
  }

  function isOwnUiNode(node) {
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement);
    return !!el?.closest?.(`#${SELECTION_BAR_ID}, #${SETTINGS_ID}, #${TOAST_ID}, #${TOOLBAR_WRAPPER_ID}`);
  }

  function closestElement(node) {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  function closestEditableFromNode(node) {
    const el = closestElement(node);
    if (!el) return null;

    return el.closest?.('div.ProseMirror[contenteditable="true"], [contenteditable="true"].ProseMirror, textarea, input[type="text"]') || null;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isAllowedEditor(editor) {
    if (!editor || !editor.isConnected || !isVisible(editor)) return false;
    if (isOwnUiNode(editor)) return false;

    if (editor.matches?.('textarea, input[type="text"]')) {
      return !!editor.closest?.('[data-ciw-allow="true"]');
    }

    if (!editor.matches?.('div.ProseMirror[contenteditable="true"], [contenteditable="true"].ProseMirror')) return false;
    if (editor.getAttribute('contenteditable') === 'false') return false;
    if (editor.closest?.('.wrtn-markdown, [data-ciw-block="true"]')) return false;

    // 메인 채팅 입력창: 사용자가 보내준 현재 구조 기준.
    if (editor.classList.contains('__chat_input_textarea')) return true;

    // 수정창(AI 메시지 편집): 크랙은 tiptap ProseMirror 에디터를 사용.
    // __chat_input_textarea가 없고 .wrtn-markdown(본문) 밖에 위치(위 가드에서 이미 제외됨).
    // 기존 광범위 셀렉터(.fixed/form/[data-state]/[role=dialog])는 오탐만 키워 tiptap 단독으로 좁힘.
    if (editor.classList.contains('tiptap')) {
      return true;
    }

    return false;
  }

  function getSelectedRangeInfo() {
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

    const text = sel.toString();
    if (!text || !text.trim()) return null;

    const range = sel.getRangeAt(0);
    const editorA = closestEditableFromNode(range.commonAncestorContainer);
    const editorB = closestEditableFromNode(sel.anchorNode);
    const editorC = closestEditableFromNode(sel.focusNode);
    const editor = editorA || editorB || editorC;

    if (!editor || editorB !== editorC && editorB && editorC) return null;
    if (!isAllowedEditor(editor)) return null;

    return { sel, range, editor, text };
  }

  function saveCurrentSelection() {
    const info = getSelectedRangeInfo();

    if (!info) {
      savedRange = null;
      savedEditor = null;
      savedText = '';
      return null;
    }

    savedRange = info.range.cloneRange();
    savedEditor = info.editor;
    savedText = info.text;

    return info;
  }

  function restoreSelection() {
    if (!savedRange || !savedEditor || !savedEditor.isConnected) return false;

    try {
      savedEditor.focus?.();

      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);

      return true;
    } catch (_) {
      return false;
    }
  }

  function dispatchEditorInput(editor) {
    if (!editor) return;

    try {
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: ''
      }));
    } catch (_) {
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function insertPlainTextFallback(text) {
    const sel = window.getSelection?.();
    if (!sel || !sel.rangeCount) return false;

    const range = sel.getRangeAt(0);
    range.deleteContents();

    const node = document.createTextNode(text);
    range.insertNode(node);

    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);

    return true;
  }

  function wrapSelection(tool) {
    if (!tool) return;

    const selectedBefore = savedText;

    if (!selectedBefore || !restoreSelection()) {
      hideSelectionBar();
      return;
    }

    const editor = savedEditor;
    const wrapped = `${tool.pre}${selectedBefore}${tool.suf}`;

    let ok = false;

    try {
      ok = document.execCommand && document.execCommand('insertText', false, wrapped);
    } catch (_) {
      ok = false;
    }

    if (!ok) {
      try {
        ok = insertPlainTextFallback(wrapped);
      } catch (_) {
        ok = false;
      }
    }

    if (ok) {
      dispatchEditorInput(editor);

      if (settings.keepInnerSelected) {
        trySelectInnerText(editor, tool.pre.length, selectedBefore.length);
      }

      hideSelectionBar();
    } else {
      toast('감싸기 실패');
    }
  }

  function trySelectInnerText(editor, prefixLen, innerLen) {
    // execCommand 이후에는 커서가 삽입문 뒤로 가는 경우가 많습니다.
    // ProseMirror 내부 상태를 과하게 건드리지 않기 위해 기본값은 꺼둔 옵션입니다.
    if (!editor || !innerLen) return;

    try {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;

      const current = sel.getRangeAt(0);
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let target = null;

      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeValue && node.nodeValue.includes(savedText)) {
          target = node;
          break;
        }
      }

      if (!target) return;

      const start = target.nodeValue.indexOf(savedText);
      if (start < 0) return;

      const range = document.createRange();
      range.setStart(target, start);
      range.setEnd(target, start + innerLen);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  function positionSelectionBar(info) {
    const bar = getSelectionBar();
    if (!bar || !info?.range) return;

    const rect = getRangeRect(info.range);
    if (!rect) {
      hideSelectionBar();
      return;
    }

    // 키보드가 올라온 모바일에서 layout viewport는 키보드를 포함하므로,
    // 실제 보이는 영역인 visualViewport를 우선 사용한다.
    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    const offX = vv ? vv.offsetLeft : 0;
    const offY = vv ? vv.offsetTop : 0;

    bar.style.display = 'flex';
    bar.style.visibility = 'hidden';

    const bw = bar.offsetWidth || 220;
    const bh = bar.offsetHeight || 36;

    // rect는 viewport 좌표. 선택 영역 위쪽에 두되 공간 없으면 아래로.
    let left = rect.left + rect.width / 2 - bw / 2;
    let top = rect.top - bh - 8;
    if (top < offY + 8) top = rect.bottom + 8;

    // 보이는 영역(visualViewport) 안으로 clamp
    left = Math.max(offX + 8, Math.min(left, offX + vw - bw - 8));
    top = Math.max(offY + 8, Math.min(top, offY + vh - bh - 8));

    // absolute 기준이므로 document 좌표로 변환(스크롤 보정 유지)
    bar.style.left = `${left + window.scrollX}px`;
    bar.style.top = `${top + window.scrollY}px`;
    bar.style.visibility = 'visible';
  }

  function getRangeRect(range) {
    if (!range) return null;

    const rects = Array.from(range.getClientRects?.() || []).filter(r => r.width || r.height);
    if (rects.length) return rects[0];

    const rect = range.getBoundingClientRect?.();
    if (rect && (rect.width || rect.height)) return rect;

    return null;
  }

  function showSelectionBarForCurrentSelection() {
    if (!settings.showOnSelection || !isChatRoomPage()) {
      hideSelectionBar();
      return;
    }

    const info = saveCurrentSelection();

    if (!info) {
      hideSelectionBar();
      return;
    }

    renderSelectionBar();
    positionSelectionBar(info);
  }

  function hideSelectionBar(delay = 0) {
    clearTimeout(hideTimer);

    hideTimer = setTimeout(() => {
      const bar = getSelectionBar();
      if (bar) bar.style.display = 'none';
    }, delay);
  }

  function renderSelectionBar() {
    let bar = getSelectionBar();

    if (!bar) {
      bar = document.createElement('div');
      bar.id = SELECTION_BAR_ID;
      document.body.appendChild(bar);

      bar.addEventListener('mousedown', e => e.preventDefault());
      bar.addEventListener('pointerdown', e => e.preventDefault());
      bar.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    }

    const enabledTools = tools.filter(tool => tool.enabled !== false);

    bar.innerHTML = '';

    enabledTools.forEach((tool, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${NS}-sel-btn`;
      btn.title = tool.label;
      btn.dataset.toolId = tool.id || '';
      btn.textContent = tool.icon || tool.label || '?';
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        wrapSelection(tool);
      });
      bar.appendChild(btn);
    });

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = `${NS}-sel-btn ${NS}-sel-settings`;
    edit.title = '감싸기 도구 설정';
    edit.textContent = '⚙';
    edit.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openSettingsModal();
    });
    bar.appendChild(edit);
  }

  function findInputRoot() {
    const editor = document.querySelector('.__chat_input_textarea.ProseMirror[contenteditable="true"], div.__chat_input_textarea[contenteditable="true"]');
    if (!editor) return null;

    return (
      editor.closest('.flex.w-full.flex-col.rounded-lg') ||
      editor.closest('form') ||
      editor.parentElement?.parentElement ||
      editor.parentElement
    );
  }

  function findToolbarLeftContainer() {
    const root = findInputRoot();
    if (!root) return null;

    return (
      root.querySelector('.flex.items-center.space-x-2') ||
      root.querySelector('[class*="space-x-2"]') ||
      root.querySelector('.flex.items-center')
    );
  }

  function nativeButtonClass(container) {
    const btn = container?.querySelector?.('button');
    if (btn?.className && typeof btn.className === 'string') return btn.className;

    return 'relative inline-flex items-center gap-1 rounded-full text-sm font-medium leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50 min-w-7 border border-border bg-card text-line-gray-1 hover:bg-secondary p-0 size-7 justify-center';
  }

  function ensureToolbarButton() {
    if (!settings.showToolbarButton || !isChatRoomPage()) {
      document.getElementById(TOOLBAR_WRAPPER_ID)?.remove();
      return;
    }

    const container = findToolbarLeftContainer();
    if (!container) return;

    let wrapper = document.getElementById(TOOLBAR_WRAPPER_ID);

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.id = TOOLBAR_WRAPPER_ID;
      wrapper.setAttribute('data-crack-native-toolbar-addon', 'input-wrapper');
      wrapper.style.display = 'flex';
    }

    let btn = wrapper.querySelector(`#${TOOLBAR_BUTTON_ID}`);

    if (!btn) {
      btn = document.createElement('button');
      btn.id = TOOLBAR_BUTTON_ID;
      btn.type = 'button';
      btn.title = '입력 감싸기 도구 설정';
      btn.setAttribute('aria-label', '입력 감싸기 도구 설정');
      btn.innerHTML = '<span class="ciw-toolbar-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7.5 7.5 4 12l3.5 4.5M16.5 7.5 20 12l-3.5 4.5M10 18l4-12"/></svg></span>';
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        openSettingsModal();
      });
      wrapper.appendChild(btn);
    }

    btn.className = nativeButtonClass(container);
    btn.classList.add('ciw-native-toolbar-btn');

    if (wrapper.parentElement !== container) {
      container.insertBefore(wrapper, container.firstChild);
    }
  }

  function removeUiOutsideChat() {
    if (isChatRoomPage()) return false;

    document.getElementById(TOOLBAR_WRAPPER_ID)?.remove();
    hideSelectionBar();

    const modal = document.getElementById(SETTINGS_ID);
    if (modal) modal.remove();

    savedRange = null;
    savedEditor = null;
    savedText = '';

    return true;
  }

  function openSettingsModal() {
    let overlay = document.getElementById(SETTINGS_ID);
    if (overlay) return;

    const draft = cloneTools(tools);

    overlay = document.createElement('div');
    overlay.id = SETTINGS_ID;

    overlay.innerHTML = `
      <div class="ciw-modal">
        <div class="ciw-modal-head">
          <div class="ciw-modal-title">
            <strong>✍️ 입력 감싸기 도구</strong>
            <span>드래그한 텍스트를 기호로 감쌉니다</span>
          </div>
          <button type="button" class="ciw-close" data-ciw-action="close">✕</button>
        </div>

        <div class="ciw-options">
          <label class="ciw-chip"><input type="checkbox" id="ciw-opt-toolbar"> 채팅창 툴바 버튼</label>
          <label class="ciw-chip"><input type="checkbox" id="ciw-opt-selection"> 드래그 선택 팝업</label>
          <label class="ciw-chip"><input type="checkbox" id="ciw-opt-keep-selected"> 감싼 뒤 내부 텍스트 다시 선택</label>
        </div>

        <div class="ciw-tool-head">
          <span>도구 목록</span>
          <button type="button" class="ciw-small-btn" data-ciw-action="add">＋ 추가</button>
        </div>

        <div class="ciw-col-head">
          <span>표시</span><span>이름</span><span>아이콘</span><span>앞 기호</span><span>뒤 기호</span><span></span>
        </div>

        <div class="ciw-tool-list" id="ciw-tool-list"></div>

        <div class="ciw-modal-foot">
          <button type="button" class="ciw-text-btn" data-ciw-action="reset">기본값으로 되돌리기</button>
          <div class="ciw-foot-actions">
            <button type="button" class="ciw-sec-btn" data-ciw-action="close">취소</button>
            <button type="button" class="ciw-main-btn" data-ciw-action="save">저장</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const optToolbar = overlay.querySelector('#ciw-opt-toolbar');
    const optSelection = overlay.querySelector('#ciw-opt-selection');
    const optKeepSelected = overlay.querySelector('#ciw-opt-keep-selected');

    optToolbar.checked = settings.showToolbarButton !== false;
    optSelection.checked = settings.showOnSelection !== false;
    optKeepSelected.checked = settings.keepInnerSelected === true;

    function renderToolRows() {
      const list = overlay.querySelector('#ciw-tool-list');
      list.innerHTML = '';

      draft.forEach((tool, index) => {
        const row = document.createElement('div');
        row.className = 'ciw-tool-row';
        row.dataset.index = String(index);

        row.innerHTML = `
          <label class="ciw-enable" title="팝업에 표시">
            <input type="checkbox" class="ciw-enabled" ${tool.enabled !== false ? 'checked' : ''}>
          </label>
          <input class="ciw-label" type="text" value="${escapeHtml(tool.label)}" placeholder="이름">
          <input class="ciw-icon" type="text" value="${escapeHtml(tool.icon)}" placeholder="아이콘">
          <input class="ciw-pre" type="text" value="${escapeHtml(escapedValue(tool.pre))}" placeholder="앞">
          <input class="ciw-suf" type="text" value="${escapeHtml(escapedValue(tool.suf))}" placeholder="뒤">
          <div class="ciw-row-actions">
            <button type="button" data-row-action="up" title="위로">↑</button>
            <button type="button" data-row-action="down" title="아래로">↓</button>
            <button type="button" data-row-action="delete" title="삭제">×</button>
          </div>
        `;

        list.appendChild(row);
      });
    }

    function syncDraftFromInputs() {
      overlay.querySelectorAll('.ciw-tool-row').forEach(row => {
        const index = Number(row.dataset.index);
        const tool = draft[index];
        if (!tool) return;

        tool.enabled = row.querySelector('.ciw-enabled')?.checked !== false;
        tool.label = row.querySelector('.ciw-label')?.value || '도구';
        tool.icon = row.querySelector('.ciw-icon')?.value || tool.label.slice(0, 2);
        tool.pre = unescapedValue(row.querySelector('.ciw-pre')?.value || '');
        tool.suf = unescapedValue(row.querySelector('.ciw-suf')?.value || '');
      });
    }

    renderToolRows();

    overlay.addEventListener('click', e => {
      const action = e.target?.closest?.('[data-ciw-action]')?.dataset?.ciwAction;
      const rowAction = e.target?.closest?.('[data-row-action]')?.dataset?.rowAction;

      if (rowAction) {
        e.preventDefault();
        const row = e.target.closest('.ciw-tool-row');
        const index = Number(row?.dataset.index);
        if (!Number.isFinite(index)) return;

        syncDraftFromInputs();

        if (rowAction === 'up' && index > 0) {
          [draft[index - 1], draft[index]] = [draft[index], draft[index - 1]];
          renderToolRows();
        } else if (rowAction === 'down' && index < draft.length - 1) {
          [draft[index + 1], draft[index]] = [draft[index], draft[index + 1]];
          renderToolRows();
        } else if (rowAction === 'delete') {
          draft.splice(index, 1);
          renderToolRows();
        }
        return;
      }

      if (!action) return;

      e.preventDefault();

      if (action === 'close') {
        overlay.remove();
        return;
      }

      if (action === 'add') {
        syncDraftFromInputs();
        draft.push({
          id: `custom-${Date.now()}`,
          label: '새 도구',
          icon: '＋',
          pre: '',
          suf: '',
          enabled: true
        });
        renderToolRows();
        return;
      }

      if (action === 'reset') {
        draft.splice(0, draft.length, ...cloneTools(DEFAULT_TOOLS));
        renderToolRows();
        return;
      }

      if (action === 'save') {
        syncDraftFromInputs();

        tools = draft
          .filter(tool => tool.pre || tool.suf || tool.label || tool.icon)
          .map((tool, index) => ({
            id: tool.id || `tool-${index}-${Date.now()}`,
            label: String(tool.label || '도구'),
            icon: String(tool.icon || tool.label || '?').slice(0, 8),
            pre: String(tool.pre ?? ''),
            suf: String(tool.suf ?? ''),
            enabled: tool.enabled !== false
          }));

        settings.showToolbarButton = optToolbar.checked;
        settings.showOnSelection = optSelection.checked;
        settings.keepInnerSelected = optKeepSelected.checked;

        saveTools();
        saveSettings();
        ensureToolbarButton();
        overlay.remove();
        toast('저장했어');
      }
    });

    overlay.addEventListener('mousedown', e => {
      if (e.target === overlay) overlay.remove();
    });
  }

  function handleSelectionEvent() {
    clearTimeout(handleSelectionEvent._timer);
    handleSelectionEvent._timer = setTimeout(showSelectionBarForCurrentSelection, 80);
  }

  function handleRouteChange() {
    if (routeKey === location.href) return;

    routeKey = location.href;
    savedRange = null;
    savedEditor = null;
    savedText = '';

    hideSelectionBar();
    setTimeout(ensureToolbarButton, 250);
    setTimeout(ensureToolbarButton, 900);
  }

  function installEventListeners() {
    document.addEventListener('selectionchange', () => {
      if (isOwnUiNode(document.activeElement)) return;
      handleSelectionEvent();
    }, true);

    document.addEventListener('mouseup', handleSelectionEvent, true);
    document.addEventListener('keyup', event => {
      if (event.key === 'Escape') {
        hideSelectionBar();
        return;
      }
      handleSelectionEvent();
    }, true);
    document.addEventListener('touchend', () => {
      setTimeout(handleSelectionEvent, 80);
    }, true);

    document.addEventListener('mousedown', event => {
      const bar = getSelectionBar();
      if (!bar || bar.style.display === 'none') return;

      // bar 자체(버튼/설정) 클릭은 유지 — savedRange 복원으로 감싸기 동작.
      if (isOwnUiNode(event.target)) return;

      // 그 외 어디든(에디터 내부 재클릭 포함) 누르면 기존 선택을 즉시 해제.
      // 선택을 안 지우면 80ms 뒤 handleSelectionEvent가 bar를 되살려 '깜빡임 + 미해제'가 생김.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) sel.removeAllRanges();

      bar.style.display = 'none';
    }, true);

    document.addEventListener('keydown', event => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;

      const editor = closestEditableFromNode(document.activeElement);
      if (!isAllowedEditor(editor)) return;

      const idx = shortcutIndexFromEvent(event);
      if (idx < 0) return;

      const enabled = tools.filter(tool => tool.enabled !== false);
      const tool = enabled[idx];
      if (!tool) return;

      const info = saveCurrentSelection();
      if (!info) return;

      event.preventDefault();
      event.stopPropagation();
      wrapSelection(tool);
    }, true);
  }

  function shortcutIndexFromEvent(event) {
    const key = event.key;
    const code = event.code;

    if (code === 'Backquote' || key === '`' || key === '~') return 0;
    if (/^Digit\d$/.test(code)) {
      const n = Number(code.replace('Digit', ''));
      return n === 0 ? 10 : n;
    }
    if (/^\d$/.test(key)) {
      const n = Number(key);
      return n === 0 ? 10 : n;
    }

    return -1;
  }

  function installObserver() {
    const observer = new MutationObserver(mutations => {
      let shouldScan = false;

      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;

        for (const node of mutation.addedNodes || []) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const el = node;
          if (
            el.matches?.('.__chat_input_textarea, div.ProseMirror[contenteditable="true"]') ||
            el.querySelector?.('.__chat_input_textarea, div.ProseMirror[contenteditable="true"], .flex.items-center.space-x-2')
          ) {
            shouldScan = true;
            break;
          }
        }

        if (shouldScan) break;
      }

      handleRouteChange();

      if (shouldScan) {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(() => {
          removeUiOutsideChat();
          ensureToolbarButton();
        }, 120);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    setInterval(() => {
      handleRouteChange();
      if (!removeUiOutsideChat()) ensureToolbarButton();
    }, 1500);
  }

  function injectStyles() {
    const css = `
      #${SELECTION_BAR_ID} {
        position: absolute;
        display: none;
        align-items: center;
        gap: 4px;
        padding: 5px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 999px;
        background: linear-gradient(180deg, rgba(34,34,38,.92), rgba(20,20,23,.90));
        color: #fff;
        box-shadow: 0 10px 28px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.08);
        z-index: 2147483643 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        backdrop-filter: blur(14px) saturate(1.15);
        -webkit-backdrop-filter: blur(14px) saturate(1.15);
      }

      .${NS}-sel-btn {
        min-width: 30px;
        height: 30px;
        padding: 0 8px;
        border: 1px solid transparent;
        border-radius: 999px;
        background: transparent;
        color: rgba(255,255,255,.92);
        font: 800 13px/1 ui-serif, "Times New Roman", "Noto Serif KR", serif;
        letter-spacing: -.03em;
        cursor: pointer;
        white-space: nowrap;
        transition: background .12s ease, border-color .12s ease, transform .12s ease, color .12s ease;
      }

      .${NS}-sel-btn[data-tool-id="bold"],
      .${NS}-sel-btn[data-tool-id="strike"],
      .${NS}-sel-btn[data-tool-id="codeblock"] {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        letter-spacing: -.05em;
      }

      .${NS}-sel-btn[data-tool-id="paren"] {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        font-weight: 800;
      }

      .${NS}-sel-btn:hover {
        background: rgba(255,255,255,.10);
        border-color: rgba(255,255,255,.10);
        color: #fff;
      }

      .${NS}-sel-btn:active {
        transform: scale(.94);
      }

      .${NS}-sel-settings {
        min-width: 30px;
        margin-left: 2px;
        color: rgba(255,255,255,.62);
        border-left: 1px solid rgba(255,255,255,.12);
        border-radius: 999px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
      }

      #${TOOLBAR_WRAPPER_ID} {
        display: flex;
        align-items: center;
      }

      #${TOOLBAR_BUTTON_ID} .ciw-toolbar-icon {
        width: 16px;
        height: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
      }

      #${TOOLBAR_BUTTON_ID} .ciw-toolbar-icon svg {
        width: 16px;
        height: 16px;
        display: block;
        fill: none;
        stroke: currentColor;
        stroke-width: 2.35;
        stroke-linecap: round;
        stroke-linejoin: round;
      }



      #${SETTINGS_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647 !important;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,.48);
        backdrop-filter: blur(2px);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", sans-serif;
      }

      .ciw-modal {
        width: min(680px, calc(100vw - 28px));
        max-height: min(760px, calc(100vh - 28px));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 18px;
        background: #1c1c21;
        color: #f2f2f5;
        box-shadow: 0 24px 64px rgba(0,0,0,.5);
      }

      .ciw-modal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 18px 14px;
      }

      .ciw-modal-title {
        display: flex;
        align-items: baseline;
        gap: 10px;
        min-width: 0;
      }

      .ciw-modal-title strong { font-size: 15px; letter-spacing: -.01em; }

      .ciw-modal-title span {
        font-size: 11.5px;
        color: rgba(255,255,255,.42);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ciw-close {
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 8px;
        background: rgba(255,255,255,.06);
        color: rgba(255,255,255,.64);
        font-size: 15px;
        cursor: pointer;
        transition: background .12s, color .12s;
      }

      .ciw-close:hover { background: rgba(255,255,255,.12); color: #fff; }

      .ciw-options {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 0 18px 16px;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }

      .ciw-chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 7px 12px 7px 9px;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 999px;
        background: rgba(255,255,255,.03);
        font-size: 12px;
        color: rgba(255,255,255,.64);
        cursor: pointer;
        user-select: none;
        transition: all .14s;
      }

      .ciw-chip input[type="checkbox"] {
        appearance: none;
        -webkit-appearance: none;
        margin: 0;
        width: 15px;
        height: 15px;
        border-radius: 50%;
        border: 1.5px solid rgba(255,255,255,.28);
        background: transparent;
        cursor: pointer;
        transition: all .14s;
        flex: none;
      }

      .ciw-chip input[type="checkbox"]:checked {
        border-color: #ffa600;
        background: #ffa600 url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M5 13l4 4 10-10' fill='none' stroke='%23111' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'/></svg>") center/9px no-repeat;
      }

      .ciw-chip:has(input:checked) {
        border-color: rgba(255,166,0,.5);
        background: rgba(255,166,0,.14);
        color: #f2f2f5;
      }

      .ciw-tool-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px 0;
        font-size: 13px;
        font-weight: 700;
      }

      .ciw-small-btn {
        border: 1px dashed rgba(255,166,0,.45);
        border-radius: 8px;
        background: transparent;
        color: #ffa600;
        padding: 6px 11px;
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        transition: background .12s;
      }

      .ciw-small-btn:hover { background: rgba(255,166,0,.14); }

      .ciw-col-head {
        display: grid;
        grid-template-columns: 28px minmax(90px, .9fr) 56px minmax(78px, 1fr) minmax(78px, 1fr) 76px;
        gap: 8px;
        padding: 12px 26px 6px;
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: .06em;
        color: rgba(255,255,255,.42);
        text-transform: uppercase;
      }

      .ciw-tool-list {
        flex: 1;
        overflow: auto;
        padding: 0 18px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ciw-tool-row {
        display: grid;
        grid-template-columns: 28px minmax(90px, .9fr) 56px minmax(78px, 1fr) minmax(78px, 1fr) 76px;
        gap: 8px;
        align-items: center;
        padding: 7px 8px;
        border: 1px solid transparent;
        border-radius: 10px;
        background: rgba(255,255,255,.028);
        transition: background .12s, border-color .12s, opacity .12s;
      }

      .ciw-tool-row:hover {
        background: rgba(255,255,255,.05);
        border-color: rgba(255,255,255,.08);
      }

      .ciw-tool-row:has(.ciw-enabled:not(:checked)) { opacity: .45; }

      .ciw-enable {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .ciw-enabled {
        appearance: none;
        -webkit-appearance: none;
        margin: 0;
        width: 17px;
        height: 17px;
        border-radius: 5px;
        border: 1.5px solid rgba(255,255,255,.25);
        background: transparent;
        cursor: pointer;
        transition: all .13s;
      }

      .ciw-enabled:checked {
        border-color: #ffa600;
        background: #ffa600 url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M5 13l4 4 10-10' fill='none' stroke='%23111' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'/></svg>") center/10px no-repeat;
      }

      .ciw-tool-row input[type="text"] {
        min-width: 0;
        height: 30px;
        border: 1px solid transparent;
        border-radius: 7px;
        background: rgba(0,0,0,.22);
        color: #fff;
        padding: 0 9px;
        font-size: 12.5px;
        outline: none;
        transition: border-color .12s, background .12s;
      }

      .ciw-tool-row input[type="text"]:hover { border-color: rgba(255,255,255,.08); }

      .ciw-tool-row input[type="text"]:focus {
        border-color: rgba(255,166,0,.65);
        background: rgba(0,0,0,.32);
      }

      .ciw-tool-row .ciw-icon { text-align: center; }

      .ciw-tool-row .ciw-pre,
      .ciw-tool-row .ciw-suf {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        color: #ffd28a;
      }

      .ciw-row-actions {
        display: flex;
        gap: 3px;
        justify-content: flex-end;
      }

      .ciw-row-actions button {
        width: 23px;
        height: 25px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: rgba(255,255,255,.42);
        font-size: 12px;
        cursor: pointer;
        transition: background .12s, color .12s;
      }

      .ciw-row-actions button:hover {
        background: rgba(255,255,255,.1);
        color: #fff;
      }

      .ciw-row-actions [data-row-action="delete"]:hover {
        background: rgba(255,105,97,.16);
        color: #ff6961;
      }

      .ciw-modal-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 13px 18px;
        border-top: 1px solid rgba(255,255,255,.08);
        background: rgba(0,0,0,.14);
      }

      .ciw-foot-actions { display: flex; gap: 8px; }

      .ciw-text-btn {
        border: 0;
        background: transparent;
        color: rgba(255,255,255,.42);
        font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 8px 4px;
        cursor: pointer;
        transition: color .12s;
      }

      .ciw-text-btn:hover { color: #ff6961; }

      .ciw-sec-btn {
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 9px;
        background: transparent;
        color: rgba(255,255,255,.64);
        padding: 9px 15px;
        font: 700 12.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        transition: all .12s;
      }

      .ciw-sec-btn:hover { background: rgba(255,255,255,.06); color: #fff; }

      .ciw-main-btn {
        border: 0;
        border-radius: 9px;
        background: #ffa600;
        color: #16130a;
        padding: 9px 18px;
        font: 800 12.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(255,166,0,.25);
        transition: filter .12s, transform .1s;
      }

      .ciw-main-btn:hover { filter: brightness(1.08); }
      .ciw-main-btn:active { transform: scale(.97); }

      #${TOAST_ID} {
        position: fixed;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%) translateY(8px);
        z-index: 2147483647 !important;
        opacity: 0;
        pointer-events: none;
        transition: .16s ease;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(20,20,22,.94);
        color: #fff;
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 8px 24px rgba(0,0,0,.3);
      }

      #${TOAST_ID}[data-show="true"] {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      @media (max-width: 640px) {
        .ciw-modal {
          width: calc(100vw - 16px);
          max-height: calc(100vh - 16px);
        }

        .ciw-col-head { display: none; }

        .ciw-tool-row {
          grid-template-columns: 24px 1fr 50px;
          row-gap: 6px;
        }

        .ciw-tool-row .ciw-pre,
        .ciw-tool-row .ciw-suf { grid-column: span 1; }

        .ciw-row-actions {
          grid-column: 1 / -1;
          justify-content: flex-end;
        }

        #${SELECTION_BAR_ID} {
          max-width: calc(100vw - 16px);
          overflow-x: auto;
        }
      }
    `;

    if (typeof GM_addStyle === 'function') {
      GM_addStyle(css);
    } else {
      const style = document.createElement('style');
      style.textContent = css;
      document.documentElement.appendChild(style);
    }
  }

  function init() {
    injectStyles();
    renderSelectionBar();
    installEventListeners();
    installObserver();

    setTimeout(ensureToolbarButton, 250);
    setTimeout(ensureToolbarButton, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
  }
})();
