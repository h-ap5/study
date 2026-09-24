// ==UserScript==
// @name         Crack Novel Theme Model Icon + Chat Model Stats
// @namespace    crack-model-icon-stats-combined
// @version      2.0.1
// @description  소설형 메시지 모델 아이콘·수동 선택과 방별 모델 사용 통계를 한 파일에서 표시합니다.
// @match        https://crack.wrtn.ai/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (W.__CCMS_CHAT_MODEL_STATS_LOADED__) return;
  W.__CCMS_CHAT_MODEL_STATS_LOADED__ = true;

  const VERSION = '2.0.1';
  const STORE_KEY = 'ccms_chat_model_stats_v1';
  const REGISTRY_KEY = 'ccms_model_registry_v1';
  const STYLE_ID = 'ccms-chat-model-stats-style';
  const SIDEBAR_ID = 'ccms-chat-model-stats-sidebar';

  const ICON_STORAGE_KEY = 'crackNovelModelIcon.manual.v1';
  const ICON_DEBUG_KEY = 'crackNovelModelIcon.debug.v1';

  const MODEL_BY_CRACKER = {
    hyperchat_2_0: {
      label: '하이퍼챗 2.0',
      src: 'https://cdn-image.wrtn.ai/crack/graphics/model-icon/hyperchat2_0.webp',
      engine: 'Opus 4.8',
    },
    hyperchat_1_5: {
      label: '하이퍼챗 1.5',
      src: 'https://cdn-image.wrtn.ai/crack/graphics/model-icon/hyperchat1_5.webp',
      engine: 'Opus 4.7',
    },
    hyperchat: {
      label: '하이퍼챗 1.0',
      src: 'https://cdn-image.wrtn.ai/crack/graphics/model-icon/hyperchat.webp',
      engine: 'Opus 4.6',
    },

    superchat_2_5: {
      label: '슈퍼챗 2.5',
      src: 'https://cdn-image.wrtn.ai/crack/graphics/model-icon/superchat2_5.webp',
      engine: 'Sonnet 4.6',
    },
    superchat_2_0: {
      label: '슈퍼챗 2.0',
      src: 'https://cdn-image.wrtn.ai/crack/graphics/model-icon/superchat2_0.webp',
      engine: 'Sonnet 4.5',
    },
    superchat_1_5: {
      label: '슈퍼챗 1.5',
      src: 'https://cdn-image.wrtn.ai/crack/graphics/model-icon/superchat1_5.webp',
      color: '#0085FF',
      engine: 'Sonnet 4.0',
    },

    prochat_2_5: {
      label: '프로챗 2.5',
      src: 'https://cdn-image.wrtn.ai/crack/graphics/model-icon/prochat2_5.webp',
      engine: 'Gemini 3.1 Pro',
    },
    prochat_1_0: {
      label: '프로챗 1.0',
      src: 'https://cdn-image.wrtn.ai/crack/graphics/model-icon/prochat1_0.webp',
      engine: 'Gemini 2.5 Pro',
    },

    powerchat: {
      label: '파워챗',
      src: 'https://cdn-image.wrtn.ai/crack/graphics/model-icon/powerchat.webp',
      engine: 'Power',
    },
  };

  const MODEL_ORDER = [
    'hyperchat_2_0',
    'hyperchat_1_5',
    'hyperchat',
    'superchat_2_5',
    'superchat_2_0',
    'superchat_1_5',
    'prochat_2_5',
    'prochat_1_0',
    'powerchat',
  ];

  const messageStore = [];
  const iconMessageIndex = new Map();
  const unknownModels = new Map();

  function loadManualMap() {
    try {
      return JSON.parse(localStorage.getItem(ICON_STORAGE_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function saveManualMap(map) {
    try {
      localStorage.setItem(ICON_STORAGE_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  let manualMap = loadManualMap();

  function normalizeText(text) {
    return String(text || '')
      .replace(/\[\/\/\]: # \([^)]+\)/g, ' ')
      .replace(/```/g, ' ')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/[“”"]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compactText(text) {
    return normalizeText(text)
      .replace(/[^\p{L}\p{N}]/gu, '')
      .toLowerCase();
  }

  function stableKeyFromRoot(root) {
    let source = root;

    // 배지 자체의 '?'나 아이콘 대체 텍스트가 키에 섞이면
    // 수동 선택 저장키가 스캔마다 흔들릴 수 있으므로 제외한다.
    try {
      const clone = root?.cloneNode(true);
      clone?.querySelectorAll?.(
        '.crack-novel-model-badge, .crack-novel-model-menu, .crack-novel-model-menu-backdrop'
      ).forEach((el) => el.remove());
      source = clone || root;
    } catch (_) {}

    const text = normalizeText(source?.textContent || root?.textContent || '');
    const compact = compactText(text);
    const urlPart = location.pathname;
    return `${urlPart}::${compact.slice(0, 120)}::${compact.slice(-80)}`;
  }

  function normalizeModelToken(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[\s.-]+/g, '_');
  }

  function normalizeKnownCrackerModel(message) {
    const crackerModel = normalizeModelToken(message?.crackerModel);
    const crackerCompact = crackerModel.replace(/_/g, '');
    const model = normalizeModelToken(message?.model);
    const modelCompact = model.replace(/_/g, '');

    const aliases = {
      hyperchat_2_0: 'hyperchat_2_0',
      hyperchat20: 'hyperchat_2_0',
      hyper_chat_2_0: 'hyperchat_2_0',
      hyperchat_1_5: 'hyperchat_1_5',
      hyperchat15: 'hyperchat_1_5',
      hyper_chat_1_5: 'hyperchat_1_5',
      hyperchat: 'hyperchat',
      hyper_chat: 'hyperchat',

      superchat_2_5: 'superchat_2_5',
      superchat25: 'superchat_2_5',
      super_chat_2_5: 'superchat_2_5',
      superchat_2_0: 'superchat_2_0',
      superchat20: 'superchat_2_0',
      super_chat_2_0: 'superchat_2_0',
      superchat_1_5: 'superchat_1_5',
      superchat15: 'superchat_1_5',
      super_chat_1_5: 'superchat_1_5',

      prochat_2_5: 'prochat_2_5',
      prochat25: 'prochat_2_5',
      pro_chat_2_5: 'prochat_2_5',
      prochat_1_0: 'prochat_1_0',
      prochat10: 'prochat_1_0',
      pro_chat_1_0: 'prochat_1_0',

      powerchat: 'powerchat',
      power_chat: 'powerchat',
    };

    if (aliases[crackerModel]) return aliases[crackerModel];
    if (aliases[crackerCompact]) return aliases[crackerCompact];

    if (model.includes('gemini_3_1') || modelCompact.includes('gemini31')) return 'prochat_2_5';
    if (model.includes('gemini_2_5') || modelCompact.includes('gemini25')) return 'prochat_1_0';

    if (model.includes('opus_4_8') || modelCompact.includes('opus48')) return 'hyperchat_2_0';
    if (model.includes('opus_4_7') || modelCompact.includes('opus47')) return 'hyperchat_1_5';
    if (model.includes('opus_4_6') || modelCompact.includes('opus46')) return 'hyperchat';

    if (model.includes('sonnet_4_6') || modelCompact.includes('sonnet46')) return 'superchat_2_5';
    if (model.includes('sonnet_4_5') || modelCompact.includes('sonnet45')) return 'superchat_2_0';
    if (model.includes('sonnet_4_0') || modelCompact.includes('sonnet40')) return 'superchat_1_5';

    return null;
  }

  function isDebugEnabled() {
    try {
      return localStorage.getItem(ICON_DEBUG_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function recordUnknownIconModel(message, id) {
    const rawCrackerModel = message?.crackerModel;
    const rawModel = message?.model;
    const key = `${String(rawCrackerModel || '')}::${String(rawModel || '')}`;
    const current = unknownModels.get(key) || {
      count: 0,
      crackerModel: rawCrackerModel,
      model: rawModel,
      sampleId: id ? String(id) : '',
    };

    current.count += 1;
    unknownModels.set(key, current);

    if (isDebugEnabled()) {
      console.warn('[CrackModelIcon] unknown model:', current);
    }
  }

  function makeFingerprints(content) {
    const compact = compactText(content);
    const chunks = [];

    if (compact.length < 30) return chunks;

    const positions = new Set([
      0,
      Math.floor(compact.length * 0.25),
      Math.floor(compact.length * 0.5),
      Math.floor(compact.length * 0.75),
      Math.max(0, compact.length - 80),
    ]);

    for (const pos of positions) {
      const chunk = compact.slice(pos, pos + 55);
      if (chunk.length >= 35) chunks.push(chunk);
    }

    return [...new Set(chunks)];
  }

  function getIconMeta(token) {
    if (MODEL_BY_CRACKER[token]) return MODEL_BY_CRACKER[token];
    const safe = normalizeToken(token);
    if (!TOKEN_RE.test(safe) || safe === 'unknown') return null;
    const registered = modelRegistry[safe] || {};
    return { label: registered.label || autoLabel(safe), engine: cleanEngine(registered.engine), src: iconUrl(safe) };
  }

  function collectIconMessage(message) {
    const rawId = getMessageId(message);
    const role = String(message?.role || message?.sender || '').toLowerCase();
    if (!rawId || /user|human|member|owner/.test(role)) return;
    const crackerModel = normalizeKnownCrackerModel(message) || normalizeCrackerModelFromMessage(message);
    if (!getIconMeta(crackerModel)) {
      if (message?.crackerModel || message?.model) recordUnknownIconModel(message, rawId);
      return;
    }
    const roomKey = resolveRoomKeyFromMessage(message);
    const id = String(rawId);
    const indexKey = `${roomKey}::${id}`;
    const content = getMessageContent(message);
    const compactContent = compactText(content);
    const current = iconMessageIndex.get(indexKey);
    if (current) {
      if (compactContent.length <= current.compactContent.length && current.crackerModel === crackerModel) return;
      current.crackerModel = crackerModel;
      current.compactContent = compactContent;
      current.fingerprints = makeFingerprints(content);
    } else {
      const entry = { id, roomKey, crackerModel, compactContent, fingerprints: makeFingerprints(content) };
      messageStore.push(entry);
      iconMessageIndex.set(indexKey, entry);
      if (messageStore.length > 2000) {
        const evicted = messageStore.splice(0, messageStore.length - 2000);
        for (const item of evicted) iconMessageIndex.delete(`${item.roomKey}::${item.id}`);
      }
    }
    scheduleScan();
  }

  function collectIconGenerateDone(meta, token, roomKey) {
    const id = meta.msgId ? String(meta.msgId) : '';
    if (!id || !getIconMeta(token)) return;
    const indexKey = `${roomKey}::${id}`;
    if (iconMessageIndex.has(indexKey)) return;
    const entry = { id, roomKey, crackerModel: token, compactContent: '', fingerprints: [] };
    messageStore.push(entry);
    iconMessageIndex.set(indexKey, entry);
    if (messageStore.length > 2000) {
      const evicted = messageStore.splice(0, messageStore.length - 2000);
      for (const item of evicted) iconMessageIndex.delete(`${item.roomKey}::${item.id}`);
    }
    scheduleScan();
  }

  function patchGlobalJSONParse() {
    const original = W.JSON?.parse;
    if (!original || original.__cnmiCombinedPatched) return;
    function patchedParse(...args) {
      const result = original.apply(this, args);
      const source = args[0];
      if (typeof source === 'string' && /crackerModel|cracker_model|"model"|"modelId"|"model_id"/.test(source)) handleJson(result);
      return result;
    }
    patchedParse.__cnmiCombinedPatched = true;
    W.JSON.parse = patchedParse;
  }

  function scanStaticData() {
    try {
      const nextData = document.querySelector('#__NEXT_DATA__')?.textContent;
      if (nextData) handleText(nextData);
    } catch (_) {}

    try {
      document.querySelectorAll('script').forEach((script) => {
        const text = script.textContent || '';
        if (text.includes('crackerModel') || text.includes('"model"')) handleText(text);
      });
    } catch (_) {}

    try {
      for (const storage of [localStorage, sessionStorage]) {
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          const value = storage.getItem(key);
          if (value) handleText(value);
        }
      }
    } catch (_) {}
  }

  function getFooterParts(footer) {
    const children = [...footer.children];

    const leftSlot = children.find((el) =>
      el.classList.contains('flex') &&
      el.classList.contains('items-center') &&
      el.classList.contains('space-x-3')
    );

    const rightActions = children.find((el) =>
      el.classList.contains('flex') &&
      el.classList.contains('flex-row') &&
      el.classList.contains('gap-2') &&
      el.classList.contains('items-center')
    );

    return { leftSlot, rightActions };
  }

  function findFooters() {
    return [...document.querySelectorAll('.flex.items-center.justify-between.mt-2')]
      .filter((footer) => {
        const { leftSlot, rightActions } = getFooterParts(footer);
        return leftSlot && rightActions;
      });
  }

  function findMessageRootFromFooter(footer) {
    let node = footer.parentElement;

    for (let i = 0; i < 10 && node; i += 1) {
      const text = normalizeText(node.textContent);
      if (text.length > 30 && node.contains(footer)) return node;
      node = node.parentElement;
    }

    return footer.parentElement;
  }

  function scoreItem(item, visibleCompact, html) {
    if (html.includes(item.id)) return 100000;

    let score = 0;

    for (const fp of item.fingerprints || []) {
      if (!fp || fp.length < 35) continue;
      if (visibleCompact.includes(fp)) score += fp.length * 10;
    }

    const visibleHead = visibleCompact.slice(0, 100);
    if (visibleHead.length >= 60 && item.compactContent.includes(visibleHead)) {
      score += 1000;
    }

    const visibleTail = visibleCompact.slice(-100);
    if (visibleTail.length >= 60 && item.compactContent.includes(visibleTail)) {
      score += 800;
    }

    return score;
  }

  function findAutoModel(messageRoot) {
    const html = messageRoot.outerHTML || '';
    const currentRoom = getCurrentRoomKey();
    const currentEpisode = getCurrentEpisodeId();
    const visibleCompact = compactText(messageRoot.textContent || '');

    let best = null;
    let second = null;

    for (const item of messageStore) {
      if (item.roomKey !== currentRoom && item.roomKey !== currentEpisode) continue;
      const score = scoreItem(item, visibleCompact, html);
      const candidate = { item, score };

      if (!best || score > best.score) {
        second = best;
        best = candidate;
      } else if (!second || score > second.score) {
        second = candidate;
      }
    }

    if (!best || best.score < 250) return null;
    if (second && second.score > 0 && best.score < second.score * 1.2) return null;

    return best.item.crackerModel;
  }

  function modelLabel(crackerModel) {
    const meta = getIconMeta(crackerModel);
    if (!meta) return '모델 선택';
    return meta.engine ? `${meta.label} / ${meta.engine}` : meta.label;
  }

  function createModelImg(meta) {
    const img = document.createElement('img');
    img.src = meta.src;
    img.alt = meta.label;
    img.className = 'crack-novel-model-img';
    img.width = 16;
    img.height = 16;
    img.decoding = 'async';
    img.draggable = false;

    img.addEventListener('error', () => {
      const fallback = document.createElement('span');
      fallback.className = 'crack-novel-model-fallback';
      fallback.textContent = '?';
      fallback.title = '아이콘 로드 실패';
      img.replaceWith(fallback);
    }, { once: true });

    return img;
  }

  function createBadge(crackerModel, isManual) {
    const meta = getIconMeta(crackerModel);

    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'crack-novel-model-badge';
    badge.dataset.crackerModel = crackerModel || '';
    badge.dataset.manual = isManual ? '1' : '0';

    if (meta) {
      badge.appendChild(createModelImg(meta));
      badge.title = `${modelLabel(crackerModel)}${isManual ? ' (수동)' : ''}`;
    } else {
      badge.textContent = '?';
      badge.title = '모델 선택';
    }

    return badge;
  }

  function injectStyles() {
    if (document.getElementById('crack-novel-model-icon-style')) return;
    const style = document.createElement('style');
    style.id = 'crack-novel-model-icon-style';
    style.textContent = `
      .crack-novel-model-badge {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; border: 0; border-radius: 999px;
        background: transparent; line-height: 1; user-select: none;
        cursor: pointer; padding: 0; color: #9ca3af;
        font-size: 13px; font-weight: 800;
      }
      .crack-novel-model-img {
        display: block; width: 16px; height: 16px; object-fit: contain;
        pointer-events: none; user-select: none; flex: 0 0 16px;
      }
      .crack-novel-model-fallback {
        display: inline-flex; align-items: center; justify-content: center;
        width: 16px; height: 16px; color: #9ca3af; font-size: 13px; font-weight: 800;
        line-height: 1;
      }
      .crack-novel-model-menu-backdrop {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 999998;
      }
      .crack-novel-model-menu {
        position: fixed; z-index: 999999; min-width: 180px; padding: 6px;
        max-height: calc(100vh - 16px); overflow-y: auto;
        border-radius: 8px; border: 1px solid rgba(0,0,0,.12);
        background: rgba(255,255,255,.98); box-shadow: 0 8px 24px rgba(0,0,0,.16);
        font-size: 13px; color: #111827;
      }
      .crack-novel-model-menu-item {
        display: flex; align-items: center; width: 100%; gap: 8px;
        padding: 7px 8px; border: 0; border-radius: 6px;
        background: transparent; color: #111827; text-align: left; cursor: pointer;
      }
      .crack-novel-model-menu-item:hover { background: #f3f4f6; }
      .crack-novel-model-menu-icon {
        width: 16px; height: 16px; display: inline-flex; align-items: center;
        justify-content: center; flex: 0 0 16px;
      }
      .crack-novel-model-menu-clear {
        display: flex; align-items: center; width: 100%;
        padding: 7px 8px; border: 0; border-radius: 6px;
        background: transparent; color: #6b7280; text-align: left; cursor: pointer;
      }
      .crack-novel-model-menu-clear:hover { background: #f3f4f6; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function closeMenus() {
    document.querySelectorAll('.crack-novel-model-menu, .crack-novel-model-menu-backdrop').forEach((el) => el.remove());
  }

  function openMenu(anchor, messageKey, onPick) {
    closeMenus();

    // 투명 배경(Backdrop) 추가: 바깥 빈 공간 클릭 시 닫기
    const backdrop = document.createElement('div');
    backdrop.className = 'crack-novel-model-menu-backdrop';
    backdrop.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenus();
    });
    document.body.appendChild(backdrop);

    const menu = document.createElement('div');
    menu.className = 'crack-novel-model-menu';

    const menuKeys = [...MODEL_ORDER, ...Object.keys(modelRegistry).filter((key) => !MODEL_ORDER.includes(key) && TOKEN_RE.test(key))];
    for (const key of menuKeys) {
      const meta = getIconMeta(key);
      const item = document.createElement('button');
      item.type = 'button';
      item.title = meta.engine;

      item.className = 'crack-novel-model-menu-item';

      const iconSpan = document.createElement('span');
      iconSpan.className = 'crack-novel-model-menu-icon';
      iconSpan.appendChild(createModelImg(meta));

      const labelSpan = document.createElement('span');
      labelSpan.textContent = meta.label;

      item.appendChild(iconSpan);
      item.appendChild(labelSpan);

      item.addEventListener('click', (event) => {
        event.stopPropagation();
        manualMap[messageKey] = key;
        saveManualMap(manualMap);
        closeMenus();
        onPick(key, true);
      });

      menu.appendChild(item);
    }

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = '지우기';
    clear.className = 'crack-novel-model-menu-clear';
    clear.addEventListener('click', (event) => {
      event.stopPropagation();
      delete manualMap[messageKey];
      saveManualMap(manualMap);
      closeMenus();
      onPick(null, false);
    });
    menu.appendChild(clear);

    document.body.appendChild(menu);

    const rect = anchor.getBoundingClientRect();
    const menuW = menu.offsetWidth;
    const menuH = menu.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom;

    menu.style.left = `${Math.min(rect.left, window.innerWidth - menuW - 8)}px`;
    menu.style.top = spaceBelow >= menuH + 14
      ? `${rect.bottom + 6}px`
      : `${Math.max(8, rect.top - menuH - 6)}px`;
  }

  function renderBadge(leftSlot, messageRoot, crackerModel, isManual) {
    if (!leftSlot) return;

    const messageKey = stableKeyFromRoot(messageRoot);
    const oldBadge = leftSlot.querySelector('.crack-novel-model-badge');

    if (
      oldBadge &&
      oldBadge.dataset.crackerModel === (crackerModel || '') &&
      oldBadge.dataset.manual === (isManual ? '1' : '0')
    ) {
      return;
    }

    leftSlot.querySelectorAll('.crack-novel-model-badge').forEach((el) => el.remove());

    const badge = createBadge(crackerModel, isManual);

    badge.addEventListener('click', (event) => {
      event.stopPropagation();
      openMenu(badge, messageKey, (pickedModel, pickedManual) => {
        renderBadge(leftSlot, messageRoot, pickedModel, pickedManual);
      });
    });

    leftSlot.appendChild(badge);
  }

  function scanAndAttach() {
    if (!isCurrentChatRoom()) return;
    for (const footer of findFooters()) {
      const { leftSlot } = getFooterParts(footer);
      const root = findMessageRootFromFooter(footer);
      const messageKey = stableKeyFromRoot(root);

      const manualModel = manualMap[messageKey];
      const autoModel = findAutoModel(root);
      const model = manualModel || autoModel || null;

      renderBadge(leftSlot, root, model, Boolean(manualModel));
    }
  }

  function scheduleScan() {
    if (!isCurrentChatRoom()) return;
    clearTimeout(scheduleScan.timer);
    scheduleScan.timer = setTimeout(scanAndAttach, 200);
  }

  let iconObserver = null;
  function startIconDom() {
    injectStyles();
    scanStaticData();
    if (!iconObserver && document.documentElement) {
      iconObserver = new MutationObserver((mutations) => {
        if (!isCurrentChatRoom()) return;
        for (const m of mutations) {
          if (m.target?.closest?.('.crack-novel-model-badge, .crack-novel-model-menu, .crack-novel-model-menu-backdrop, #ccms-chat-model-stats-sidebar')) continue;
          if (m.addedNodes?.length || m.removedNodes?.length) { scheduleScan(); break; }
        }
      });
      iconObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    setTimeout(scanAndAttach, 300);
    setTimeout(scanAndAttach, 1200);
    setTimeout(scanAndAttach, 3000);
  }

  const MAX_SEEN_IDS_PER_ROOM = 2000;
  const PENDING_TTL_MS = 90 * 1000;
  const UI_REFRESH_DEBOUNCE_MS = 180;

  // registry: { [token]: { label, engine, firstSeen } }
  const TOKEN_RE = /^[a-z][a-z0-9]*(?:_\d+)*$/;

  function readRegistry() {
    try {
      const parsed = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  const modelRegistry = readRegistry();
  const engineTokenIndex = new Map();

  const pendingByRoom = new Map();
  const pendingSeen = new Set();
  const seenSetCache = new Map();

  let uiTimer = null;
  let routeTimer = null;
  let lastHref = location.href;
  let sidebarObserver = null;
  let sidebarObserverScope = null;
  let sidebarObserverSubtree = false;
  let ignoreMutationUntil = 0;
  let lastRenderSignature = '';

  // ─────────────────────────────────────────────
  // Storage
  // ─────────────────────────────────────────────
  function createEmptyStore() {
    return {
      v: 1,
      version: VERSION,
      rooms: {},
    };
  }

  function readStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '');
      if (!parsed || parsed.v !== 1 || typeof parsed !== 'object') return createEmptyStore();
      if (!parsed.rooms || typeof parsed.rooms !== 'object') parsed.rooms = {};
      return parsed;
    } catch (_) {
      return createEmptyStore();
    }
  }

  function writeStore(store) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (err) {
      console.warn('[CCMS] 저장 실패:', err);
    }
  }

  function getRoomData(store, roomKey) {
    const key = roomKey || getCurrentRoomKey();

    if (!store.rooms[key]) {
      store.rooms[key] = {
        models: {},
        seenIds: [],
        updatedAt: 0,
      };
    }

    const room = store.rooms[key];
    if (!room.models || typeof room.models !== 'object') room.models = {};
    if (!Array.isArray(room.seenIds)) room.seenIds = [];

    if (!seenSetCache.has(key)) {
      seenSetCache.set(key, new Set(room.seenIds.map(String)));
    }

    return room;
  }

  function getSeenSet(roomKey, room) {
    const key = roomKey || getCurrentRoomKey();

    if (!seenSetCache.has(key)) {
      seenSetCache.set(key, new Set((room?.seenIds || []).map(String)));
    }

    return seenSetCache.get(key);
  }

  function hasSeen(roomKey, room, id) {
    if (!id) return false;
    return getSeenSet(roomKey, room).has(String(id));
  }

  function markSeen(roomKey, room, id) {
    if (!id) return;

    const key = roomKey || getCurrentRoomKey();
    const safeId = String(id);
    const set = getSeenSet(key, room);

    if (set.has(safeId)) return;

    set.add(safeId);
    room.seenIds.push(safeId);

    if (room.seenIds.length > MAX_SEEN_IDS_PER_ROOM) {
      room.seenIds.splice(0, room.seenIds.length - MAX_SEEN_IDS_PER_ROOM);
      seenSetCache.set(key, new Set(room.seenIds.map(String)));
    }
  }

  function incrementModelCount(roomKey, modelKey, messageId) {
    const rawKey = String(modelKey || '');
    const key = rawKey === 'unknown' || !TOKEN_RE.test(rawKey) ? 'unknown' : rawKey;
    const safeRoomKey = roomKey || getCurrentRoomKey();

    const store = readStore();
    const room = getRoomData(store, safeRoomKey);

    if (hasSeen(safeRoomKey, room, messageId)) return false;

    room.models[key] = Number(room.models[key] || 0) + 1;
    markSeen(safeRoomKey, room, messageId);
    room.updatedAt = Date.now();

    writeStore(store);
    scheduleUiRefresh();
    return true;
  }

  function getCurrentRoomCounts() {
    const store = readStore();
    const room = store.rooms[getCurrentRoomKey()];
    return room?.models || {};
  }

  // ─────────────────────────────────────────────
  // Room key
  // ─────────────────────────────────────────────
  function getCurrentPathInfo() {
    const path = location.pathname || '';

    const storyEpisode = path.match(/\/stories\/([^/?#]+)\/episodes\/([^/?#]+)/);
    if (storyEpisode) {
      return {
        storyId: storyEpisode[1],
        episodeId: storyEpisode[2],
        key: `${storyEpisode[1]}:${storyEpisode[2]}`,
      };
    }

    const episode = path.match(/\/episodes\/([^/?#]+)/);
    if (episode) {
      return {
        storyId: '',
        episodeId: episode[1],
        key: episode[1],
      };
    }

    const chat = path.match(/\/chat\/([^/?#]+)/);
    if (chat) {
      return {
        storyId: '',
        episodeId: chat[1],
        key: chat[1],
      };
    }

    return {
      storyId: '',
      episodeId: '',
      key: path || 'default',
    };
  }

  function isCrackChatRoomPath(pathname = location.pathname) {
    const path = String(pathname || '');

    return /\/stories\/[^/?#]+\/episodes\/[^/?#]+\/?$/i.test(path)
      || /\/episodes\/[^/?#]+\/?$/i.test(path)
      || /\/chat\/[^/?#]+\/?$/i.test(path);
  }

  function isCurrentChatRoom() {
    return isCrackChatRoomPath(location.pathname || '');
  }

  function getCurrentRoomKey() {
    return getCurrentPathInfo().key;
  }

  function getCurrentEpisodeId() {
    return getCurrentPathInfo().episodeId;
  }

  function resolveRoomKeyFromMessage(message) {
    const explicit = getMessageRoomId(message);
    const current = getCurrentPathInfo();

    if (!explicit) return current.key;
    if (current.episodeId && String(explicit) === String(current.episodeId)) return current.key;

    return String(explicit);
  }

  function getMessageRoomId(message) {
    return message?.chatId
      || message?.chat_id
      || message?.episodeId
      || message?.episode_id
      || message?.roomId
      || message?.room_id
      || message?.chat?._id
      || message?.chat?.id
      || message?.episode?._id
      || message?.episode?.id
      || '';
  }

  // ─────────────────────────────────────────────
  // Model registry / normalize
  // ─────────────────────────────────────────────
  function normalizeToken(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[\s.-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  }

  function autoLabel(token) {
    // hyperchat_2_0 → "Hyperchat 2.0", powerchat → "Powerchat"
    const m = String(token).match(/^([a-z][a-z0-9]*?)(?:_(\d+)(?:_(\d+))?)?$/);
    if (!m) return String(token);
    const brand = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    if (!m[2]) return brand;
    return `${brand} ${m[2]}${m[3] != null ? `.${m[3]}` : ''}`;
  }

  function iconUrl(token) {
    // hyperchat_2_0 → hyperchat2_0.webp (첫 밑줄만 제거)
    const urlToken = String(token).replace(/^([a-z][a-z0-9]*)_(?=\d)/, '$1');
    return `https://cdn-image.wrtn.ai/crack/graphics/model-icon/${urlToken}.webp`;
  }

  function cleanEngine(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function engineLookupKey(value) {
    return cleanEngine(value).toLowerCase();
  }

  function indexEngine(token, engine) {
    const key = engineLookupKey(engine);
    if (!key || !TOKEN_RE.test(token)) return;
    if (!engineTokenIndex.has(key)) engineTokenIndex.set(key, token);
  }

  function rebuildEngineIndex() {
    engineTokenIndex.clear();

    for (const [token, meta] of Object.entries(modelRegistry)) {
      indexEngine(token, meta?.engine);
    }
  }

  rebuildEngineIndex();

  function writeRegistry() {
    try {
      localStorage.setItem(REGISTRY_KEY, JSON.stringify(modelRegistry));
    } catch (_) {
      // 저장이 막혀도 현재 페이지의 메모리 registry는 계속 사용한다.
    }
  }

  function ensureModel(token, rawEngine) {
    const safeToken = normalizeToken(token);
    if (!TOKEN_RE.test(safeToken) || safeToken === 'unknown') return null;

    const engine = cleanEngine(rawEngine);
    const current = modelRegistry[safeToken];

    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      modelRegistry[safeToken] = {
        label: autoLabel(safeToken),
        engine,
        firstSeen: Date.now(),
      };
      indexEngine(safeToken, engine);
      writeRegistry();
      scheduleUiRefresh();
      return modelRegistry[safeToken];
    }

    let changed = false;

    if (!current.label) {
      current.label = autoLabel(safeToken);
      changed = true;
    }

    if (!current.engine && engine) {
      current.engine = engine;
      indexEngine(safeToken, engine);
      changed = true;
    }

    if (!current.firstSeen) {
      current.firstSeen = Date.now();
      changed = true;
    }

    if (changed) {
      writeRegistry();
      scheduleUiRefresh();
    }

    return current;
  }

  function findRegistryTokenByEngine(rawEngine) {
    const target = engineLookupKey(rawEngine);
    return target ? (engineTokenIndex.get(target) || '') : '';
  }

  function resolveModelToken(rawCrackerModel, rawEngine) {
    const hasCrackerModel = String(rawCrackerModel || '').trim().length > 0;

    if (hasCrackerModel) {
      const token = normalizeToken(rawCrackerModel);

      if (TOKEN_RE.test(token)) {
        ensureModel(token, rawEngine);
        return token;
      }

      console.debug('[CCMS] 등록할 수 없는 crackerModel 토큰:', rawCrackerModel);
      return '';
    }

    return findRegistryTokenByEngine(rawEngine);
  }

  function normalizeCrackerModelFromMessage(message) {
    const rawCrackerModel = message?.crackerModel || message?.cracker_model || '';
    const rawEngine = message?.model || message?.modelId || message?.model_id || message?.engine || '';

    return resolveModelToken(rawCrackerModel, rawEngine);
  }

  // ─────────────────────────────────────────────
  // Message candidate collection
  // ─────────────────────────────────────────────
  function getMessageId(message) {
    return message?._id
      || message?.id
      || message?.messageId
      || message?.message_id
      || message?.msgId
      || message?.msg_id
      || message?.fe_msg_id
      || '';
  }

  function getMessageContent(message) {
    const value = message?.content
      ?? message?.text
      ?? message?.message
      ?? message?.reply
      ?? message?.body
      ?? '';

    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(v => typeof v === 'string' ? v : '').join('\n');
    return '';
  }

  function getMessageTimestamp(message) {
    const raw = message?.createdAt || message?.created_at || message?.updatedAt || message?.updated_at || '';
    const parsed = raw ? new Date(raw).getTime() : 0;

    if (Number.isFinite(parsed) && parsed > 0) return parsed;

    const id = String(getMessageId(message) || '');
    if (/^[a-f0-9]{8}/i.test(id)) {
      const ts = parseInt(id.slice(0, 8), 16) * 1000;
      if (Number.isFinite(ts) && ts > 0) return ts;
    }

    return Date.now();
  }

  function isAssistantLikeMessage(message) {
    if (!message || typeof message !== 'object') return false;

    const role = String(message.role || message.sender || message.authorRole || message.type || '').toLowerCase();
    if (/user|human|member|owner/.test(role)) return false;

    const hasModel = !!(
      message.crackerModel
      || message.cracker_model
      || message.model
      || message.modelId
      || message.model_id
      || message.engine
    );

    if (!hasModel) return false;

    const id = getMessageId(message);
    const content = getMessageContent(message);
    const hasContent = typeof content === 'string' && content.trim().length > 0;

    if (/assistant|ai|bot|character|model/.test(role)) return !!(id || hasContent);
    if (id && hasContent) return true;

    return false;
  }

  function tinyHash(text) {
    const source = String(text || '');
    let h = 2166136261;

    for (let i = 0; i < Math.min(source.length, 240); i += 1) {
      h ^= source.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }

    return Math.abs(h >>> 0).toString(36);
  }

  function makeFallbackMessageId(roomKey, modelKey, content, ts) {
    const bucket = Math.floor(Number(ts || Date.now()) / 5000);
    return `fallback:${roomKey}:${modelKey}:${content.length}:${tinyHash(content)}:${bucket}`;
  }

  function addPendingCandidate(message) {
    if (!isAssistantLikeMessage(message)) return;

    const modelKey = normalizeCrackerModelFromMessage(message) || 'unknown';
    if (modelKey === 'unknown') {
      console.debug('[CCMS] 모델 키 확인 실패:', {
        crackerModel: message?.crackerModel || message?.cracker_model || '',
        model: message?.model || message?.modelId || message?.model_id || message?.engine || '',
      });
    }

    const roomKey = resolveRoomKeyFromMessage(message);
    const content = getMessageContent(message);
    const ts = getMessageTimestamp(message);
    const rawId = getMessageId(message);

    const id = rawId
      ? String(rawId)
      : makeFallbackMessageId(roomKey, modelKey, content, ts);

    const pendingKey = `${roomKey}::${id}`;
    if (pendingSeen.has(pendingKey)) return;

    pendingSeen.add(pendingKey);

    if (!pendingByRoom.has(roomKey)) pendingByRoom.set(roomKey, []);

    pendingByRoom.get(roomKey).push({
      id,
      roomKey,
      modelKey,
      ts,
      addedAt: Date.now(),
    });

    prunePending();
  }

  function prunePending() {
    const now = Date.now();

    for (const [roomKey, list] of pendingByRoom.entries()) {
      const next = list.filter(item => now - item.addedAt <= PENDING_TTL_MS);

      if (next.length) pendingByRoom.set(roomKey, next);
      else pendingByRoom.delete(roomKey);
    }

    if (pendingSeen.size > 5000) {
      pendingSeen.clear();

      for (const list of pendingByRoom.values()) {
        for (const item of list) {
          pendingSeen.add(`${item.roomKey}::${item.id}`);
        }
      }
    }
  }

  function collectFreshCandidates(options = {}) {
    prunePending();

    const currentKey = getCurrentRoomKey();
    const currentEpisodeId = getCurrentEpisodeId();
    const requestedChatId = options.chatId ? String(options.chatId) : '';

    const keys = new Set([currentKey]);

    if (currentEpisodeId) keys.add(String(currentEpisodeId));
    if (requestedChatId) keys.add(requestedChatId);

    const candidates = [];

    for (const key of keys) {
      const list = pendingByRoom.get(key);
      if (!list || !list.length) continue;

      for (const item of list) {
        candidates.push({
          ...item,
          roomKey: currentKey,
        });
      }
    }

    const now = Date.now();

    return candidates
      .filter(item => now - item.addedAt <= PENDING_TTL_MS)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0) || (b.addedAt || 0) - (a.addedAt || 0));
  }

  function finalizeLatestCandidate(options = {}) {
    const fresh = collectFreshCandidates(options);
    if (!fresh.length) return false;

    let target = null;

    if (options.msgId) {
      const msgId = String(options.msgId);
      target = fresh.find(item => String(item.id) === msgId)
        || fresh.find(item => String(item.id).includes(msgId) || msgId.includes(String(item.id)));
    }

    if (!target) target = fresh[0];
    if (!target) return false;

    const currentKey = getCurrentRoomKey();
    const ok = incrementModelCount(currentKey, target.modelKey, target.id);

    if (ok) {
      removePendingCandidate(target);
      console.log('[CCMS] 모델 통계 +1:', {
        roomKey: currentKey,
        model: target.modelKey,
        messageId: target.id,
        trigger: options.trigger || 'unknown',
        msgId: options.msgId || '',
      });
    }

    return ok;
  }

  function removePendingCandidate(target) {
    for (const [roomKey, list] of pendingByRoom.entries()) {
      const next = list.filter(item => item.id !== target.id);

      if (next.length) pendingByRoom.set(roomKey, next);
      else pendingByRoom.delete(roomKey);
    }
  }

  // ─────────────────────────────────────────────
  // JSON walk / network patch
  // ─────────────────────────────────────────────
  function walkJson(value, depth = 0, seen = new WeakSet()) {
    if (!value || depth > 12) return;

    if (typeof value === 'object') {
      if (seen.has(value)) return;
      seen.add(value);
    }

    if (Array.isArray(value)) {
      for (const item of value) walkJson(item, depth + 1, seen);
      return;
    }

    if (typeof value !== 'object') return;

    if (getMessageId(value) && (value.crackerModel || value.cracker_model || value.model || value.modelId || value.model_id || value.engine)) collectIconMessage(value);
    if (isAssistantLikeMessage(value)) addPendingCandidate(value);

    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') {
        walkJson(child, depth + 1, seen);
      }
    }
  }

  function handleJson(json) {
    try {
      walkJson(json);
    } catch (_) {}
  }

  function handleText(text) {
    if (typeof text !== 'string') return;
    if (!/crackerModel|cracker_model|"model"|"modelId"|"model_id"/.test(text)) return;

    try {
      handleJson(JSON.parse(text));
      return;
    } catch (_) {}

    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

    if (lines.length > 1 && lines.length < 300) {
      for (const line of lines) {
        const cleaned = line.replace(/^data:\s*/i, '').trim();

        if (!cleaned || cleaned === '[DONE]') continue;
        if (!/crackerModel|cracker_model|"model"|"modelId"|"model_id"/.test(cleaned)) continue;

        try {
          handleJson(JSON.parse(cleaned));
        } catch (_) {}
      }
    }
  }

  function shouldInspectUrl(url) {
    const u = String(url || '');

    if (!u) return false;
    if (/\.(webp|png|jpe?g|gif|svg|css|js|woff2?|ttf|otf|mp4|webm|mp3|wav)(\?|$)/i.test(u)) return false;
    if (/cdn-image\.wrtn\.ai|static\.wrtn\.ai|gstatic|googletagmanager|google-analytics|analytics/i.test(u)) return false;

    // 모델 통계에 필요한 후보만 훑는다.
    // API 메모상 메시지/채팅 생성 흐름은 crack-gen, contents-api, character-chat 계열에서 관찰됐다.
    return /crack-api\.wrtn\.ai\/(crack-gen|character-chat)\//i.test(u)
      || /contents-api\.wrtn\.ai\/character-chat\//i.test(u)
      || /\/(crack-gen|character-chat)\//i.test(u);
  }

  function shouldInspectContentType(contentType) {
    const ct = String(contentType || '').toLowerCase();

    if (!ct) return true;
    return /json|event-stream|text\/plain|x-ndjson/.test(ct);
  }

  function patchFetch() {
    const originalFetch = W.fetch;
    if (!originalFetch || originalFetch.__ccmsPatched) return;

    function patchedFetch(input, ...rest) {
      const url = typeof input === 'string' ? input : (input?.url || input?.href);
      const inspectUrl = shouldInspectUrl(url);

      const promise = originalFetch.call(this, input, ...rest);

      if (!inspectUrl) return promise;

      return promise.then((response) => {
        try {
          const ct = response.headers?.get?.('content-type') || '';

          if (shouldInspectContentType(ct)) {
            response.clone().text().then(handleText).catch(() => {});
          }
        } catch (_) {}

        return response;
      });
    }

    patchedFetch.__ccmsPatched = true;
    W.fetch = patchedFetch;
  }

  function patchXHR() {
    const XHR = W.XMLHttpRequest;
    if (!XHR || XHR.prototype.__ccmsPatched) return;

    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url, ...rest) {
      try {
        this.__ccmsUrl = url;
      } catch (_) {}

      return originalOpen.call(this, method, url, ...rest);
    };

    XHR.prototype.send = function (...args) {
      try {
        this.addEventListener('load', function () {
          try {
            if (!shouldInspectUrl(this.__ccmsUrl)) return;

            const responseType = String(this.responseType || '');
            if (responseType && responseType !== 'text') return;

            const ct = this.getResponseHeader?.('content-type') || '';
            if (!shouldInspectContentType(ct)) return;

            if (typeof this.responseText === 'string') handleText(this.responseText);
          } catch (_) {}
        });
      } catch (_) {}

      return originalSend.apply(this, args);
    };

    XHR.prototype.__ccmsPatched = true;
  }

  // ─────────────────────────────────────────────
  // generate_done hook
  // ─────────────────────────────────────────────
  function getGenerateDoneWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow?.document === document) return unsafeWindow;
    } catch (_) {}

    return window;
  }

  function extractGenerateDoneMeta(entry) {
    let eventName = '';
    let meta = null;

    if ((Array.isArray(entry) || typeof entry?.length === 'number') && entry[0] === 'event') {
      eventName = String(entry[1] || '');
      meta = entry[2] || {};
    } else {
      eventName = String(entry?.event || '');
      meta = entry || {};
    }

    return {
      eventName,
      msgId: meta?.msg_id || meta?.fe_msg_id || meta?.message_id || meta?.messageId || meta?.id || '',
      chatId: meta?.chat_id || meta?.episode_id || meta?.chatId || meta?.episodeId || '',
      chatMode: meta?.chat_mode || meta?.chatMode || '',
      modelName: meta?.model_name || meta?.modelName || '',
    };
  }

  function isGenerateDoneEntry(entry) {
    return /^generate_done$/i.test(extractGenerateDoneMeta(entry).eventName);
  }

  function getGenerateDoneEntryKey(entry) {
    const meta = extractGenerateDoneMeta(entry);

    if (meta.msgId) return `${meta.chatId || getCurrentRoomKey()}::${meta.msgId}`;

    return `time::${getCurrentRoomKey()}::${Math.floor(Date.now() / 1500)}`;
  }

  function handleGenerateDoneEntry(entry) {
    if (!isGenerateDoneEntry(entry)) return false;

    const eventWindow = getGenerateDoneWindow();
    const key = getGenerateDoneEntryKey(entry);

    if (eventWindow.__ccmsLastGenerateDoneKey === key) return true;
    eventWindow.__ccmsLastGenerateDoneKey = key;

    const meta = extractGenerateDoneMeta(entry);
    onGenerateDoneSignal(meta);

    return true;
  }

  function resolveGenerateDoneRoomKey(chatId) {
    const current = getCurrentPathInfo();

    if (!chatId) return current.key;
    if (current.episodeId && String(chatId) === String(current.episodeId)) return current.key;

    return String(chatId);
  }

  function onGenerateDoneSignal(meta = {}) {
    const msgId = meta.msgId || '';
    const chatId = meta.chatId || '';

    // 1순위: generate_done 이벤트의 chat_mode/model_name로 직접 집계.
    //        네트워크 응답 파싱에 의존하지 않으므로 모든 방에서 동작.
    const directModel = resolveModelToken(meta.chatMode, meta.modelName);

    if (directModel) {
      const roomKey = resolveGenerateDoneRoomKey(chatId);
      collectIconGenerateDone(meta, directModel, roomKey);
      const dedupId = msgId
        ? String(msgId)
        : `gd:${roomKey}:${directModel}:${Math.floor(Date.now() / 1500)}`;

      const ok = incrementModelCount(roomKey, directModel, dedupId);

      if (ok) {
        console.log('[CCMS] 모델 통계 +1 (generate_done):', {
          roomKey,
          model: directModel,
          messageId: dedupId,
          chatMode: meta.chatMode || '',
          modelName: meta.modelName || '',
        });
      }

      return;
    }

    // 2순위(폴백): chat_mode를 못 읽었을 때만 기존 pending 파이프라인 사용.
    const options = { msgId, chatId };

    setTimeout(() => finalizeLatestCandidate({ ...options, trigger: 'generate_done:200ms' }), 200);
    setTimeout(() => finalizeLatestCandidate({ ...options, trigger: 'generate_done:800ms' }), 800);
    setTimeout(() => finalizeLatestCandidate({ ...options, trigger: 'generate_done:1600ms' }), 1600);
  }

  function processDataLayerBacklog(eventWindow) {
    try {
      const layer = eventWindow.dataLayer;
      if (!Array.isArray(layer)) return;

      const from = Math.max(0, Number(eventWindow.__ccmsDataLayerSeenLen || 0));
      const to = layer.length;

      if (to < from) {
        eventWindow.__ccmsDataLayerSeenLen = to;
        return;
      }

      for (let i = from; i < to; i += 1) {
        handleGenerateDoneEntry(layer[i]);
      }

      eventWindow.__ccmsDataLayerSeenLen = to;
    } catch (_) {}
  }

  function startGenerateDoneHook() {
    const eventWindow = getGenerateDoneWindow();
    const dl = eventWindow.dataLayer = eventWindow.dataLayer || [];

    if (eventWindow.__ccmsGenerateDoneHookStarted) return;
    eventWindow.__ccmsGenerateDoneHookStarted = true;

    if (eventWindow.__ccmsDataLayerSeenLen == null) {
      eventWindow.__ccmsDataLayerSeenLen = 0;
    }

    clearInterval(eventWindow.__ccmsGenerateDonePollTimer);
    processDataLayerBacklog(eventWindow);

    if (!Array.isArray(dl) || dl.__ccmsPushPatched) return;

    const originalPush = dl.push;

    dl.push = function (...items) {
      const result = originalPush.apply(this, items);

      try {
        for (const item of items) {
          handleGenerateDoneEntry(item);
        }

        eventWindow.__ccmsDataLayerSeenLen = this.length;
      } catch (_) {}

      return result;
    };

    dl.__ccmsPushPatched = true;
  }

  // ─────────────────────────────────────────────
  // Sidebar UI
  // ─────────────────────────────────────────────
  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${SIDEBAR_ID} {
        /* 레이아웃 들썩임 방지: 통계 영역 높이를 예측 가능하게 고정 */
        padding: 0 0 14px;
        box-sizing: border-box;
        contain: layout paint style;
      }

      #${SIDEBAR_ID} .ccms-title {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 29px;
        padding: 8px 8px 7px;
        box-sizing: border-box;
        color: var(--text_tertiary, #8a8a8a);
        line-height: 1;
        user-select: none;
      }

      #${SIDEBAR_ID} .ccms-total {
        margin-left: auto;
        padding-right: 2px;
        font-size: 11px;
        font-weight: 700;
        color: var(--text_secondary, #a0a0a0);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      #${SIDEBAR_ID} .ccms-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        align-items: center;
        gap: 6px;
        min-height: 30px;
        padding: 0 10px;
        box-sizing: border-box;
        overflow: visible;
      }

      #${SIDEBAR_ID} .ccms-item {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-width: 0;
        padding: 4px 5px;
        border-radius: 999px;
        background: var(--bg_input, rgba(128,128,128,.10));
        border: 1px solid var(--border, rgba(128,128,128,.14));
        line-height: 1;
        box-sizing: border-box;
      }

      #${SIDEBAR_ID} .ccms-icon-slot {
        width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
      }

      #${SIDEBAR_ID} .ccms-icon {
        width: 18px;
        height: 18px;
        object-fit: contain;
        display: block;
        pointer-events: none;
        user-select: none;
        flex: 0 0 auto;
      }

      #${SIDEBAR_ID} .ccms-count {
        font-size: 11px;
        font-weight: 700;
        color: var(--text_secondary, #a0a0a0);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      #${SIDEBAR_ID} .ccms-fallback[hidden] {
        display: none !important;
      }

      #${SIDEBAR_ID} .ccms-fallback {
        width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 800;
        color: var(--text_tertiary, #999);
        background: var(--bg_input, rgba(128,128,128,.16));
        border: 1px solid var(--border, rgba(128,128,128,.22));
        box-sizing: border-box;
      }
    `;

    const head = document.head || document.documentElement;
    head.appendChild(style);
  }

  function removeSidebarUi() {
    const row = document.getElementById(SIDEBAR_ID);
    if (row) row.remove();

    lastRenderSignature = '';
  }

  function findCrackerBalanceRow() {
    const labels = Array.from(document.querySelectorAll('span, p'))
      .filter(el => (el.textContent || '').trim() === '나의 크래커');

    for (const label of labels) {
      let cursor = label;

      for (let i = 0; i < 8 && cursor; i += 1) {
        cursor = cursor.nextElementSibling;
        if (!cursor) break;

        const text = cursor.textContent || '';
        const hasNumber = /[\d,]{2,}/.test(text);
        const isDiv = cursor.tagName === 'DIV';

        if (isDiv && hasNumber) return cursor;
      }
    }

    return null;
  }

  function ensureSidebarUi() {
    if (!document.body) return null;

    if (!isCurrentChatRoom()) {
      removeSidebarUi();
      return null;
    }

    injectStyle();

    let row = document.getElementById(SIDEBAR_ID);
    if (row && row.isConnected) return row;

    const balanceRow = findCrackerBalanceRow();
    if (!balanceRow || !balanceRow.parentElement) return null;

    row = document.createElement('div');
    row.id = SIDEBAR_ID;
    row.innerHTML = `
      <div class="ccms-title typo-text-md_leading-none_medium p-2 text-text_tertiary">
        <span>모델별 통계</span>
        <span class="ccms-total" data-ccms-total></span>
      </div>
      <div class="ccms-grid" data-ccms-grid></div>
    `;

    balanceRow.insertAdjacentElement('afterend', row);
    return row;
  }

  function getRegistryMeta(token) {
    if (token === 'unknown') {
      return {
        label: '알 수 없음',
        engine: '',
      };
    }

    const normalized = normalizeToken(token);
    const registered = TOKEN_RE.test(normalized) ? modelRegistry[normalized] : null;

    return {
      label: registered?.label || autoLabel(normalized || token),
      engine: cleanEngine(registered?.engine),
    };
  }

  function getSortedModelEntries(counts) {
    return Object.entries(counts || {})
      .map(([key, count]) => [String(key), Number(count || 0)])
      .filter(([, count]) => count > 0)
      .sort((a, b) => {
        const countDiff = Number(b[1] || 0) - Number(a[1] || 0);
        if (countDiff) return countDiff;

        const aLabel = getRegistryMeta(a[0]).label;
        const bLabel = getRegistryMeta(b[0]).label;
        return aLabel.localeCompare(bLabel);
      });
  }


  function renderSidebarUi() {
    if (!isCurrentChatRoom()) {
      removeSidebarUi();
      return false;
    }

    const row = ensureSidebarUi();
    if (!row) return false;

    const grid = row.querySelector('[data-ccms-grid]');
    const totalEl = row.querySelector('[data-ccms-total]');
    if (!grid) return false;

    const entries = getSortedModelEntries(getCurrentRoomCounts());
    const total = entries.reduce((sum, [, c]) => sum + Number(c || 0), 0);

    // 같은 내용이면 DOM을 다시 갈아엎지 않음.
    // 사이드바 재감지/MutationObserver 때문에 생기는 잔떨림 완화용.
    const signature = `${getCurrentRoomKey()}::${total}::${entries.map(([key, count]) => {
      const meta = getRegistryMeta(key);
      return `${key}:${count}:${meta.label}:${meta.engine}`;
    }).join('|')}`;

    if (lastRenderSignature === signature && row.isConnected) {
      return true;
    }

    lastRenderSignature = signature;

    ignoreMutationUntil = Date.now() + 500;

    if (totalEl) totalEl.textContent = total ? `총 ${total}회` : '';

    if (!entries.length) {
      grid.innerHTML = '';
      return true;
    }

    grid.innerHTML = entries.map(([key, count]) => {
      const meta = getRegistryMeta(key);
      const title = `${meta.label}${meta.engine ? ' / ' + meta.engine : ''} · ${count}회`;
      const normalized = normalizeToken(key);
      const canUseIcon = key !== 'unknown' && TOKEN_RE.test(normalized);

      const icon = canUseIcon
        ? `<span class="ccms-icon-slot"><img class="ccms-icon" data-ccms-icon src="${escapeHtml(iconUrl(normalized))}" alt="${escapeHtml(meta.label)}" loading="eager" decoding="async" draggable="false"><span class="ccms-fallback" data-ccms-fallback hidden>?</span></span>`
        : `<span class="ccms-fallback">?</span>`;

      return `
        <div class="ccms-item" title="${escapeHtml(title)}">
          ${icon}
          <span class="ccms-count">${escapeHtml(String(count))}</span>
        </div>
      `;
    }).join('');

    for (const img of grid.querySelectorAll('[data-ccms-icon]')) {
      const showFallback = () => {
        img.hidden = true;
        const fallback = img.nextElementSibling;
        if (fallback?.matches?.('[data-ccms-fallback]')) fallback.hidden = false;
      };

      img.addEventListener('error', showFallback, { once: true });
      if (img.complete && !img.naturalWidth) showFallback();
    }

    return true;
  }

  function scheduleUiRefresh() {
    clearTimeout(uiTimer);

    uiTimer = setTimeout(() => {
      renderSidebarUi();
      connectSidebarObserver();
    }, UI_REFRESH_DEBOUNCE_MS);
  }

  function getSidebarObserverScope() {
    const balanceRow = findCrackerBalanceRow();

    return balanceRow?.closest?.('aside, nav, [class*="sidebar"], [class*="Sidebar"], [class*="side"], [class*="Side"]')
      || document.body
      || null;
  }

  function connectSidebarObserver() {
    if (!document.body) return;

    if (!isCurrentChatRoom()) {
      removeSidebarUi();

      try {
        sidebarObserver?.disconnect?.();
      } catch (_) {}

      sidebarObserver = null;
      sidebarObserverScope = null;
      sidebarObserverSubtree = false;
      return;
    }

    const scope = getSidebarObserverScope();
    if (!scope) return;

    const subtree = scope !== document.body;

    if (sidebarObserver && sidebarObserverScope === scope && sidebarObserverSubtree === subtree) return;

    try {
      sidebarObserver?.disconnect?.();
    } catch (_) {}

    sidebarObserverScope = scope;
    sidebarObserverSubtree = subtree;

    sidebarObserver = new MutationObserver((mutations) => {
      if (Date.now() < ignoreMutationUntil) return;

      let worth = false;

      for (const m of mutations) {
        if (m.type !== 'childList') continue;
        if (m.target?.closest?.(`#${SIDEBAR_ID}`)) continue;

        if (m.addedNodes?.length || m.removedNodes?.length) {
          worth = true;
          break;
        }
      }

      if (worth) scheduleUiRefresh();
    });

    sidebarObserver.observe(scope, {
      childList: true,
      subtree,
    });
  }

  function startRouteWatcher() {
    clearInterval(routeTimer);

    routeTimer = setInterval(() => {
      if (location.href === lastHref) return;

      lastHref = location.href;

      if (!isCurrentChatRoom()) removeSidebarUi();

      scheduleUiRefresh();
      scheduleScan();
    }, 800);
  }

  // ─────────────────────────────────────────────
  // Init / console API
  // ─────────────────────────────────────────────
  function installPatches() {
    patchGlobalJSONParse();
    patchFetch();
    patchXHR();
    startGenerateDoneHook();
  }

  function initDomPart() {
    startIconDom();
    injectStyle();
    connectSidebarObserver();
    startRouteWatcher();
    scheduleUiRefresh();
  }

  installPatches();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDomPart, { once: true });
  } else {
    initDomPart();
  }

  W.__crackModelIconStore = messageStore;
  W.__crackModelIconUnknownModels = () => [...unknownModels.values()];
  W.__crackModelIconRescan = scanAndAttach;
  W.__crackModelIconDebugOn = () => {
    try { localStorage.setItem(ICON_DEBUG_KEY, '1'); } catch (_) {}
    return 'Crack Model Icon debug: ON';
  };
  W.__crackModelIconDebugOff = () => {
    try { localStorage.removeItem(ICON_DEBUG_KEY); } catch (_) {}
    return 'Crack Model Icon debug: OFF';
  };
  W.__crackModelIconStats = () => ({
    stored: messageStore.length, footers: findFooters().length,
    manualCount: Object.keys(manualMap).length, unknownModelCount: unknownModels.size,
  });

  W.__ccmsModelStats = {
    version: VERSION,
    store: () => readStore(),
    currentKey: () => getCurrentRoomKey(),
    currentCounts: () => getCurrentRoomCounts(),
    refresh: () => renderSidebarUi(),
    finalize: (msgId = '') => finalizeLatestCandidate({ trigger: 'manual', msgId }),
    pending: () => {
      const out = {};
      for (const [key, list] of pendingByRoom.entries()) out[key] = list.slice();
      return out;
    },
    clearCurrent: () => {
      const store = readStore();
      const key = getCurrentRoomKey();

      delete store.rooms[key];
      seenSetCache.delete(key);

      writeStore(store);
      renderSidebarUi();

      console.log('[CCMS] 현재 방 통계 초기화 완료');
    },
    clearAll: () => {
      localStorage.removeItem(STORE_KEY);
      seenSetCache.clear();
      renderSidebarUi();

      console.log('[CCMS] 전체 통계 초기화 완료');
    },
    addTest: (model = 'hyperchat_2_0', n = 1) => {
      const roomKey = getCurrentRoomKey();

      for (let i = 0; i < Number(n || 1); i += 1) {
        incrementModelCount(roomKey, model, `test:${Date.now()}:${Math.random()}`);
      }

      renderSidebarUi();
    },
  };

  console.log(`[CCMS] Crack Chat Model Stats v${VERSION} 로드됨`);
})();
