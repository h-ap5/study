// ==UserScript==
// @name         🧩 Crack Chat Hub (크랙 채팅 허브)
// @namespace    https://crack.wrtn.ai/
// @version      1.1.5
// @description  크랙 채팅 합본: 임시저장, 글자수, 채팅창 펼치기, 대시보드, 라디오존데, 채팅·출력 모델 공통 숨김.
// @match        https://crack.wrtn.ai/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      rs.igx.kr
// @connect      igx-radiosonde-api-striker.b-cdn.net
// @connect      claude-radiosonde.chyoyam.chatgpt.site
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/gh/milkyway0308/crystallized-chasm@crack-shared-core@v1.2.1/crack/libraries/crack-shared-core.js
// @require      https://cdn.jsdelivr.net/gh/milkyway0308/crystallized-chasm@chasm-shared-core@v1.0.0/libraries/chasm-shared-core.js
// ==/UserScript==

(() => {
'use strict';
if(window.__CRACK_CHAT_HUB_110__)return;
window.__CRACK_CHAT_HUB_110__=true;
// 공통 수명주기: 입력창 1개, 경로 훅 1쌍, 전역 구조 감시 1개, 입력 내용 감시 1개.
const Core = (() => {
  const listeners = new Map(), frames = new Map(), sizes = new Map();
  const INPUT = 'textarea.__chat_input_textarea,[contenteditable="true"].__chat_input_textarea';
  const FALLBACK = 'main textarea[placeholder*="메시지"],main textarea[placeholder*="Message"],main [contenteditable="true"].ProseMirror,main [contenteditable="true"].tiptap,main [contenteditable="true"][role="textbox"]';
  const BLOCKED = '[role="dialog"],[aria-modal="true"],[aria-hidden="true"],[hidden],[data-message-group-id],[data-message-id],#cunpm-root,#rpcm-overlay,#crack-ai-panel,#trans-setting-panel';
  const OWN = '#cic-wrap,#ccr-controls-layer,#chud-infobar,#chud-sidebar,#chud-info-menu,#chud-side-menu,#chud-side-dropdown,.chud-list-cracker,#igx-live-popup,#igx-live-settings';
  let editor = null, epoch = 0, path = location.pathname, raf = 0, started = false;
  let nextFind = 0, backoff = 1200, lastSafety = 0, blockedEditor = null, blockedText = '';
  let textareaValue = '', messageCount = null;
  const on = (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type)?.delete(fn); };
  const emit = (type, value) => { for (const fn of [...(listeners.get(type) || [])]) { try { fn(value); } catch (error) { console.error('[입력창 합본]', type, error); } } };
  const frame = (key, fn) => {
    frames.set(key, fn);
    if (raf || document.hidden) return;
    raf = requestAnimationFrame(() => {
      raf = 0; const jobs = [...frames.values()]; frames.clear();
      for (const job of jobs) { try { job(); } catch (error) { console.error('[입력창 합본]', error); } }
    });
  };
  const route = () => {
    const m = location.pathname.match(/^\/stories\/([^/]+)\/episodes\/([^/]+)/);
    return m ? {storyId:m[1],chatId:m[2],roomKey:`stories/${m[1]}/episodes/${m[2]}`,isChat:true} : {storyId:null,chatId:null,roomKey:null,isChat:false};
  };
  const rawText = el => el instanceof HTMLTextAreaElement ? el.value : el?.textContent || '';
  function eligible(el) {
    if (!(el instanceof HTMLElement) || !el.isConnected || el.closest(BLOCKED) || el.closest(OWN)) return false;
    if (el.disabled || el.readOnly) return false;
    if (!el.matches('textarea,[contenteditable="true"]')) return false;
    if (el === blockedEditor && rawText(el) === blockedText) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 40 && rect.height > 18 && getComputedStyle(el).visibility !== 'hidden';
  }
  function find() {
    for (const selector of [INPUT, FALLBACK]) {
      let best = null, top = -Infinity;
      for (const el of document.querySelectorAll(selector)) {
        if (!eligible(el)) continue;
        const y = el.getBoundingClientRect().top;
        if (y >= top) { best = el; top = y; }
      }
      if (best) return best;
    }
    return null;
  }
  const resize = new ResizeObserver(entries => {
    for (const entry of entries) for (const fn of sizes.get(entry.target) || []) fn();
    frame('layout', () => emit('layout'));
  });
  function watchSize(el, fn) {
    if (!el) return () => {};
    if (!sizes.has(el)) { sizes.set(el,new Set()); resize.observe(el); }
    sizes.get(el).add(fn);
    return () => { const set = sizes.get(el); if (!set) return; set.delete(fn); if (!set.size) {sizes.delete(el);resize.unobserve(el);} };
  }
  const content = new MutationObserver(() => frame('content', () => emit('content', {editor,epoch})));
  let stopSize = () => {};
  function bind(next) {
    if (next === editor) return;
    const previous = editor;
    emit('before-editor', {previous,next});
    content.disconnect(); stopSize();
    editor = next;
    if (editor) {
      textareaValue = rawText(editor);
      content.observe(editor,{childList:true,subtree:true,characterData:true});
      stopSize = watchSize(editor, () => {});
    }
    emit('editor', {editor,previous,epoch});
  }
  function refresh(force = false) {
    if (!route().isChat) { bind(null); return null; }
    if (editor && eligible(editor)) return editor;
    // Radix 모달은 배경 앱에 aria-hidden을 붙인다. 연결된 기존 입력창은
    // 그대로 두어 대시보드와 라디오존데가 모달을 여는 동안 탈착되지 않게 한다.
    if (editor?.isConnected && editor.closest('[aria-hidden="true"]') &&
        [...document.querySelectorAll('[role="dialog"][aria-modal="true"],[role="dialog"][data-state="open"],[role="dialog"][data-state="closed"],[role="menu"][data-radix-menu-content]')].some(dialog => dialog.getClientRects().length)) return editor;
    if (editor) bind(null);
    if (!force && Date.now() < nextFind) return null;
    const found = find();
    nextFind = found ? 0 : Date.now() + backoff;
    backoff = found ? 1200 : Math.min(9600,backoff*2);
    bind(found); return editor;
  }
  function checkRoute() {
    if (path === location.pathname) return false;
    emit('before-route');
    blockedEditor = editor; blockedText = rawText(editor);
    // 이전 방의 입력 내용이 남은 DOM에는 새 방 초안을 붙이지 않는다.
    if (!blockedText.trim()) blockedEditor = null;
    path = location.pathname; epoch++; nextFind = 0; backoff = 1200; messageCount = null;
    bind(null); emit('route',route()); frame('discover',()=>refresh(true)); return true;
  }
  const structure = new MutationObserver(all => {
    const records = all.filter(m => !(m.target instanceof Element && m.target.closest('[data-message-group-id] .wrtn-markdown')));
    if (!records.length) return;
    let discover = false, messageChanged = false, layoutChanged = false;
    for (const m of records) {
      if (m.target instanceof Element && m.target.closest(OWN)) continue;
      if (m.type === 'attributes') {if(m.attributeName==='data-theme'&&m.target===document.body)emit('theme');continue;}
      if (editor?.parentElement && (m.target === editor.parentElement || m.target === editor.parentElement.parentElement)) layoutChanged = true;
      for (const n of [...m.addedNodes,...m.removedNodes]) {
        if (!(n instanceof Element) || n.matches(OWN)) continue;
        if (n.matches('[data-message-group-id]') || n.querySelector('[data-message-group-id]')) messageChanged = true;
        if (n.closest('[data-message-group-id],.wrtn-markdown')) continue;
        if (n.matches(INPUT+','+FALLBACK) || n.querySelector(INPUT+','+FALLBACK)) discover = true;
      }
    }
    if (messageChanged) {messageCount = null; emit('messages');}
    if (discover || (editor && !editor.isConnected)) frame('discover',()=>refresh(true));
    if (layoutChanged) frame('layout',()=>emit('layout'));
    emit('mutations',records);
  });
  function start() {
    if (started) return; started = true;
    for (const name of ['pushState','replaceState']) {
      const original = history[name];
      history[name] = function(...args) {
        emit('before-history');
        const result = original.apply(this,args); checkRoute(); return result;
      };
    }
    window.addEventListener('popstate',checkRoute);
    window.addEventListener('hashchange',()=>{checkRoute();refresh(true);});
    for (const type of ['input','keydown','compositionstart','compositionend','focusin','paste','cut']) {
      document.addEventListener(type,event => {
        if (checkRoute()) return;
        if (event.target !== editor) {
          if (type !== 'focusin' && type !== 'input') return;
          if (!(event.target instanceof Element) || !event.target.matches(INPUT+','+FALLBACK)) return;
          refresh(true);
        }
        if (event.target !== editor || !editor) return;
        if (type === 'input') textareaValue = rawText(editor);
        emit(type,event);
        if (['input','compositionend','paste','cut'].includes(type)) frame('content',()=>emit('content',{editor,epoch}));
      },true);
    }
    for (const type of ['pointerdown','pointerup','click','submit']) document.addEventListener(type,event=>emit(type,event),true);
    for (const type of ['pagehide','beforeunload']) window.addEventListener(type,event=>emit('leave',event),true);
    document.addEventListener('visibilitychange',()=>{
      emit('visibility');
      if (!document.hidden) {checkRoute();refresh(true);frame('layout',()=>emit('layout'));}
    });
    window.addEventListener('resize',()=>frame('layout',()=>emit('layout')),{passive:true});
    window.visualViewport?.addEventListener('resize',()=>frame('layout',()=>emit('layout')),{passive:true});
    document.addEventListener('ccr:composer-layout',()=>frame('counter-layout',()=>emit('counter-layout')));
    structure.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-theme','aria-valuenow','data-state','aria-checked','aria-expanded','aria-selected','aria-current']});
    setInterval(()=>{
      if (document.hidden) return;
      checkRoute();refresh();
      if (editor instanceof HTMLTextAreaElement && textareaValue !== editor.value) {
        textareaValue = editor.value;emit('content',{editor,epoch});
      }
      emit('maintenance');
      if (Date.now()-lastSafety>5000) {lastSafety=Date.now();emit('safety');frame('layout',()=>emit('layout'));}
    },1200);
    refresh(true);emit('route',route());
  }
  return {on,emit,frame,route,refresh,watchSize,start,
    get editor(){return editor?.isConnected?editor:null;},get epoch(){return epoch;},
    messageCount(){if(messageCount===null)messageCount=document.querySelectorAll('[data-message-group-id]').length;return messageCount;},
    isOwn(el){return !!el?.closest?.(OWN);}};
})();


// ===== draft module =====
(function () {
  'use strict';

  const SCRIPT_NAME = '크랙 채팅 허브';
  const VERSION = '1.0.2';
  const PREFIX = 'cwa-chat-draft:v1:';

  // 저장 타이밍: 너무 잦은 동기 저장을 피하면서도 체감상 빠르게.
  const SAVE_DELAY_MS = 350;

  // 전송 성공 추정용. 새로고침/탭 종료가 끼면 삭제하지 않는 쪽으로 보수적으로 처리.
  const SEND_TRACK_MS = 6000;

  // 오래된 임시저장 자동 정리.
  const OLD_DRAFT_MS = 30 * 24 * 60 * 60 * 1000;

  const DEBUG = false;

  const state = {
    roomKey: null,
    editor: null,
    boundEditor: null,
    saveTimer: 0,
    pendingSend: null,
    pendingExpireTimer: 0,
    restoring: false,
    composing: false,
    restoredRoomKey: null,
    lastSavedRaw: '',
    savedRoomKey: null,
    savedPending: false,
    protectedDraft: false,
    lastKnownText: '',
    latestInputText: '',

    startedAt: Date.now()
  };

  function debugLog(...args) {
    if (DEBUG) console.debug('[CWA Draft]', ...args);
  }

  function now() {
    return Date.now();
  }

  function hasGMStorage() {
    return typeof GM_getValue === 'function' &&
      typeof GM_setValue === 'function' &&
      typeof GM_deleteValue === 'function';
  }

  function storageGet(key) {
    try {
      if (hasGMStorage()) return GM_getValue(key, null);
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] GM_getValue 실패, localStorage fallback 사용`, err);
    }

    try {
      return localStorage.getItem(key);
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] localStorage 읽기 실패`, err);
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      if (hasGMStorage()) {
        GM_setValue(key, value);
        return true;
      }
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] GM_setValue 실패, localStorage fallback 사용`, err);
    }

    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] localStorage 저장 실패`, err);
      return false;
    }
  }

  function storageDelete(key) {
    try {
      if (hasGMStorage()) GM_deleteValue(key);
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] GM_deleteValue 실패`, err);
    }

    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] localStorage 삭제 실패`, err);
    }
  }

  function storageKeys() {
    try {
      if (typeof GM_listValues === 'function') {
        return GM_listValues().filter((key) => String(key).startsWith(PREFIX));
      }
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] GM_listValues 실패, localStorage fallback 사용`, err);
    }

    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith(PREFIX)) keys.push(key);
      }
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] localStorage 목록 조회 실패`, err);
    }
    return keys;
  }

  function getRoomKeyFromLocation() { return Core.route().roomKey; }

  function storageKeyFor(roomKey) {
    return PREFIX + encodeURIComponent(roomKey || 'unknown');
  }

  function parseDraft(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
      const draft = JSON.parse(raw);
      if (!draft || typeof draft.text !== 'string') return null;
      return draft;
    } catch {
      return null;
    }
  }

  function getDraft(roomKey) {
    if (!roomKey) return null;
    const key = storageKeyFor(roomKey);
    const draft = parseDraft(storageGet(key));
    if (!draft) return null;

    if (draft.updatedAt && now() - draft.updatedAt > OLD_DRAFT_MS) {
      storageDelete(key);
      return null;
    }
    return draft;
  }

  function deleteDraft(roomKey, reason = 'manual') {
    if (!roomKey) return;
    storageDelete(storageKeyFor(roomKey));
    if (roomKey === state.roomKey) {
      state.lastSavedRaw = '';
      state.savedRoomKey = null;
      state.protectedDraft = false;
      state.lastKnownText = '';
      state.latestInputText = '';
    }
    debugLog('draft deleted:', reason, roomKey);
  }

  function cleanupOldDrafts() {
    const keys = storageKeys();
    const cutoff = now() - OLD_DRAFT_MS;
    keys.forEach((key) => {
      const draft = parseDraft(storageGet(key));
      if (!draft || !draft.updatedAt || draft.updatedAt < cutoff) {
        storageDelete(key);
      }
    });
  }

  function normalizeText(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200B\uFEFF]/g, '');
  }

  function isBlankText(text) {
    return normalizeText(text).replace(/\s/g, '') === '';
  }

  function isTextField(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'textarea' || tag === 'input';
  }

  function blockToText(block) {
    let out = '';
    block.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.nodeValue || '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'BR') {
          // ProseMirror가 커서 표시용으로 넣는 trailing <br>는 줄바꿈으로 세지 않는다.
          if (!node.classList.contains('ProseMirror-trailingBreak') && block.childNodes.length !== 1) out += '\n';
        } else {
          out += node.textContent || '';
        }
      }
    });
    return out;
  }

  function serializeContentEditable(el) {
    // execCommand가 만든 최상위 텍스트 + div 혼합 구조도 순서대로 읽는다.
    const lines = [];
    let inline = '';
    let hasInline = false;
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE && /^(P|DIV)$/.test(node.tagName)) {
        if (hasInline) { lines.push(inline); inline = ''; hasInline = false; }
        lines.push(blockToText(node));
      } else {
        hasInline = true;
        if (node.nodeType === Node.TEXT_NODE) inline += node.nodeValue || '';
        else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'BR') {
            if (!node.classList.contains('ProseMirror-trailingBreak') && el.childNodes.length !== 1) inline += '\n';
          } else inline += node.textContent || '';
        }
      }
    });
    if (hasInline) lines.push(inline);
    return lines.join('\n');
  }

  function getEditorText(el = state.editor) {
    if (!el) return '';

    if (isTextField(el)) {
      return normalizeText(el.value || '');
    }

    let text = serializeContentEditable(el);
    text = normalizeText(text);

    // 표시용 trailingBreak는 blockToText에서 제외한다. 실제 빈 문단은 보존한다.

    return text;
  }

  function hashText(text) {
    let h = 2166136261;
    const s = normalizeText(text);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function isVisibleEditable(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest('[aria-hidden="true"], [hidden]')) return false;
    if (el.matches('textarea,input')) {
      if (el.disabled || el.readOnly) return false;
    } else if (el.getAttribute('contenteditable') !== 'true') {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 40 && rect.height > 18 && rect.bottom > 0 && rect.right > 0;
  }

  // 채팅 입력창이 아닌 편집 영역은 임시저장 대상으로 잡지 않는다.
  // 특히 유저노트 모달의 textarea가 'textarea' fallback에 걸려 채팅 임시저장으로 오염되는 문제를 막는다.
  function isBlockedEditorArea(el) {
    if (!(el instanceof HTMLElement)) return true;

    const dialog = el.closest('[role="dialog"]');
    if (dialog) {
      const dialogText = (dialog.textContent || '').slice(0, 240);
      if (/유저노트|프리셋|새 프리셋|확장 프롬프트/.test(dialogText)) return true;
    }

    const placeholder = [
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.getAttribute('data-placeholder')
    ].filter(Boolean).join(' ');

    if (/잊으면 안되는|중요한 내용|추가하고 싶은 설정|유저노트|프리셋/.test(placeholder)) return true;

    if (el.closest('#cunpm-root, [data-cunpm-root], [data-cunpm-shell], [data-cunpm-panel]')) return true;

    return false;
  }

  function isChatInputEditor(el) {
    if (!isVisibleEditable(el)) return false;
    if (isBlockedEditorArea(el)) return false;

    // 신형 크랙 채팅 입력창: tiptap/ProseMirror contenteditable
    if (el.matches('div[contenteditable="true"].ProseMirror.__chat_input_textarea')) return true;
    if (el.matches('div[contenteditable="true"].__chat_input_textarea')) return true;

    // 구형/일부 모바일 fallback
    if (el.matches('textarea.__chat_input_textarea')) return true;

    // 클래스가 잠깐 빠지는 환경의 마지막 fallback.
    // 모달/유저노트는 위에서 제외했고, 일반 textarea는 절대 채팅 입력창으로 취급하지 않는다.
    if (el.matches('div[contenteditable="true"].ProseMirror, [contenteditable="true"][role="textbox"]')) {
      return !el.closest('[role="dialog"]');
    }

    return false;
  }

  function saveDraftNow(reason = 'auto', forcedText = null, pendingSend = false) {
    if (!state.roomKey || !state.editor || !isChatInputEditor(state.editor)) return false;

    const text = forcedText == null ? getEditorText(state.editor) : normalizeText(forcedText);
    if (isBlankText(text)) {
      if (!pendingSend) deleteDraft(state.roomKey, 'blank:' + reason);
      return false;
    }

    if (state.savedRoomKey === state.roomKey && state.lastKnownText === text &&
        state.savedPending === Boolean(pendingSend)) return true;

    const draft = {
      v: VERSION,
      roomKey: state.roomKey,
      text,
      textHash: hashText(text),
      updatedAt: now(),
      href: location.href,
      pendingSend: Boolean(pendingSend),
      reason
    };

    const raw = JSON.stringify(draft);
    if (raw === state.lastSavedRaw) return true;

    const ok = storageSet(storageKeyFor(state.roomKey), raw);
    if (ok) {
      state.lastSavedRaw = raw;
      state.savedRoomKey = state.roomKey;
      state.savedPending = Boolean(pendingSend);
      state.protectedDraft = Boolean(pendingSend);
      state.lastKnownText = text;
      debugLog('draft saved:', reason, state.roomKey, text.length);
    }
    return ok;
  }

  function scheduleSave(reason = 'input') {
    if (state.composing || state.restoring) return;
    clearTimeout(state.saveTimer);
    const room = state.roomKey, editor = state.editor;
    state.saveTimer = setTimeout(() => {
      if (state.roomKey !== room || state.editor !== editor || state.composing || state.restoring ||
          getRoomKeyFromLocation() !== room) return;
      saveDraftNow(reason);
    }, SAVE_DELAY_MS);
  }

  function clearPendingSend(reason = 'clear') {
    debugLog('pending send cleared:', reason);
    state.pendingSend = null;
    clearTimeout(state.pendingExpireTimer);
  }

  function startPossibleSend(reason = 'possible-send') {
    if (!state.roomKey || !state.editor || !isChatInputEditor(state.editor)) return;
    const text = getEditorText(state.editor);
    if (isBlankText(text)) return;

    const pending = {
      at: now(),
      roomKey: state.roomKey,
      textHash: hashText(text),
      text
    };

    clearTimeout(state.saveTimer);
    state.pendingSend = pending;
    saveDraftNow('before-send:' + reason, text, true);

    clearTimeout(state.pendingExpireTimer);
    state.pendingExpireTimer = setTimeout(() => {
      if (state.pendingSend !== pending || state.roomKey !== pending.roomKey) return;
      const currentText = getEditorText(state.editor);
      // 전송 시도가 아니었던 것으로 보이면 일반 입력 상태로 복귀.
      clearPendingSend('expired');
      if (!isBlankText(currentText)) saveDraftNow('send-not-cleared');
    }, SEND_TRACK_MS);
  }

  function preserveUnconfirmedDraft() {
    // 빈 입력이나 임의의 HTTP 성공은 전송 성공 증거가 아니다.
    // 미확인 전송 스냅샷은 자동 삽입 없이 보관한다.
    state.protectedDraft = true;
  }

  function onInput(event) {
    if (!state.editor || !state.editor.isConnected || state.restoring || state.composing ||
        getRoomKeyFromLocation() !== state.roomKey) return;

    const text = getEditorText(state.editor);
    if (isBlankText(text)) {
      clearTimeout(state.saveTimer);
      if (state.pendingSend) {
        preserveUnconfirmedDraft();
      } else if (event && /^delete/.test(event.inputType || '')) {
        deleteDraft(state.roomKey, 'input-cleared');
      } else if (!isBlankText(state.latestInputText || state.lastKnownText)) {
        // 전송 버튼을 식별하지 못한 빈 입력 이벤트도 저장본을 잃지 않게 한다.
        saveDraftNow('unconfirmed-empty', state.latestInputText || state.lastKnownText, true);
      }
      return;
    }

    if (state.pendingSend && hashText(text) !== state.pendingSend.textHash) {
      clearPendingSend('edited-after-pending');
    }

    state.latestInputText = text;
    scheduleSave('input');
  }

  function onKeydown(event) {
    if (!state.editor) return;
    if (event.isComposing || state.composing) return;

    const isEnterSend = event.key === 'Enter' &&
      !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;

    if (isEnterSend) startPossibleSend('enter');
  }

  function onCompositionStart() {
    clearTimeout(state.saveTimer);
    state.composing = true;
  }

  function onCompositionEnd() {
    state.composing = false;
    scheduleSave('composition-end');
  }

  function detachEditor() {
    state.boundEditor = null; state.editor = null; state.composing = false;
  }

  function attachEditor(el) {
    if (!el || state.boundEditor === el) return;
    detachEditor();state.editor = state.boundEditor = el;
    const generation = Core.epoch;
    setTimeout(() => {if (generation === Core.epoch && state.editor === el) tryRestoreDraft();},80);
  }

  function placeCaretAtEnd(el) {
    try {
      if (isTextField(el)) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
        return;
      }

      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // 무시해도 복구 자체에는 영향 없음.
    }
  }

  function fireInputEvent(el, text) {
    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertFromPaste',
        data: text
      }));
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
  }

  function setTextByExecCommand(el, text) {
    try {
      el.focus({ preventScroll: true });
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      return document.execCommand('insertText', false, text);
    } catch {
      return false;
    }
  }

  function setContentEditableFallback(el, text) {
    el.textContent = '';
    const lines = normalizeText(text).split('\n');
    const fragment = document.createDocumentFragment();

    lines.forEach((line) => {
      const p = document.createElement('p');
      if (line) p.textContent = line;
      else p.appendChild(document.createElement('br'));
      fragment.appendChild(p);
    });

    el.appendChild(fragment);
  }

  function setEditorText(el, text) {
    if (!el) return false;
    const normalized = normalizeText(text);

    try {
      state.restoring = true;

      if (isTextField(el)) {
        el.focus({ preventScroll: true });
        const proto = Object.getPrototypeOf(el);
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(el, normalized);
        else el.value = normalized;
        fireInputEvent(el, normalized);
        placeCaretAtEnd(el);
        return true;
      }

      const usedCommand = setTextByExecCommand(el, normalized);
      const afterCommand = getEditorText(el);

      if (!usedCommand || afterCommand !== normalized) {
        setContentEditableFallback(el, normalized);
      }

      fireInputEvent(el, normalized);
      placeCaretAtEnd(el);
      return true;
    } catch (err) {
      console.warn(`[${SCRIPT_NAME}] 임시저장 복구 실패`, err);
      return false;
    } finally {
      setTimeout(() => {
        state.restoring = false;
      }, 120);
    }
  }

  function tryRestoreDraft() {
    if (!state.roomKey || !state.editor || !isChatInputEditor(state.editor)) return;
    if (state.restoredRoomKey === state.roomKey) return;

    const draft = getDraft(state.roomKey);
    state.restoredRoomKey = state.roomKey;

    if (!draft || isBlankText(draft.text)) return;

    // 미확인 전송은 자동 복구하지 않지만 삭제하지도 않는다. 자동 삽입 없이 보관한다.
    if (draft.pendingSend) {
      state.protectedDraft = true;
      state.lastKnownText = draft.text;
      return;
    }

    if (!isBlankText(getEditorText(state.editor))) return;

    const ok = setEditorText(state.editor, draft.text);
    if (ok) {
      state.lastKnownText = draft.text;
      state.lastSavedRaw = JSON.stringify(draft);
      state.savedRoomKey = state.roomKey;
      state.savedPending = false;
      console.info(`[${SCRIPT_NAME}] 이 방의 임시저장 메시지를 복구했습니다.`);
    }
  }

  function flushBeforeLeave(reason = 'leave') {
    if (!state.roomKey || !state.editor || !isChatInputEditor(state.editor)) return;
    clearTimeout(state.saveTimer);

    const text = getEditorText(state.editor);
    if (!isBlankText(text)) {
      saveDraftNow(reason, text, Boolean(state.pendingSend));
    } else if (!state.pendingSend && !state.protectedDraft) {
      deleteDraft(state.roomKey, 'blank-before-' + reason);
    }
  }

  function resetForRoute(newRoomKey) {
    if (state.roomKey === newRoomKey) return;

    flushBeforeLeave('route-change');
    detachEditor();
    clearTimeout(state.saveTimer);
    clearPendingSend('route-change');

    state.roomKey = newRoomKey;
    state.restoredRoomKey = null;
    state.lastSavedRaw = '';
    state.lastKnownText = '';
    state.latestInputText = '';
    state.savedRoomKey = null;
    state.protectedDraft = false;
  }

  function initForCurrentRoute() {
    resetForRoute(Core.route().roomKey);
    if (!state.roomKey) return;
    if (Core.editor !== state.editor) {
      if (Core.editor) attachEditor(Core.editor); else detachEditor();
    } else if (state.editor) tryRestoreDraft();
  }

  function isProbablySendButton(button) {
    if (!(button instanceof HTMLElement) || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    if (!state.editor || !state.editor.isConnected || button.closest('[role="dialog"]')) return false;
    const label = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent]
      .filter(Boolean).join(' ').trim();
    if (!/^(메시지\s*)?(전송|보내기|보내|send|submit)(\s|$)/i.test(label)) return false;
    const e = state.editor.getBoundingClientRect(), b = button.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && b.bottom >= e.top - 28 && b.top <= e.bottom + 28 &&
      b.left >= e.left - 20 && b.left <= e.right + 180;
  }

  function onDocumentPointerDown(event) {
    if (!state.roomKey || !state.editor) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('button,[role="button"]');
    if (!button) return;
    if (!isProbablySendButton(button)) return;

    startPossibleSend('button');
  }

  function onDocumentSubmit(event) {
    if (state.editor && event.target instanceof Element && event.target.contains(state.editor)) {
      startPossibleSend('form-submit');
    }
  }

  function boot() {
    cleanupOldDrafts();
    Core.on('before-history',()=>flushBeforeLeave('history'));
    Core.on('before-route',()=>flushBeforeLeave('route'));
    Core.on('route',initForCurrentRoute);
    Core.on('before-editor',({previous,next})=>{if(previous && previous!==next && state.roomKey===Core.route().roomKey)flushBeforeLeave('editor-change');});
    Core.on('editor',initForCurrentRoute);
    Core.on('input',onInput);Core.on('keydown',onKeydown);
    Core.on('compositionstart',onCompositionStart);Core.on('compositionend',onCompositionEnd);
    Core.on('pointerdown',onDocumentPointerDown);Core.on('submit',onDocumentSubmit);
    Core.on('leave',()=>flushBeforeLeave('leave'));
    Core.on('visibility',()=>{if(document.hidden)flushBeforeLeave('hidden');});
  }

  boot();
})();

// ===== counter module =====
(() => {
  'use strict';

  if (window.__CRACK_INPUT_COUNTER_102_LOADED__) return;
  window.__CRACK_INPUT_COUNTER_102_LOADED__ = true;

  /*****************************************************************
   * 사용자 조정값
   *****************************************************************/
  const LIMIT = 2000;
  const YELLOW_START = 1400;
  const ORANGE_START = 1750;
  const HOT_START = 1900;

  const ID = {
    style: 'cic-style',
    wrap: 'cic-wrap',
    count: 'cic-count',
  };

  const state = {
    editor: null,
    previousCount: null,
    updateFrame: 0,
  };

  /*****************************************************************
   * 스타일
   *****************************************************************/
  function injectStyle() {
    if (document.getElementById(ID.style)) return;

    const style = document.createElement('style');
    style.id = ID.style;
    style.textContent = `
      /*
       * v1.0.2: 카운터를 flex 흐름에서 완전히 분리한다.
       * 다른 확프가 버튼 순서를 재정렬해도 카운터가 자리를 놓고 싸우지 않는다.
       */
      #${ID.wrap} {
        position: absolute !important;
        z-index: 2 !important;
        top: var(--cic-top, 0px) !important;
        left: var(--cic-left, 100%) !important;
        right: auto !important;
        transform: translate(-50%, -100%) !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        min-width: 30px !important;
        height: 28px !important;
        margin: 0 !important;
        padding: 0 4px !important;
        box-sizing: border-box !important;
        pointer-events: none !important;
        user-select: none !important;
        -webkit-user-select: none !important;
      }

      #${ID.count} {
        display: inline-block !important;
        color: var(--cic-color, var(--text_tertiary, var(--icon_tertiary, rgba(128, 128, 128, .78)))) !important;
        font-family: inherit !important;
        font-size: 11px !important;
        font-weight: 650 !important;
        line-height: 1 !important;
        letter-spacing: -0.02em !important;
        font-variant-numeric: tabular-nums !important;
        white-space: nowrap !important;
        opacity: .74 !important;
        text-shadow: none !important;
        transition: color 150ms ease, opacity 150ms ease, transform 150ms ease !important;
      }

      #${ID.count}[data-empty="true"] {
        opacity: .42 !important;
      }

      #${ID.count}[data-warning="true"] {
        opacity: .96 !important;
      }

      #${ID.count}[data-limit="true"] {
        opacity: 1 !important;
        font-weight: 750 !important;
      }

      #${ID.count}.cic-over-pulse {
        animation: cic-over-shake 520ms cubic-bezier(.36,.07,.19,.97) both !important;
      }

      @keyframes cic-over-shake {
        0%, 100% { transform: translateX(0) scale(1); }
        12% { transform: translateX(-3px) rotate(-4deg) scale(1.08); }
        24% { transform: translateX(3px) rotate(4deg) scale(1.08); }
        36% { transform: translateX(-3px) rotate(-3deg) scale(1.07); }
        48% { transform: translateX(3px) rotate(3deg) scale(1.07); }
        62% { transform: translateX(-2px) rotate(-2deg) scale(1.05); }
        76% { transform: translateX(2px) rotate(2deg) scale(1.03); }
      }

      @media (prefers-reduced-motion: reduce) {
        #${ID.count} { transition: color 150ms ease, opacity 150ms ease !important; }
        #${ID.count}.cic-over-pulse { animation: none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  /*****************************************************************
   * 입력창 탐색/텍스트 읽기
   *****************************************************************/
  function isVisibleElement(el) {
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const css = getComputedStyle(el);
    return css.display !== 'none' && css.visibility !== 'hidden';
  }

  function findEditor() { return Core.editor; }

  function getEditorText(editor) {
    if (!editor) return '';

    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      return String(editor.value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\u200b/g, '');
    }

    let text = String(editor.innerText ?? editor.textContent ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\u200b/g, '');

    // ProseMirror의 완전 빈 문단이 브라우저에 따라 "\n"으로 잡히는 경우만 정리한다.
    const hasVisibleTextNode = String(editor.textContent || '').replace(/\u200b/g, '').length > 0;
    const markedEmpty = !!editor.querySelector?.('.is-editor-empty');
    if (!hasVisibleTextNode && (markedEmpty || /^\n*$/.test(text))) text = '';

    return text;
  }

  function countCharacters(text) {
    // 한글/일반 문자는 1자, 기본 이모지도 화면에 보이는 단위에 가깝게 계산한다.
    return Array.from(String(text || '')).length;
  }

  /*****************************************************************
   * 입력창 하단 액션 줄 탐색
   *****************************************************************/
  function isActionRowCandidate(row) {
    if (!(row instanceof HTMLElement)) return false;
    if (!row.classList.contains('flex')) return false;
    if (!row.classList.contains('items-center')) return false;
    if (!row.classList.contains('justify-between')) return false;

    const visibleButtons = Array.from(row.querySelectorAll('button')).filter((button) => {
      if (!(button instanceof HTMLElement)) return false;
      if (button.closest(`#${ID.wrap}`)) return false;
      return isVisibleElement(button);
    });

    if (visibleButtons.length === 0) return false;

    const hasLeftButtonGroup = Array.from(row.children || []).some((child) => {
      if (!(child instanceof HTMLElement)) return false;
      return child.classList.contains('space-x-2') || !!child.querySelector?.('.space-x-2');
    });

    return hasLeftButtonGroup || row.children.length >= 2;
  }

  function findActionRow(editor) {
    if (!editor) return null;

    let node = editor;
    for (let depth = 0; depth < 10 && node; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches('main,body,html')) break;
      if (isActionRowCandidate(node)) return node;

      const rows = Array.from(node.querySelectorAll?.('div.flex.items-center.justify-between') || [])
        .filter(isActionRowCandidate);

      if (rows.length > 0) return rows[rows.length - 1];
    }

    return null;
  }

  function ensurePositioningHost(host) {
    if (!(host instanceof HTMLElement)) return;

    // position:static인 flex 그룹에만 기준점을 부여한다.
    // relative는 일반 배치 크기/순서를 바꾸지 않으므로 버튼 확프와 충돌하지 않는다.
    if (getComputedStyle(host).position === 'static') {
      host.style.setProperty('position', 'relative', 'important');
      host.dataset.cicPositionHost = 'true';
    }
  }

  function ensureCounterPlacement(editor) {
    const actionRow = findActionRow(editor);
    if (!actionRow) return null;

    let wrap = document.getElementById(ID.wrap);
    let countEl = document.getElementById(ID.count);

    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = ID.wrap;
      wrap.setAttribute('aria-hidden', 'true');
    }

    if (!countEl) {
      countEl = document.createElement('span');
      countEl.id = ID.count;
      countEl.textContent = '0';
    }

    if (!wrap.contains(countEl)) wrap.replaceChildren(countEl);

    /*
     * v1.0.6 핵심
     * 메모장/✨/기타 확프의 DOM 그룹 존재 여부를 위치 기준으로 쓰지 않는다.
     *
     * 1) 입력창 하단 actionRow 자체를 좌표 기준으로 삼는다.
     * 2) 왼쪽 툴바(space-x-2 계열)는 제외한다.
     * 3) 남은 '전송 쪽 버튼들' 중 가장 오른쪽 버튼을 전송 버튼으로 본다.
     * 4) 그 전송 버튼의 중앙 바로 위 4px에 카운터를 절대좌표로 둔다.
     *
     * 따라서 다른 확프 버튼이 전송 버튼 왼쪽에 추가되어도
     * 카운터는 항상 전송 버튼 위쪽을 따라간다.
     */
    ensurePositioningHost(actionRow);

    if (wrap.parentNode !== actionRow) {
      actionRow.prepend(wrap);
    }

    const directChildren = Array.from(actionRow.children || []).filter(
      (child) => child instanceof HTMLElement && child.id !== ID.wrap
    );

    const leftToolbar = directChildren.find((child) => (
      child.classList.contains('space-x-2')
      || !!child.querySelector?.('.space-x-2')
    )) || null;

    const rects = new Map();
    const rectOf = button => { if (!rects.has(button)) rects.set(button,button.getBoundingClientRect()); return rects.get(button); };
    let rightButtons = Array.from(actionRow.querySelectorAll('button')).filter((button) => {
      if (!(button instanceof HTMLElement)) return false;
      if (!isVisibleElement(button)) return false;
      if (wrap.contains(button)) return false;
      if (leftToolbar && leftToolbar.contains(button)) return false;
      return true;
    });

    /*
     * 혹시 크랙 DOM이 바뀌어 왼쪽 툴바를 못 잡았더라도,
     * 가장 오른쪽 버튼(보통 전송)을 기준으로 같은 높이에 있는 버튼만 남긴다.
     */
    if (rightButtons.length > 0) {
      const rightmostButton = rightButtons.reduce((best, button) => {
        if (!best) return button;
        return rectOf(button).right > rectOf(best).right
          ? button
          : best;
      }, null);

      const sendRect = rectOf(rightmostButton);
      const sendCenterY = sendRect.top + sendRect.height / 2;

      const sameRowButtons = rightButtons.filter((button) => {
        const rect = rectOf(button);
        const centerY = rect.top + rect.height / 2;
        return Math.abs(centerY - sendCenterY) <= 12;
      });

      if (sameRowButtons.length > 0) rightButtons = sameRowButtons;
    }

    if (rightButtons.length === 0) return null;

    const rowRect = actionRow.getBoundingClientRect();

    const sendButton = rightButtons.reduce((best, button) => {
      if (!best) return button;
      return rectOf(button).right > rectOf(best).right
        ? button
        : best;
    }, null);

    if (!sendButton) return null;

    const sendRect = rectOf(sendButton);
    const centerX = sendRect.left + sendRect.width / 2;
    const left = centerX - rowRect.left;
    const top = sendRect.top - rowRect.top - 4;

    if (wrap.style.getPropertyValue('--cic-left') !== `${left}px`) wrap.style.setProperty('--cic-left', `${left}px`);
    if (wrap.style.getPropertyValue('--cic-top') !== `${top}px`) wrap.style.setProperty('--cic-top', `${top}px`);

    return countEl;
  }

  /*****************************************************************
   * 색상/초과 알림
   *****************************************************************/
  function lerp(a, b, t) {
    return a + (b - a) * Math.max(0, Math.min(1, t));
  }

  function warningColor(count) {
    if (count < YELLOW_START) return '';
    if (count >= LIMIT) return '#ef4444';

    if (count < ORANGE_START) {
      const t = (count - YELLOW_START) / (ORANGE_START - YELLOW_START);
      const hue = lerp(47, 30, t);
      const light = lerp(48, 52, t);
      return `hsl(${hue.toFixed(1)} 92% ${light.toFixed(1)}%)`;
    }

    const t = (count - ORANGE_START) / (LIMIT - ORANGE_START);
    const hue = lerp(30, 0, t);
    const light = count >= HOT_START ? lerp(52, 48, (count - HOT_START) / (LIMIT - HOT_START)) : 52;
    return `hsl(${hue.toFixed(1)} 91% ${Math.max(48, light).toFixed(1)}%)`;
  }

  function alertOverLimit(countEl) {
    countEl.classList.remove('cic-over-pulse');
    void countEl.offsetWidth;
    countEl.classList.add('cic-over-pulse');

    window.setTimeout(() => {
      countEl.classList.remove('cic-over-pulse');
    }, 560);

    try {
      if (typeof navigator.vibrate === 'function') {
        navigator.vibrate([35, 30, 55]);
      }
    } catch (_) {
      // 데스크톱/미지원 브라우저에서는 시각적 흔들림만 사용한다.
    }
  }

  function renderCount() {
    state.updateFrame = 0;

    const editor = state.editor && document.contains(state.editor) ? state.editor : findEditor();
    if (!editor) return;

    if (editor !== state.editor) bindEditor(editor);

    const countEl = ensureCounterPlacement(editor);
    if (!countEl) return;

    const count = countCharacters(getEditorText(editor));
    const label = count.toLocaleString('ko-KR');
    const title = `현재 ${label}자 · 최대 ${LIMIT.toLocaleString('ko-KR')}자`;
    if (countEl.textContent !== label) countEl.textContent = label;
    if (countEl.title !== title) countEl.title = title;

    const color = warningColor(count);
    if (color) {
      if (countEl.style.getPropertyValue('--cic-color') !== color) countEl.style.setProperty('--cic-color', color);
    } else if (countEl.style.getPropertyValue('--cic-color')) countEl.style.removeProperty('--cic-color');

    if (countEl.dataset.empty !== String(count === 0)) countEl.dataset.empty = String(count === 0);
    if (countEl.dataset.warning !== String(count >= YELLOW_START)) countEl.dataset.warning = String(count >= YELLOW_START);
    if (countEl.dataset.limit !== String(count >= LIMIT)) countEl.dataset.limit = String(count >= LIMIT);

    // 처음 연결했을 때 이미 초과된 임시저장 글이라면 갑자기 울리지 않는다.
    if (state.previousCount !== null && state.previousCount <= LIMIT && count > LIMIT) {
      alertOverLimit(countEl);
    }

    state.previousCount = count;
  }

  function scheduleRender() { Core.frame('counter',renderCount); }

  /*****************************************************************
   * 이벤트 연결/SPA 재탐색
   *****************************************************************/
  function bindEditor(editor) {
    if (state.editor === editor) return;
    state.editor = editor; state.previousCount = null;
    if (!editor) document.getElementById(ID.wrap)?.remove();
    else scheduleRender();
  }

  injectStyle();
  Core.on('editor',({editor})=>bindEditor(editor));
  Core.on('content',scheduleRender);
  Core.on('layout',scheduleRender);
  Core.on('counter-layout',scheduleRender);
  Core.on('maintenance',()=>{if(Core.editor&&!document.getElementById(ID.wrap))scheduleRender();});
})();

// ===== expander module =====
(() => {
  'use strict';

  if (window.__CRACK_COMPOSER_RESIZER_V1__) return;
  window.__CRACK_COMPOSER_RESIZER_V1__ = true;

  const APP = Object.freeze({
    version: '1.5.0',
    minViewportWidth: 768,
    maxViewportRatio: 0.82,
    overflowSlack: 3,
    syncDelay: 90,
    watchdogDelay: 1200,
  });

  const ID = Object.freeze({
    style: 'ccr-style',
    layer: 'ccr-controls-layer',
    toggle: 'ccr-expand-toggle',
  });

  const OWN_SELECTOR = `#${ID.layer}, #${ID.toggle}`;
  const STYLE_PROPS = ['height', 'max-height', 'overflow-y'];
  const RADIOSONDE_STYLE_PROPS = ['position', 'top', 'left', 'right', 'width', 'max-width', 'z-index'];
  const TOGGLE_ICONS = Object.freeze({
    collapsed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 16 8M10 8h6v6"/></svg>',
    expanded: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 8-8 8M14 16H8v-6"/></svg>',
  });

  const state = {
    input: null,
    target: null,
    host: null,
    toggle: null,
    expanded: false,
    originalStyles: null,
    collapsedHeight: 0,
    originalScrollTop: 0,
    hadContent: false,
    radiosondeHost: null,
    radiosondePopup: null,
    radiosondeStyles: null,
    radiosondeRestoreTimer: 0,
    radiosondeObserver: null,
    radiosondeRepairRaf: 0,
    radiosondeSyncRaf: 0,
    resizeObserver: null,
    contentObserver: null,
    documentObserver: null,
    syncTimer: 0,
    syncRaf: 0,
    animationRaf: 0,
    restoreTimer: 0,
    routeKey: location.href,
  };

  function isChatRoomPath() { return Core.route().isChat; }

  function isPcLike() {
    if (window.innerWidth < APP.minViewportWidth) return false;
    try {
      return matchMedia('(pointer: fine)').matches || matchMedia('(hover: hover)').matches;
    } catch (_) {
      return true;
    }
  }

  function findChatInput() { return Core.editor; }

  function findComposerShell(input) {
    if (!(input instanceof HTMLElement)) return null;
    return input.closest('[data-cmu-theme-input-box], [data-sgb-input-box]')
      || input.closest('div.flex.w-full.flex-col.rounded-lg.border')
      || input.closest('div[class*="rounded-lg"][class*="border"]')
      || input.closest('div[class*="rounded"][class*="border"]')
      || input.closest('form')
      || input.parentElement;
  }

  function elementOverflows(element) {
    if (!(element instanceof HTMLElement)) return false;
    return Number(element.scrollHeight || 0) > Number(element.clientHeight || 0) + APP.overflowSlack;
  }

  function hasExpandableContent(input) {
    if (!(input instanceof HTMLElement)) return false;
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      return String(input.value || '').replace(/\u200b/g, '').trim().length > 0;
    }
    const text = String(input.innerText || input.textContent || '')
      .replace(/\u200b/g, '')
      .replace(/\u00a0/g, ' ')
      .trim();
    if (text.length > 0) return true;
    return input.querySelectorAll(':scope > p, :scope > div').length > 1;
  }

  function findResizeTarget(input) {
    if (!(input instanceof HTMLElement)) return null;
    const shell = findComposerShell(input);
    let current = input;
    for (let depth = 0; current && current !== shell && depth < 7; depth += 1, current = current.parentElement) {
      if (elementOverflows(current)) return current;
    }
    return input;
  }

  function findUiHost(input) {
    if (!(input instanceof HTMLElement)) return null;
    const inputRect = input.getBoundingClientRect();
    const viewportWidth = Math.max(1, Number(window.innerWidth) || 1);
    const maxReasonableWidth = Math.min(
      viewportWidth * 0.9,
      Math.max(inputRect.width * 1.5, inputRect.width + 220),
    );
    let fallback = null;
    let current = input.parentElement;

    for (let depth = 0; current && depth < 9; depth += 1, current = current.parentElement) {
      if (current === document.body || current === document.documentElement || current.matches?.('main')) break;
      const rect = current.getBoundingClientRect();
      if (rect.width < Math.max(160, inputRect.width - 4) || rect.width > maxReasonableWidth) continue;
      if (rect.height < 28) continue;
      if (!fallback) fallback = current;

      const style = getComputedStyle(current);
      const classText = String(current.className || '');
      const marked = current.hasAttribute('data-cmu-theme-input-box')
        || current.hasAttribute('data-sgb-input-box')
        || /rounded|border|composer|input/i.test(classText)
        || parseFloat(style.borderTopWidth || '0') > 0
        || parseFloat(style.borderRadius || '0') > 0;
      if (marked) return current;
    }

    return fallback || input.parentElement;
  }

  function snapshotStyles(target) {
    const snapshot = {};
    for (const property of STYLE_PROPS) {
      snapshot[property] = {
        value: target.style.getPropertyValue(property),
        priority: target.style.getPropertyPriority(property),
      };
    }
    return snapshot;
  }

  function restoreStyles(target, snapshot) {
    if (!(target instanceof HTMLElement) || !snapshot) return;
    for (const property of STYLE_PROPS) {
      const saved = snapshot[property];
      if (saved?.value) target.style.setProperty(property, saved.value, saved.priority || '');
      else target.style.removeProperty(property);
    }
    target.removeAttribute('data-ccr-expanded');
    target.removeAttribute('data-ccr-animating');
  }

  function setImportantStyle(target, property, value) {
    if (!(target instanceof HTMLElement)) return;
    if (target.style.getPropertyValue(property) === value && target.style.getPropertyPriority(property) === 'important') return;
    target.style.setProperty(property, value, 'important');
  }

  function currentHeight(target = state.target) {
    if (!(target instanceof HTMLElement)) return 1;
    return Math.max(1, Math.round(target.getBoundingClientRect().height || target.clientHeight || 1));
  }

  function maximumHeight() {
    const viewportHeight = Math.max(1, Number(window.visualViewport?.height) || Number(window.innerHeight) || 800);
    return Math.max(160, Math.floor(viewportHeight * APP.maxViewportRatio));
  }

  function cancelAnimation() {
    if (state.animationRaf) cancelAnimationFrame(state.animationRaf);
    if (state.restoreTimer) clearTimeout(state.restoreTimer);
    state.animationRaf = 0;
    state.restoreTimer = 0;
  }

  function snapshotPropertyStyles(target, properties) {
    const snapshot = {};
    for (const property of properties) {
      snapshot[property] = {
        value: target.style.getPropertyValue(property),
        priority: target.style.getPropertyPriority(property),
      };
    }
    return snapshot;
  }

  function restorePropertyStyles(target, snapshot, properties) {
    if (!(target instanceof HTMLElement) || !snapshot) return;
    for (const property of properties) {
      const saved = snapshot[property];
      if (saved?.value) target.style.setProperty(property, saved.value, saved.priority || '');
      else target.style.removeProperty(property);
    }
  }

  function isSafeRadiosondeHost(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    if (element === document.body || element === document.documentElement) return false;
    const visualHost = state.host;
    if (!(visualHost instanceof HTMLElement) || !visualHost.isConnected) return false;

    const rect = element.getBoundingClientRect();
    const hostRect = visualHost.getBoundingClientRect();
    const viewportWidth = Math.max(1, Number(window.innerWidth) || 1);
    const maxWidth = Math.min(viewportWidth * 0.9, Math.max(hostRect.width * 1.45, hostRect.width + 180));
    return rect.width >= 180 && rect.width <= maxWidth && rect.height >= 28;
  }

  function isStableRadiosondePopup(popup = document.getElementById('igx-live-popup')) {
    return popup instanceof HTMLElement && popup.dataset.igxStableInlineHost === '1';
  }

  function scheduleRadiosondeLayoutSync() {
    if (state.radiosondeSyncRaf) return;
    state.radiosondeSyncRaf = requestAnimationFrame(() => {
      state.radiosondeSyncRaf = 0;
      if (!isStableRadiosondePopup()) return;
      try { document.dispatchEvent(new CustomEvent('ccr:composer-layout')); } catch (_) {}
    });
  }

  function restoreRadiosondePin() {
    if (state.radiosondeRestoreTimer) clearTimeout(state.radiosondeRestoreTimer);
    if (state.radiosondeRepairRaf) cancelAnimationFrame(state.radiosondeRepairRaf);
    try { state.radiosondeObserver?.disconnect?.(); } catch (_) {}
    state.radiosondeRestoreTimer = 0;
    state.radiosondeRepairRaf = 0;
    state.radiosondeObserver = null;
    const popup = state.radiosondePopup;
    if (popup instanceof HTMLElement) {
      restorePropertyStyles(popup, state.radiosondeStyles, RADIOSONDE_STYLE_PROPS);
      popup.removeAttribute('data-ccr-radiosonde-pinned');
    }
    state.radiosondePopup = null;
    state.radiosondeStyles = null;
    state.radiosondeHost = null;
  }

  function ensureRadiosondeObserver(popup) {
    if (!popup || state.radiosondeObserver) return;
    const off = Core.on('mutations',()=>{
      if (!state.expanded || !popup.isConnected || popup.parentElement===document.documentElement) return;
      Core.frame('radiosonde-repair',()=>{if(state.expanded&&popup.isConnected)stabilizeRadiosondeHost();});
    });
    state.radiosondeObserver = {disconnect:off};
  }

  function scheduleRadiosondeRestore() {
    if (isStableRadiosondePopup()) {
      if (state.radiosondePopup) restoreRadiosondePin();
      scheduleRadiosondeLayoutSync();
      return;
    }
    if (state.radiosondeRestoreTimer) clearTimeout(state.radiosondeRestoreTimer);
    if (!(state.radiosondePopup instanceof HTMLElement)) return;
    state.radiosondeRestoreTimer = setTimeout(() => {
      state.radiosondeRestoreTimer = 0;
      if (state.expanded) return;
      // 원본 라존데의 1.8초 재탐색이 올바른 좁은 부모로 돌아온 뒤에만 고정을 푼다.
      // 아직 넓은 form에 남아 있으면 한 주기 더 기다려 전체 폭 번쩍임을 막는다.
      if (!isSafeRadiosondeHost(state.radiosondePopup?.parentElement)) {
        scheduleRadiosondeRestore();
        return;
      }
      restoreRadiosondePin();
    }, 2100);
  }

  function captureRadiosondeHost() {
    if (state.radiosondeRestoreTimer) clearTimeout(state.radiosondeRestoreTimer);
    state.radiosondeRestoreTimer = 0;
    const popup = document.getElementById('igx-live-popup');
    if (!(popup instanceof HTMLElement) || !popup.classList.contains('inline')) {
      restoreRadiosondePin();
      return;
    }

    if (state.radiosondePopup !== popup) {
      restoreRadiosondePin();
      state.radiosondePopup = popup;
      state.radiosondeStyles = snapshotPropertyStyles(popup, RADIOSONDE_STYLE_PROPS);
    }
    ensureRadiosondeObserver(popup);

    // 세로 위치는 확장 전 라존데가 원래 붙어 있던 부모를 기억한다.
    // 좌우 폭은 아래 stabilizeRadiosondeHost()에서 실제 입력 박스를 따로 사용한다.
    if (!isSafeRadiosondeHost(state.radiosondeHost)) {
      const current = popup.parentElement;
      state.radiosondeHost = isSafeRadiosondeHost(current) ? current : state.host;
    }
  }

  function stabilizeRadiosondeHost() {
    if (isStableRadiosondePopup()) {
      if (state.radiosondePopup) restoreRadiosondePin();
      scheduleRadiosondeLayoutSync();
      return;
    }
    if (!state.expanded) {
      scheduleRadiosondeRestore();
      return;
    }
    captureRadiosondeHost();
    const popup = state.radiosondePopup;
    const host = state.radiosondeHost;
    if (!(popup instanceof HTMLElement) || !(host instanceof HTMLElement) || !host.isConnected) return;

    const anchorRect = host.getBoundingClientRect();
    const visualHost = state.host instanceof HTMLElement && state.host.isConnected ? state.host : host;
    const visualRect = visualHost.getBoundingClientRect();
    const viewportWidth = Math.max(1, Number(window.innerWidth) || 1);
    const left = Math.max(0, Math.min(visualRect.left, viewportWidth - 180));
    const width = Math.max(180, Math.min(visualRect.width, viewportWidth - left));
    // 라존데 원본은 입력창이 55vh를 넘으면 transform이 걸린 바깥 form으로 popup을 옮긴다.
    // 그 안에서는 fixed 좌표도 form 기준으로 밀리므로, 펼친 동안만 루트에 두어 뷰포트 좌표를 보장한다.
    if (popup.parentElement !== document.documentElement) document.documentElement.appendChild(popup);
    popup.setAttribute('data-ccr-radiosonde-pinned', '1');
    setImportantStyle(popup, 'position', 'fixed', 'important');
    setImportantStyle(popup, 'top', `${Math.round(anchorRect.top + 6)}px`, 'important');
    setImportantStyle(popup, 'left', `${Math.round(left)}px`, 'important');
    setImportantStyle(popup, 'right', 'auto', 'important');
    setImportantStyle(popup, 'width', `${Math.round(width)}px`, 'important');
    setImportantStyle(popup, 'max-width', `${Math.round(width)}px`, 'important');
    setImportantStyle(popup, 'z-index', '80', 'important');
  }

  function finishRestore({ scrollToEnd = false } = {}) {
    const target = state.target;
    cancelAnimation();
    if (target instanceof HTMLElement) {
      restoreStyles(target, state.originalStyles);
      if (scrollToEnd && target.isConnected) {
        requestAnimationFrame(() => {
          if (!target.isConnected) return;
          target.scrollTop = Math.max(0, Number(target.scrollHeight || 0) - Number(target.clientHeight || 0));
        });
      }
    }
    state.originalStyles = null;
    state.collapsedHeight = 0;
    state.originalScrollTop = 0;
    scheduleRadiosondeRestore();
  }

  function setButtonState(visible, expanded = state.expanded) {
    const button = state.toggle;
    if (!(button instanceof HTMLButtonElement)) return;
    button.classList.toggle('ccr-expand-visible', Boolean(visible));
    button.tabIndex = visible ? 0 : -1;
    button.setAttribute('aria-hidden', visible ? 'false' : 'true');
    const nextState = expanded ? 'expanded' : 'collapsed';
    if (button.dataset.state !== nextState) {
      button.dataset.state = nextState;
      button.innerHTML = TOGGLE_ICONS[nextState];
    }
    const label = expanded ? '입력창 원래 크기로 접기' : '입력창 내용 전체 펼치기';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', expanded ? 'true' : 'false');
  }

  function updateExpandedHeight() {
    const target = state.target;
    if (!state.expanded || !(target instanceof HTMLElement) || !target.isConnected) return;
    const contentHeight = Math.max(state.collapsedHeight, Math.ceil(Number(target.scrollHeight || 0)));
    const desiredHeight = Math.max(state.collapsedHeight, Math.min(contentHeight, maximumHeight()));
    setImportantStyle(target, 'height', `${desiredHeight}px`);
    setImportantStyle(target, 'max-height', `${desiredHeight}px`);
    setImportantStyle(target, 'overflow-y', 'auto');
    if (contentHeight <= desiredHeight + APP.overflowSlack) target.scrollTop = 0;
    positionControls();
    stabilizeRadiosondeHost();
  }

  function collapseInput({ immediate = false, scrollToEnd = true } = {}) {
    if (!state.expanded && !state.originalStyles) return;
    const target = state.target;
    state.expanded = false;
    setButtonState(true, false);

    if (!(target instanceof HTMLElement) || !target.isConnected || immediate) {
      finishRestore({ scrollToEnd: false });
      return;
    }

    cancelAnimation();
    const fromHeight = Math.max(state.collapsedHeight, currentHeight(target));
    target.setAttribute('data-ccr-animating', '1');
    setImportantStyle(target, 'height', `${fromHeight}px`);
    setImportantStyle(target, 'max-height', `${fromHeight}px`);
    void target.offsetHeight;
    state.animationRaf = requestAnimationFrame(() => {
      state.animationRaf = 0;
      if (!(target instanceof HTMLElement) || !target.isConnected) {
        finishRestore({ scrollToEnd: false });
        return;
      }
      const collapsedHeight = Math.max(1, state.collapsedHeight || target.clientHeight || 1);
      setImportantStyle(target, 'height', `${collapsedHeight}px`);
      setImportantStyle(target, 'max-height', `${collapsedHeight}px`);
      positionControls();
    });
    state.restoreTimer = setTimeout(() => {
      state.restoreTimer = 0;
      finishRestore({ scrollToEnd });
      scheduleSync(20);
    }, 220);
  }

  function expandInput() {
    const input = state.input;
    const target = state.target;
    if (state.expanded || !(input instanceof HTMLElement) || !(target instanceof HTMLElement)) return;
    if (!hasExpandableContent(input) || !elementOverflows(target)) return;

    finishRestore({ scrollToEnd: false });
    state.originalStyles = snapshotStyles(target);
    state.collapsedHeight = currentHeight(target);
    state.originalScrollTop = Math.max(0, Number(target.scrollTop) || 0);
    state.expanded = true;
    captureRadiosondeHost();

    target.setAttribute('data-ccr-expanded', '1');
    target.setAttribute('data-ccr-animating', '1');
    setImportantStyle(target, 'height', `${state.collapsedHeight}px`);
    setImportantStyle(target, 'max-height', `${state.collapsedHeight}px`);
    setImportantStyle(target, 'overflow-y', 'auto');
    void target.offsetHeight;
    state.animationRaf = requestAnimationFrame(() => {
      state.animationRaf = 0;
      updateExpandedHeight();
    });
    setButtonState(true, true);
  }

  function toggleExpanded() {
    syncNow();
    if (state.expanded) collapseInput();
    else expandInput();
  }

  function compactAfterSend(previousTarget = state.target) {
    collapseInput({ immediate: true, scrollToEnd: false });

    const generation = Core.epoch, previousInput = state.input;
    const compactOnce = (force = false) => {
      if (Core.epoch !== generation || Core.editor !== previousInput) return;
      const input = findChatInput();
      if (!force && input instanceof HTMLElement && hasExpandableContent(input)) return;

      const candidates = new Set();
      if (previousTarget instanceof HTMLElement && previousTarget.isConnected) candidates.add(previousTarget);
      if (state.target instanceof HTMLElement && state.target.isConnected) candidates.add(state.target);
      if (input instanceof HTMLElement) {
        candidates.add(input);
        const target = findResizeTarget(input);
        if (target instanceof HTMLElement) candidates.add(target);
      }

      for (const element of candidates) {
        for (const property of STYLE_PROPS) element.style.removeProperty(property);
        element.removeAttribute('data-ccr-expanded');
        element.removeAttribute('data-ccr-animating');
      }

      state.expanded = false;
      state.originalStyles = null;
      state.collapsedHeight = 0;
      state.originalScrollTop = 0;
      state.hadContent = false;
      scheduleRadiosondeRestore();
      setButtonState(false, false);
      scheduleSync(20);
    };

    compactOnce(true);
    requestAnimationFrame(() => compactOnce(false));
    for (const delay of [45, 140, 300, 650, 1200]) setTimeout(compactOnce, delay);
  }

  function disconnectContextObservers() {
    state.stopTargetSize?.();state.stopTargetSize = null;
  }

  function observeContext(input,target) {
    disconnectContextObservers();
    if (target && target !== input) state.stopTargetSize = Core.watchSize(target,()=>scheduleSync());
  }

  function setContext(input, target) {
    if (state.input === input && state.target === target) return;
    if (state.expanded || state.originalStyles) collapseInput({ immediate: true, scrollToEnd: false });
    state.input = input;
    state.target = target;
    state.hadContent = hasExpandableContent(input);
    observeContext(input, target);
  }

  function restoreHostPosition() {
    const host = state.host;
    if (!(host instanceof HTMLElement)) return;
    host.removeAttribute('data-ccr-host');
  }

  function ensureControlLayer() {
    let layer = document.getElementById(ID.layer);
    if (!(layer instanceof HTMLElement)) {
      layer = document.createElement('div');
      layer.id = ID.layer;
      (document.body || document.documentElement).appendChild(layer);
    }
    return layer;
  }

  function positionControls() {
    const host = state.host;
    const button = state.toggle;
    if (!(host instanceof HTMLElement) || !host.isConnected) return;
    const rect = host.getBoundingClientRect();
    const viewportWidth = Math.max(1, Number(window.innerWidth) || 1);
    const viewportHeight = Math.max(1, Number(window.innerHeight) || 1);
    const visible = rect.width >= 160 && rect.height >= 28
      && rect.right > 0 && rect.left < viewportWidth && rect.bottom > 0 && rect.top < viewportHeight;
    const left = Math.max(0, Math.min(rect.left, viewportWidth));
    const right = Math.max(left, Math.min(rect.right, viewportWidth));
    const top = Math.max(0, Math.min(rect.top, viewportHeight));

    if (button instanceof HTMLElement) {
      const menu = host.querySelector('#chud-sidebar .chud-settings-button');
      const menuRect = menu instanceof HTMLElement ? menu.getBoundingClientRect() : null;
      const besideMenu = menuRect && menuRect.width > 0 && menuRect.height > 0
        && menuRect.left >= rect.left && menuRect.right <= rect.right + 1;
      const buttonLeft = besideMenu ? Math.max(left + 4, menuRect.left - 28) : Math.max(left, right - 29);
      // 대시보드가 긴 입력창 스크롤에 맞춰 메뉴를 위로 숨겨도 버튼은 입력창에 남긴다.
      const buttonTop = top + 6;
      setImportantStyle(button, 'left', `${Math.round(buttonLeft)}px`);
      setImportantStyle(button, 'top', `${Math.round(buttonTop)}px`);
      setImportantStyle(button, 'visibility', visible ? 'visible' : 'hidden', 'important');
      try {
        const source = document.querySelector('#chud-sidebar, #chud-infobar') || host;
        const color = getComputedStyle(source).color;
        if (color) button.style.setProperty('--ccr-control-color', color);
      } catch (_) {}
    }
  }

  function createToggleButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = ID.toggle;
    button.tabIndex = -1;
    button.setAttribute('aria-hidden', 'true');
    button.innerHTML = TOGGLE_ICONS.collapsed;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleExpanded();
    });
    return button;
  }

  function ensureButton() {
    const host = state.host;
    if (!(host instanceof HTMLElement)) return;
    const layer = ensureControlLayer();
    let button = document.getElementById(ID.toggle);
    if (!(button instanceof HTMLButtonElement) || button.parentElement !== layer) {
      button?.remove();
      button = createToggleButton();
      layer.appendChild(button);
    }
    state.toggle = button;
    positionControls();
  }

  function bindHost(host) {
    if (state.host === host) {
      ensureButton();
      return;
    }
    document.getElementById(ID.toggle)?.remove();
    restoreHostPosition();
    state.host = host;
    host.setAttribute('data-ccr-host', '1');
    ensureButton();
  }

  function unbindContext({ restore = true } = {}) {
    if (restore && (state.expanded || state.originalStyles)) {
      collapseInput({ immediate: true, scrollToEnd: false });
    }
    cancelAnimation();
    if (state.radiosondeSyncRaf) cancelAnimationFrame(state.radiosondeSyncRaf);
    state.radiosondeSyncRaf = 0;
    disconnectContextObservers();
    restoreRadiosondePin();
    document.getElementById(ID.layer)?.remove();
    restoreHostPosition();
    state.input = null;
    state.target = null;
    state.host = null;
    state.toggle = null;
    state.expanded = false;
    state.originalStyles = null;
    state.collapsedHeight = 0;
    state.originalScrollTop = 0;
    state.hadContent = false;
    state.radiosondeHost = null;
    state.radiosondePopup = null;
    state.radiosondeStyles = null;
    state.radiosondeRestoreTimer = 0;
    state.radiosondeObserver = null;
    state.radiosondeRepairRaf = 0;
    state.radiosondeSyncRaf = 0;
  }

  function syncNow() {
    if (state.syncTimer) clearTimeout(state.syncTimer);
    if (state.syncRaf) cancelAnimationFrame(state.syncRaf);
    state.syncTimer = 0;
    state.syncRaf = 0;

    if (!isPcLike() || !isChatRoomPath()) {
      if (state.input || state.host) unbindContext({ restore: true });
      return;
    }

    const input = findChatInput();
    if (!(input instanceof HTMLElement)) {
      if (state.input || state.host) unbindContext({ restore: true });
      return;
    }

    const host = findUiHost(input);
    if (!(host instanceof HTMLElement)) {
      if (state.input || state.host) unbindContext({ restore: true });
      return;
    }
    bindHost(host);

    if (state.expanded) {
      if (state.input !== input || !(state.target instanceof HTMLElement) || !state.target.isConnected) {
        collapseInput({ immediate: true, scrollToEnd: false });
      } else if (!hasExpandableContent(input)) {
        compactAfterSend(state.target);
        return;
      }
    }

    if (!state.expanded) {
      const target = findResizeTarget(input);
      if (!(target instanceof HTMLElement)) {
        setButtonState(false, false);
        return;
      }
      setContext(input, target);
    }

    if (state.expanded) {
      updateExpandedHeight();
      setButtonState(true, true);
      positionControls();
      return;
    }

    const visible = hasExpandableContent(input) && elementOverflows(state.target);
    setButtonState(visible, false);
    positionControls();
  }

  function scheduleSync() { Core.frame('expander',syncNow); }

  function injectStyles() {
    if (document.getElementById(ID.style)) return;
    const style = document.createElement('style');
    style.id = ID.style;
    style.textContent = `
      #${ID.layer} {
        all: initial !important;
        position: fixed !important;
        inset: 0 !important;
        z-index: 79 !important;
        display: block !important;
        width: 100vw !important;
        height: 100vh !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        pointer-events: none !important;
        overflow: visible !important;
      }
      #${ID.toggle} {
        all: unset !important;
        position: absolute !important;
        top: 6px !important;
        left: 0 !important;
        right: auto !important;
        z-index: 2 !important;
        display: none !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
        width: 22px !important;
        min-width: 22px !important;
        height: 22px !important;
        min-height: 22px !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        color: var(--ccr-control-color, hsl(var(--line-gray-2, 0 0% 62%))) !important;
        line-height: 1 !important;
        opacity: .72 !important;
        cursor: pointer !important;
        pointer-events: auto !important;
        touch-action: manipulation !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        -webkit-tap-highlight-color: transparent !important;
        transition: color .15s, opacity .15s, transform .15s !important;
      }
      #${ID.toggle} svg {
        display: block !important;
        width: 17px !important;
        height: 17px !important;
        fill: none !important;
        stroke: currentColor !important;
        stroke-width: 1.9 !important;
        stroke-linecap: round !important;
        stroke-linejoin: round !important;
        pointer-events: none !important;
      }
      #${ID.toggle}.ccr-expand-visible {
        display: inline-flex !important;
      }
      #${ID.toggle}:hover, #${ID.toggle}:focus-visible {
        opacity: 1 !important;
        outline: none !important;
      }
      #${ID.toggle}:active {
        transform: scale(.92) !important;
      }
      [data-ccr-animating="1"] {
        transition: height .2s ease, max-height .2s ease !important;
      }
      @media (prefers-reduced-motion: reduce) {
        [data-ccr-animating="1"] { transition: none !important; }
      }
      @media (max-width: ${APP.minViewportWidth - 1}px), (pointer: coarse) and (hover: none) {
        #${ID.toggle} { display: none !important; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function start() {
    injectStyles();
    Core.on('route',()=>{unbindContext({restore:true});scheduleSync();});
    Core.on('editor',scheduleSync);Core.on('layout',scheduleSync);
    Core.on('content',()=>{
      if (!state.input || state.input!==Core.editor) {scheduleSync();return;}
      const hasContent=hasExpandableContent(state.input);
      const becameEmpty=state.hadContent&&!hasContent;state.hadContent=hasContent;
      if(state.expanded&&becameEmpty)compactAfterSend(state.target);else scheduleSync();
    });
    Core.on('maintenance',()=>{
      if(document.hidden||!isPcLike()||!isChatRoomPath())return;
      if(Core.editor&&(!state.toggle?.isConnected||state.input!==Core.editor))scheduleSync();
      if(state.expanded)stabilizeRadiosondeHost();
    });
    Core.on('mutations',records=>{
      if(records.some(m=>[...m.addedNodes,...m.removedNodes].some(n=>n instanceof Element&&(n.id==='igx-live-popup'||n.querySelector('#igx-live-popup')))))scheduleSync();
    });
  }

  start();
})();

// ===== dashboard module =====
(function () {
    'use strict';

    /* =========================================================
     * 0. 공용 설정
     * =======================================================*/
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // 기능 ON/OFF (템퍼몽키 메뉴)
    const FEATURE_KEYS = {
        infoBar: 'chud_feat_infobar',
        sidebar: 'chud_feat_sidebar',
        listCracker: 'chud_feat_listcracker'
    };

    const STORAGE = {
        // InfoBar
        infoDetail: 'chud_info_detail_parts',
        infoVisible: 'chud_info_visible_parts',
        // 방 로그 통계 캐시: v13부터 캐시는 즉시 표시용으로만 쓰고, 방 진입 시 raw messages를 재검진한다.
        roomStatsPrefix: 'chud_room_stats_v13_',
        // v3: crackers/history claim 기반 실시간 누적으로 전환. v2의 timestamp 매칭 캐시는 섞지 않는다.
        cumPrefix: 'chud_cum_v3_',
        claimedHistory: 'chud_claimed_history_v1',
        claimLock: 'chud_claim_lock_v1',
        tabId: 'chud_tab_id_v1',
        lastDiffPrefix: 'chud_last_diff_v2_',
        // Sidebar
        sideVisible: 'chud_side_visible_parts',
        hiddenModels: 'chud_hidden_models_v1',
        // Models
        models: 'chud_models_cache'
    };

    const SELECTOR = {
        input: 'textarea[placeholder*="메시지"], textarea[aria-label*="메시지"], textarea, div.__chat_input_textarea, div[contenteditable="true"].tiptap, div.ProseMirror, div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-placeholder], [contenteditable="true"][aria-label*="메시지"]',
        messageGroup: 'div[data-message-group-id]',
        modelIcon: 'img[src*="model-icon"]',
        modelButton: 'button[role="combobox"][aria-controls], button[aria-haspopup="menu"], button[aria-haspopup="dialog"][aria-controls]',
        menuItem: '[role="option"], [role="menuitem"], [role="dialog"] button[aria-current]',
        modelMenu: '[role="listbox"], [data-radix-select-content], [role="menu"], [data-radix-menu-content], [role="dialog"]'
    };

    const API_BASE = 'https://crack-api.wrtn.ai';
    const CONTENTS_API_BASE = 'https://contents-api.wrtn.ai';
    const API = {
        balance: `${API_BASE}/crack-cash/crackers`,
        history: `${API_BASE}/crack-cash/crackers/history`,
        chatModels: `${API_BASE}/crack-gen/v3/chat-models`,
        chatBase: `${API_BASE}/crack-gen/v3/chats`,
        rawMessages: `${CONTENTS_API_BASE}/character-chat/v3/chats`
    };

    const MODEL_TTL = 6 * 60 * 60 * 1000; // 모델 목록 캐시 6시간
    const MODEL_OPEN_REFRESH_TTL = 45 * 1000; // 미니 모델창 열 때만 가볍게 최신 모델 재확인
    const ROOM_STATS_TTL = 90 * 1000; // raw messages 실패/재진입 시 최근 방 통계 캐시는 90초 동안 재사용한다.
    const RAW_REMOTE_SYNC_TTL = 90 * 1000; // 다른 기기/복귀 후 messages 상태를 가볍게 따라잡기 위한 최소 재동기화 간격.
    const HEAVY_SCAN_INTERVAL = 5000; // 외부 확프 버튼 탐색은 관련 DOM 변화가 없으면 5초에 한 번만 수행한다.
    const RELEVANT_MUTATION_SELECTOR = [
        SELECTOR.input,
        SELECTOR.messageGroup,
        SELECTOR.modelIcon,
        SELECTOR.modelButton,
        '[role="dialog"]',
        '[role="menu"]',
        '[data-radix-menu-content]',
        'button',
        '[role="button"]',
        '[role="switch"]',
        '#trans-menu-btn',
        '#trans-setting-panel',
        '.trans-bubble-btn',
        '.crack-ext-header-ai-btn',
        '#crack-ext-ai-sidebar-menu',
        '#crack-ext-ai-sidebar-menu [role="button"]',
        'button[data-ce-ai-summary="true"]',
        '#crack-ai-panel',
        '#crack-pure-settings-btn',
        '#crack-pure-magic-btn',
        '#crack-pure-send-left-group',
        '#cigh-clean-fab',
        '#cigh-clean-dock-fab',
        '#cigh-clean-panel',
        '#sgb-bg-settings-modal',
        '#sgb-bg-settings-row',
        '[data-sgb-settings-open]',
        '[data-sgb-settings-row]',
        '#csp-scene-painter-row',
        '#csp-scene-gallery-row',
        '#csp-v35-root',
        '[data-csp-dashboard-bridge]',
        '#cpm-root',
        '#cpm-launcher',
        '#cpm-embedded-launcher',
        '[data-cpm-profile-fallback="true"]',
        '#wish-rp-toolbar-launcher',
        '#rpcm-overlay',
        '#eic-sidebar-btn-wrapper',
        '#eic-sidebar-label',
        '#lore-inj-entry-button',
        '.lore-inj-entry-button',
        '[data-lore-inj-entry="true"]',
        '#chasm-decentral-menu',
        '.burner-button',
        '[class*="burner-button"]'
    ].join(',');

    /* =========================================================
     * 1. unsafeWindow / CrackUtil 헬퍼
     * =======================================================*/
    function getCrackUtil() {
        try { if (typeof CrackUtil !== 'undefined' && CrackUtil) return CrackUtil; } catch (e) {}
        try { if (typeof unsafeWindow !== 'undefined' && unsafeWindow.CrackUtil) return unsafeWindow.CrackUtil; } catch (e) {}
        try { if (window.CrackUtil) return window.CrackUtil; } catch (e) {}
        return null;
    }

    let warnedNoCrackUtil = false;
    function getPathInfo() { return Core.route(); }

    /* =========================================================
     * 2. 공용 유틸 (테마 / 컨테이너 / 토큰 / 클릭)
     * =======================================================*/
    function findInputContainer(inputEl) {
        const c = inputEl.closest('div.flex.flex-col.rounded-lg.border, div.rounded-lg.border.bg-background');
        return c || inputEl.parentElement;
    }

    function ensurePosition(container) {
        if (container && getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }
    }

    function getThemeColors(refEl) {
        let bg = '#212121';
        let cur = refEl;
        while (cur && cur !== document.body) {
            const c = getComputedStyle(cur).backgroundColor;
            if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break; }
            cur = cur.parentElement;
        }
        const mm = bg.match(/\d+/g);
        let isDark = true;
        if (mm && mm.length >= 3) {
            const [r, g, b] = mm.map(Number);
            isDark = (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128;
        }
        return {
            bg,
            text: isDark ? '#888' : '#777',
            menuBg: isDark ? '#282828' : '#fff',
            menuBorder: isDark ? '#444' : '#e5e5e5',
            itemText: isDark ? '#ccc' : '#444',
            itemHoverBg: isDark ? '#444' : '#f3f4f6',
            itemHoverText: isDark ? '#fff' : '#000',
            costText: isDark ? '#777' : '#999',
            chipBg: isDark ? 'rgba(136,136,136,0.15)' : 'rgba(0,0,0,0.06)',
            activeBtnText: isDark ? '#fff' : '#000',
            sideIconText: isDark ? '#888' : '#777',
            sideIconHoverText: isDark ? '#d4d4d4' : '#222',
            sideIconActiveText: isDark ? '#fff' : '#111'
        };
    }

    function extractAccessToken() {
        for (const c of document.cookie.split(';')) {
            const t = c.trim();
            if (t.startsWith('access_token=')) return t.split('=')[1];
        }
        return null;
    }

    function getTimeFromObjectId(id) {
        if (!id || id.length < 8) return 0;
        try { return parseInt(id.substring(0, 8), 16) * 1000; } catch (e) { return 0; }
    }

    function fileNameOf(url) {
        try { return (url || '').split('/').pop().split('?')[0]; } catch (e) { return ''; }
    }

    function fireClickSequence(el) {
        if (!el) return;
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        el.click();
    }

    function isOwnEl(el) {
        return Core.isOwn(el);
    }

    function isVisibleClickable(el) {
        if (!el || isOwnEl(el)) return false;
        if (el.closest('[role="dialog"]')) return false;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && s.pointerEvents !== 'none' && r.width > 0 && r.height > 0;
    }

    /* =========================================================
     * 3. API 레이어
     * =======================================================*/
    async function apiGet(url) {
        const token = extractAccessToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }

    // (1) 잔여 크래커
    async function fetchBalance() {
        try {
            const j = await apiGet(API.balance);
            const q = j?.data?.quantity;
            return typeof q === 'number' ? q : null;
        } catch (e) { return null; }
    }

    // (2) 모델 목록 (캐시)
    let modelsMem = null; // { storyId, models, ts }
    function resolveModelIcon(m) {
        if (typeof m.icon === 'string' && m.icon) return m.icon;
        const a = m.assets && m.assets.icon;
        if (typeof a === 'string') return a;
        if (a && typeof a === 'object') return a.dark || a.light || Object.values(a)[0] || '';
        return '';
    }

    function isApiModelVisible(m) {
        if (!m || !m.name) return false;
        if (m.isBlock === true) return false;
        if (m.deletedAt) return false;
        // v3 모델 API에는 폐기/대체된 모델도 남아 있을 수 있다.
        // 공식 모델창에는 빠지는 항목이라 미니 모델창에서도 제외한다.
        if (m.replacementChatModelId) return false;
        if (m.deprecateAnnouncementId) return false;
        if (m.serviceType && m.serviceType !== 'story') return false;
        return true;
    }

    function isActiveCrackerEvent(event) {
        if (!event || typeof event !== 'object') return false;
        const v = Number(event.discountedCrackerQuantity);
        if (!Number.isFinite(v) || v <= 0) return false;
        const ranges = Array.isArray(event.timeRanges) ? event.timeRanges : [];
        if (!ranges.length) return true;
        const now = Date.now();
        return ranges.some((r) => {
            const s = r?.startTime ? new Date(r.startTime).getTime() : -Infinity;
            const e = r?.endTime ? new Date(r.endTime).getTime() : Infinity;
            return now >= s && now <= e;
        });
    }

    function getApiModelCost(m) {
        if (isActiveCrackerEvent(m?.crackerEvent)) return Number(m.crackerEvent.discountedCrackerQuantity);
        const v = Number(m?.crackerQuantity);
        return Number.isFinite(v) ? v : null;
    }

    function readStoredOfficialModels(storyId) {
        if (!storyId) return [];
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE.models) || '{}');
            const ent = raw?.[storyId];
            if (!ent || !Array.isArray(ent.models)) return [];
            const src = String(ent.source || '');
            if (!/official-menu/.test(src)) return [];
            return ent.models;
        } catch (e) { return []; }
    }

    function mergeOfficialModelOverrides(models, storyId) {
        const list = Array.isArray(models) ? models : [];
        if (!list.length) return list;

        // 공식 모델 메뉴의 배지 텍스트(예: 85개/58개/50개/20개)가 실제 표시값이다.
        // 모델 API의 crackerQuantity가 늦게 갱신될 수 있으므로, 이미 본 공식 DOM/공식 캐시는 비용만 우선 적용한다.
        const officialByName = new Map();
        const put = (arr) => {
            for (const m of (Array.isArray(arr) ? arr : [])) {
                if (!m?.name) continue;
                officialByName.set(m.name, m);
            }
        };

        put(readStoredOfficialModels(storyId));
        try { put((shared?.models || []).filter((m) => m?.source === 'official-menu')); } catch (e) {}
        try { put(harvestOfficialModels() || []); } catch (e) {}

        if (!officialByName.size) return list;
        return list.map((m) => {
            const official = officialByName.get(m.name);
            if (!official) return m;
            return {
                ...m,
                cost: official.cost != null ? official.cost : m.cost,
                icon: official.icon || m.icon,
                description: official.description || m.description,
                recommended: !!official.recommended || !!m.recommended,
                selected: !!official.selected || !!m.selected,
                source: official.source || 'official-menu'
            };
        });
    }

    async function loadModels(storyId, options = {}) {
        const force = !!options.force;
        if (!storyId) return modelsMem?.models || [];
        if (!force && modelsMem && modelsMem.storyId === storyId && Date.now() - modelsMem.ts < MODEL_TTL) return modelsMem.models;
        // localStorage 캐시는 즉시 표시용. force=true일 때는 공식/API 최신 목록을 다시 확인한다.
        if (!force) {
            try {
                const raw = JSON.parse(localStorage.getItem(STORAGE.models) || '{}');
                const ent = raw[storyId];
                if (ent && Array.isArray(ent.models) && Date.now() - ent.ts < MODEL_TTL) {
                    modelsMem = { storyId, models: ent.models, ts: ent.ts };
                    return ent.models;
                }
            } catch (e) {}
        }
        // fetch
        try {
            const url = `${API.chatModels}?serviceType=story&storyId=${encodeURIComponent(storyId)}`;
            const j = await apiGet(url);
            const raw = j?.data?.models || [];
            const mapped = raw
                .filter(isApiModelVisible)
                .map((m) => ({
                    id: m._id,
                    name: m.name,
                    slug: m.crackerModel,
                    cost: getApiModelCost(m),
                    defaultMaxOutput: Number(m?.maxOutput?.defaultMaxOutput) || 800,
                    per100: Number(m?.maxOutput?.crackerPer100Token) || 0,
                    icon: resolveModelIcon(m),
                    description: m.description || '',
                    recommended: !!m.isCreatorRecommended,
                    selected: false,
                    source: 'api'
                }));
            // 이름 기준 dedupe (마지막 우선)
            const byName = {};
            for (const m of mapped) byName[m.name] = m;
            let list = Object.values(byName);
            if (!list.length) return modelsMem?.models || [];
            list = mergeOfficialModelOverrides(list, storyId);
            // 제작자 권장 1개만 유지
            let kept = false;
            for (const m of list) {
                if (m.recommended) { if (kept) m.recommended = false; else kept = true; }
            }
            modelsMem = { storyId, models: list, ts: Date.now() };
            try {
                const store = JSON.parse(localStorage.getItem(STORAGE.models) || '{}');
                store[storyId] = { models: list, ts: Date.now(), source: list.some((m) => m.source === 'official-menu') ? 'official-menu+api' : 'api' };
                localStorage.setItem(STORAGE.models, JSON.stringify(store));
            } catch (e) {}
            return list;
        } catch (e) {
            return modelsMem?.models || [];
        }
    }

    function modelListSignature(arr) {
        return (arr || []).map((m) => [
            m.name || '',
            m.id || '',
            m.slug || '',
            m.cost != null ? m.cost : '',
            m.icon || '',
            m.description || '',
            m.recommended ? '1' : '0',
            m.selected ? '1' : '0'
        ].join(':')).join('|');
    }

    // (3) 방 메타 (현재 모델 슬러그 등)
    async function fetchChatMeta(chatId) {
        if (!chatId) return null;
        try {
            const j = await apiGet(`${API.chatBase}/${chatId}`);
            return j?.data || null;
        } catch (e) { return null; }
    }

    // (4) 로그 계산 — messages API로 기존 방 누적을 1회 백필하고, 결과는 방별 로컬 캐시에 저장해 재방문 시 재사용.
    const logCache = {}; // chatId → raw/API 기반 방 통계 캐시

    function makeEmptyLogPrev(chatId = '') {
        return {
            domCount: -1,
            aiIds: new Set(),
            timestamps: [],
            order: null,
            computed: false,
            forceRawRefresh: false,
            cachedAt: 0,
            rawRetryAfter: 0,
            source: ''
        };
    }

    function normalizeRoomStatsCache(raw, chatId, domCount = 0) {
        if (!raw || typeof raw !== 'object') return null;
        const generationCount = Math.max(0, Math.floor(Number(raw.generationCount ?? raw.persistentAi ?? 0)));
        const officialTurnCount = Math.max(0, Math.floor(Number(raw.officialTurnCount ?? 0)));
        const totalMessages = Math.max(0, Math.floor(Number(raw.totalMessages ?? 0)));
        if (!generationCount && !officialTurnCount && !totalMessages) return null;
        const timestamps = Array.isArray(raw.timestamps) ? raw.timestamps.filter((t) => typeof t === 'number' && t > 0) : [];
        return {
            domCount,
            chatCounts: Math.max(0, Math.floor(Number(raw.chatCounts ?? (officialTurnCount + 1)) || 0)),
            totalMessages,
            persistentAi: generationCount,
            generationCount,
            officialTurnCount,
            currentAssistantCount: Math.max(0, Math.floor(Number(raw.currentAssistantCount ?? raw.activeAssistantCount ?? 0) || 0)),
            currentPrologueCount: Math.max(0, Math.floor(Number(raw.currentPrologueCount ?? raw.prologueCount ?? 0) || 0)),
            userTurnCount: Math.max(0, Math.floor(Number(raw.userTurnCount ?? officialTurnCount) || 0)),
            aiIds: new Set(),
            timestamps,
            order: raw.order || null,
            computed: true,
            forceRawRefresh: false,
            cachedAt: Math.max(0, Number(raw.cachedAt || 0)),
            rawRetryAfter: Math.max(0, Number(raw.rawRetryAfter || 0)),
            source: raw.source || 'rawMessagesCache'
        };
    }

    function loadRoomStatsCache(chatId, domCount = 0) {
        if (!chatId) return null;
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE.roomStatsPrefix + chatId) || 'null');
            return normalizeRoomStatsCache(raw, chatId, domCount);
        } catch (e) { return null; }
    }

    function saveRoomStatsCache(chatId, result) {
        if (!chatId || !result) return;
        try {
            const timestamps = Array.isArray(result.timestamps) ? result.timestamps.slice(-1200) : [];
            localStorage.setItem(STORAGE.roomStatsPrefix + chatId, JSON.stringify({
                cachedAt: Date.now(),
                chatCounts: Math.max(0, Math.floor(Number(result.chatCounts || 0))),
                totalMessages: Math.max(0, Math.floor(Number(result.totalMessages || 0))),
                persistentAi: Math.max(0, Math.floor(Number(result.generationCount ?? result.persistentAi ?? 0))),
                generationCount: Math.max(0, Math.floor(Number(result.generationCount ?? result.persistentAi ?? 0))),
                officialTurnCount: Math.max(0, Math.floor(Number(result.officialTurnCount || 0))),
                currentAssistantCount: Math.max(0, Math.floor(Number(result.currentAssistantCount ?? 0))),
                currentPrologueCount: Math.max(0, Math.floor(Number(result.currentPrologueCount ?? 0))),
                userTurnCount: Math.max(0, Math.floor(Number(result.userTurnCount ?? result.officialTurnCount ?? 0))),
                timestamps,
                order: result.order || null,
                rawRetryAfter: Math.max(0, Number(result.rawRetryAfter || 0)),
                source: result.source || 'rawMessages'
            }));
        } catch (e) {}
    }

    function buildRawMessageStats(chatId, domCount, rows, prev = makeEmptyLogPrev(chatId)) {
        const userRows = rows.filter(isRawUserMessage);
        const userIds = new Set(userRows.map(getRawMessageId).filter(Boolean));
        const userIdlessRows = userRows.filter((m) => !getRawMessageId(m)).length;
        const assistantRows = rows.filter(isRawAssistantMessage);
        const currentPrologueCount = assistantRows.filter(isRawPrologueMessage).length;
        const nonPrologueAssistants = assistantRows.filter((m) => !isRawPrologueMessage(m));
        // 진행턴: messages API의 user 고유 ID 개수를 공식 기준으로 삼는다.
        // assistant 기준은 분기 답변이 남으면 +1로 흔들릴 수 있어서 턴수로 쓰지 않는다.
        const userTurnCount = userIds.size + userIdlessRows;
        const officialTurnCount = userTurnCount;

        // 현재 남은 AI: 같은 messages API에서 assistant row 상태를 별도로 참고한다.
        const currentAssistantCount = nonPrologueAssistants.length;

        // 생성 누적수는 기기/로컬 저장 상태에 따라 어긋나기 쉬워 표시에서 제외했다.
        // 내부 캐시 호환용 generationCount는 현재 API에 남아 있는 답변 수만 기록한다.
        const generationCount = currentAssistantCount;

        const aiTimes = nonPrologueAssistants.map(getRawMessageTime).filter((t) => t > 0);
        const sorted = rows.slice().sort((a, b) => getRawMessageTime(a) - getRawMessageTime(b));
        const order = sorted.length >= 2 ? 'asc' : (prev.order || null);
        const result = {
            domCount,
            chatCounts: officialTurnCount + 1,
            totalMessages: rows.length,
            persistentAi: generationCount,
            generationCount,
            officialTurnCount,
            userTurnCount,
            currentAssistantCount,
            currentPrologueCount,
            aiIds: prev.aiIds || new Set(),
            timestamps: aiTimes,
            order,
            computed: true,
            forceRawRefresh: false,
            cachedAt: Date.now(),
            source: 'rawMessages:userUniqueTurn_currentAnswer_localGenerationTotal'
        };
        saveRoomStatsCache(chatId, result);
        return result;
    }

    function getRawMessageId(m) {
        return String(m?._id || m?.id || m?.messageId || '').trim();
    }

    function isRawUserMessage(m) {
        const role = String(m?.role || '').toLowerCase();
        return role === 'user';
    }

    function isRawAssistantMessage(m) {
        const role = String(m?.role || '').toLowerCase();
        return role === 'assistant' || role === 'ai' || role === 'model';
    }

    function isRawPrologueMessage(m) {
        // prologue는 공식적으로 0턴이다.
        // 주의: 일부 row에 prologue라는 보조 필드/객체가 있을 수 있으므로 truthy 전체를 prologue로 보지 않는다.
        const values = [m?.isPrologue, m?.isPrologueMessage, m?.prologue];
        return values.some((v) => v === true || v === 'true' || v === 1 || v === '1');
    }

    function getRawMessageTime(m) {
        const direct = m?.createdAt || m?.created_at || m?.date || m?.updatedAt || m?.updated_at;
        const td = direct ? new Date(direct).getTime() : 0;
        if (Number.isFinite(td) && td > 0) return td;
        return getTimeFromObjectId(m?._id || m?.id || m?.messageId || m?.turnId || '');
    }

    function pickRawMessageArray(json) {
        const data = json?.data ?? json;
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.messages)) return data.messages;
        if (Array.isArray(data?.items)) return data.items;
        if (Array.isArray(data?.logs)) return data.logs;
        if (Array.isArray(data?.list)) return data.list;
        return [];
    }

    function pickRawMessageCursor(json) {
        const data = json?.data ?? json;
        return data?.nextCursor
            || data?.next_cursor
            || data?.next
            || json?.nextCursor
            || json?.next_cursor
            || '';
    }

    // 메모리 캐시: 전체 재동기화 시각에서 10분이 지나면 다음 요청은 끝까지 읽는다.
    const rawRowsCache = new Map();
    const RAW_FULL_RESYNC_MS = 10 * 60 * 1000;

    async function fetchAllRawMessages(chatId) {
        const cache = rawRowsCache.get(chatId);
        const prevIds = cache && Date.now() - cache.fullAt < RAW_FULL_RESYNC_MS ? cache.ids : null;
        const rows = [];
        const seenIds = new Set();
        const seenCursors = new Set();
        let cursor = '';
        let page = 0;
        let newestFirst = false;
        let overlapped = false;
        let complete = false;
        let oldest = Infinity;
        let lastTime = Infinity;
        let mergeSafe = !!prevIds && cache.rows.every(m => getRawMessageId(m) && getRawMessageTime(m) > 0);
        const generation = Core.epoch;
        while (page < 120) {
            if(generation!==Core.epoch||Core.route().chatId!==chatId)throw new Error('room changed');
            const url = `${API.rawMessages}/${encodeURIComponent(chatId)}/messages?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
            const json = await apiGet(url);
            if(generation!==Core.epoch||Core.route().chatId!==chatId)throw new Error('room changed');
            const arr = pickRawMessageArray(json);
            if (page === 0) newestFirst = arr.length >= 2 && getRawMessageTime(arr[0]) > getRawMessageTime(arr[arr.length - 1]);
            let known = 0;
            for (const m of arr) {
                const id = getRawMessageId(m);
                // 경계 중복을 제거한다. ID/시각이 불명확한 행도 보존하고 끝까지 읽는다.
                if (id) {
                    if (seenIds.has(id)) continue;
                    seenIds.add(id);
                    if (prevIds && prevIds.has(id)) known++;
                }
                const t = getRawMessageTime(m);
                if (!id || !(t > 0) || t > lastTime) mergeSafe = false;
                lastTime = t;
                if (t > 0 && t < oldest) oldest = t;
                rows.push(m);
            }
            cursor = pickRawMessageCursor(json);
            page++;
            if (!cursor || !arr.length) { complete = true; break; }
            // 같은 시각의 페이지 경계 메시지를 버리지 않는다. 경계가 불명확하면 더 읽는다.
            const tiedBoundary = mergeSafe && cache.rows.some(m =>
                !seenIds.has(getRawMessageId(m)) && getRawMessageTime(m) === oldest);
            if (mergeSafe && newestFirst && known && !tiedBoundary) { overlapped = true; break; }
            if (seenCursors.has(cursor)) break;
            seenCursors.add(cursor);
            await sleep(20);
        }
        if (overlapped) {
            for (const m of cache.rows) {
                const id = getRawMessageId(m);
                if (id && seenIds.has(id)) continue;
                const t = getRawMessageTime(m);
                if (t > 0 && t < oldest) rows.push(m);
            }
        }
        // 제한/반복 cursor로 끊긴 결과를 완전한 캐시로 사용하지 않는다.
        if (overlapped || complete) rawRowsCache.set(chatId, {
            rows,
            ids: new Set(rows.map(getRawMessageId).filter(Boolean)),
            fullAt: overlapped ? cache.fullAt : Date.now()
        });
        else rawRowsCache.delete(chatId);
        return rows;
    }

    async function calcRoomLogsLegacy(chatId, domCount, prev) {
        const cu = getCrackUtil();
        if (!cu || !cu.chatRoom) return null;

        let chatCounts = 0, totalMessages = 0;
        const aiTimes = [];
        const firstIds = [];
        try {
            for await (const log of cu.chatRoom().iterateLogs(chatId)) {
                totalMessages++;
                if (firstIds.length < 3 && log.id) firstIds.push(log.id);
                const isUser = log.isUser && log.isUser();
                if (isUser) { chatCounts++; continue; }
                if (log.id) {
                    aiTimes.push(getTimeFromObjectId(log.id));
                    if (!prev.aiIds.has(log.id)) prev.aiIds.add(log.id);
                }
            }
        } catch (e) {
            return prev.computed ? prev : null;
        }

        let order = prev.order;
        if (!order && firstIds.length >= 2) {
            order = getTimeFromObjectId(firstIds[0]) >= getTimeFromObjectId(firstIds[1]) ? 'desc' : 'asc';
        }

        const generationCount = Math.max(0, prev.aiIds.size - 1);

        const timestamps = aiTimes.filter((t) => t > 0);

        return {
            domCount,
            chatCounts: generationCount + 1,
            totalMessages,
            persistentAi: generationCount,
            generationCount,
            officialTurnCount: generationCount,
            userTurnCount: generationCount,
            currentAssistantCount: generationCount,
            aiIds: prev.aiIds, timestamps,
            order, computed: true,
            source: 'CrackUtil:aiCount'
        };
    }

    async function calcRoomLogs(chatId, domCount) {
        const generation = Core.epoch;
        const cachedStats = loadRoomStatsCache(chatId, domCount);
        const prev = logCache[chatId] || cachedStats || makeEmptyLogPrev(chatId);

        // 게이트: 메시지 수 그대로면 메모리 재사용. generate_done/방 진입 직후 강제 갱신 플래그가 있으면 통과.
        // raw API 실패 후 임시 폴백은 짧은 쿨다운을 두고 재시도한다.
        if (prev.computed && prev.domCount === domCount) {
            if (!prev.forceRawRefresh) return prev;
            if (Number(prev.rawRetryAfter || 0) > Date.now()) return prev;
        }

        // 기존 방 재방문/새로고침 때는 로컬 통계 캐시를 먼저 써서 화면을 즉시 띄운다.
        // 단, TTL은 0이라 방 진입 후 raw messages API 재검진을 반드시 한 번 수행한다.
        if (cachedStats && !prev.forceRawRefresh && Date.now() - Number(cachedStats.cachedAt || 0) < ROOM_STATS_TTL) {
            cachedStats.domCount = domCount;
            logCache[chatId] = cachedStats;
            return cachedStats;
        }

        try {
            const rows = await fetchAllRawMessages(chatId);
            if (!rows.length) throw new Error('raw messages empty');
            const result = buildRawMessageStats(chatId, domCount, rows, prev);
            logCache[chatId] = result;
            return result;
        } catch (e) {
            if(generation!==Core.epoch||Core.route().chatId!==chatId)return null;
            console.debug('[대시보드] raw message API 계산 실패:', e);
            // raw messages API가 실패하면, 정확한 userTurn 기준을 유지하기 위해
            // 먼저 기존 캐시를 보여주고, CrackUtil 폴백은 임시 표시로만 사용한다.
            // 폴백 결과는 영구 캐시에 저장하지 않아 잘못된 턴수가 고착되지 않게 한다.
            if (cachedStats) {
                cachedStats.domCount = domCount;
                logCache[chatId] = cachedStats;
                return cachedStats;
            }
            const legacy = await calcRoomLogsLegacy(chatId, domCount, prev);
            if (legacy) {
                legacy.forceRawRefresh = true;
                legacy.rawRetryAfter = Date.now() + 15000;
                legacy.source = `${legacy.source || 'CrackUtil'}:temporaryFallback`;
                logCache[chatId] = legacy;
            }
            return legacy;
        }
    }

    // (5) 누적(사용) 크래커 — generate_done 이후 crackers/history claim 기반.
    function loadCumCache(chatId) {
        if (!chatId) return { sum: 0, counted: {} };
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE.cumPrefix + chatId) || 'null');
            if (raw && typeof raw.sum === 'number') return { sum: raw.sum, counted: raw.counted || {} };
        } catch (e) {}
        return { sum: 0, counted: {} };
    }
    function saveCumCache(chatId, v) {
        if (!chatId) return;
        try { localStorage.setItem(STORAGE.cumPrefix + chatId, JSON.stringify(v)); } catch (e) {}
    }

    function getConsumedCrackerAmount(item) {
        // crackers/history의 balance.total은 이미 크래커 단위의 실제 차감량으로 취급한다.
        // 이전 버전의 superchat ×35 보정은 현재 모델 비용(20/50/85개 등)과 맞지 않아 제거.
        let v = item?.balance?.total;
        if (typeof v === 'string') v = Number(v.replace(/[^0-9.-]/g, ''));
        if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
        return Math.abs(v);
    }

    function getOrCreateTabId() {
        try {
            let id = sessionStorage.getItem(STORAGE.tabId);
            if (!id) {
                id = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
                sessionStorage.setItem(STORAGE.tabId, id);
            }
            return id;
        } catch (e) {
            return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
        }
    }

    const TAB_ID = getOrCreateTabId();
    let activeGenerationSession = null;

    function startGenerationSession(chatId = getPathInfo().chatId) {
        if (!chatId) return;
        activeGenerationSession = { tabId: TAB_ID, chatId, startedAt: Date.now() };
    }

    function getHistoryRecordTime(rec) {
        const t = new Date(rec?.date || rec?.createdAt || rec?.created_at || '').getTime();
        return Number.isFinite(t) ? t : 0;
    }

    function makeHistoryKey(rec) {
        const id = rec?._id || rec?.id || rec?.historyId || rec?.transactionId || '';
        if (id) return `id:${id}`;
        const amount = getConsumedCrackerAmount(rec);
        const paid = rec?.balance?.paid ?? '';
        const free = rec?.balance?.free ?? '';
        return ['hist', rec?.date || '', rec?.title || '', amount, paid, free, rec?.consumedType || '', rec?.product || ''].join('|');
    }

    function loadClaimedHistory() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE.claimedHistory) || '{}');
            return raw && typeof raw === 'object' ? raw : {};
        } catch (e) { return {}; }
    }

    function saveClaimedHistory(claimed) {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        try {
            for (const [k, v] of Object.entries(claimed || {})) {
                const ts = typeof v === 'number' ? v : Number(v?.claimedAt || 0);
                if (!ts || ts < cutoff) delete claimed[k];
            }
            localStorage.setItem(STORAGE.claimedHistory, JSON.stringify(claimed || {}));
        } catch (e) {}
    }

    function getLastDiffKey(chatId) {
        return chatId ? `${STORAGE.lastDiffPrefix}${chatId}` : '';
    }

    function saveLastDeductedAmount(chatId, amount) {
        const v = Number(amount) || 0;
        if (!chatId || v <= 0) return;
        try { localStorage.setItem(getLastDiffKey(chatId), String(v)); } catch (e) {}
    }

    function loadLastDeductedAmount(chatId) {
        if (!chatId) return 0;
        try {
            const primary = parseInt(localStorage.getItem(getLastDiffKey(chatId)), 10);
            return Number.isFinite(primary) && primary > 0 ? primary : 0;
        } catch (e) { return 0; }
    }

    async function withLocalStorageClaimLock(fn) {
        const owner = `${TAB_ID}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        const deadline = Date.now() + 3500;
        while (Date.now() < deadline) {
            try {
                const cur = JSON.parse(localStorage.getItem(STORAGE.claimLock) || 'null');
                if (!cur || !cur.ts || Date.now() - Number(cur.ts) > 5000) {
                    localStorage.setItem(STORAGE.claimLock, JSON.stringify({ owner, ts: Date.now() }));
                    await sleep(25);
                    const check = JSON.parse(localStorage.getItem(STORAGE.claimLock) || 'null');
                    if (check?.owner === owner) {
                        try { return await fn(); }
                        finally {
                            try {
                                const latest = JSON.parse(localStorage.getItem(STORAGE.claimLock) || 'null');
                                if (latest?.owner === owner) localStorage.removeItem(STORAGE.claimLock);
                            } catch (e) {}
                        }
                    }
                }
            } catch (e) {}
            await sleep(60 + Math.floor(Math.random() * 80));
        }
        // 최후 폴백: 락 획득 실패 시에도 claimed fresh read를 수행한다.
        return await fn();
    }

    async function withCrackerClaimLock(fn) {
        try {
            if (navigator?.locks?.request) {
                return await navigator.locks.request('chud-cracker-claim', { mode: 'exclusive' }, fn);
            }
        } catch (e) {}
        return await withLocalStorageClaimLock(fn);
    }

    async function claimConsumption(rec, chatId) {
        const amount = getConsumedCrackerAmount(rec);
        if (!chatId || amount <= 0) return 0;
        const key = makeHistoryKey(rec);
        let added = 0;
        await withCrackerClaimLock(async () => {
            const claimed = loadClaimedHistory();
            if (claimed[key]) return;
            claimed[key] = { claimedAt: Date.now(), chatId, amount };
            saveClaimedHistory(claimed);

            const cache = loadCumCache(chatId);
            const next = {
                sum: (Number(cache.sum) || 0) + amount,
                counted: { ...(cache.counted || {}), [`history:${key}`]: true }
            };
            saveCumCache(chatId, next);
            saveLastDeductedAmount(chatId, amount);
            added = amount;
        });
        if (added > 0 && shared?.chatId === chatId) {
            shared.cumulative = loadCumCache(chatId).sum || 0;
            refreshAll();
        }
        if (added > 0) scheduleListCrackerUpdate();
        return added;
    }

    async function fetchRecentHistoryItems(limit = 20) {
        try {
            const json = await apiGet(`${API.history}?limit=${limit}&type=all&page=1`);
            return Array.isArray(json?.data) ? json.data : [];
        } catch (e) { return []; }
    }

    function findHistoryCandidates(items, session) {
        const startedAt = Number(session?.startedAt || 0);
        const doneAt = Number(session?.doneAt || Date.now());
        const minT = Math.max(0, startedAt - 30000);
        const maxT = doneAt + 45000;
        return (items || [])
            .map((rec) => ({ rec, t: getHistoryRecordTime(rec), amount: getConsumedCrackerAmount(rec) }))
            .filter((x) => x.t > 0 && x.t >= minT && x.t <= maxT)
            .filter((x) => {
                const product = String(x.rec?.product || '').toLowerCase();
                return String(x.rec?.isConsumed) === 'true' && (!product || product.includes('cracker')) && x.amount > 0;
            })
            .sort((a, b) => Math.abs(a.t - doneAt) - Math.abs(b.t - doneAt) || b.t - a.t)
            .map((x) => x.rec);
    }

    async function pollAndClaimConsumption(session) {
        if (!session?.chatId) return;
        const delays = [800, 1600, 2600, 4200];
        for (const delay of delays) {
            await sleep(delay);
            const items = await fetchRecentHistoryItems(20);
            const candidates = findHistoryCandidates(items, session);
            for (const rec of candidates) {
                const added = await claimConsumption(rec, session.chatId);
                if (added > 0) return;
            }
        }
    }

    function getGenerateDoneWindow() {
        try {
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow?.document === document) return unsafeWindow;
        } catch (e) {}
        return window;
    }

    function getGenerateEventName(entry) {
        if (!entry) return '';
        if ((Array.isArray(entry) || typeof entry.length === 'number') && entry[0] === 'event') return String(entry[1] || '');
        return String(entry?.event || '');
    }

    function isGenerateDoneEntry(entry) {
        return /^generate_done$/i.test(getGenerateEventName(entry));
    }

    function getGenerateDoneEntryKey(entry) {
        try {
            const meta = ((Array.isArray(entry) || typeof entry.length === 'number') && entry[0] === 'event') ? entry[2] : entry;
            const msgId = meta?.msg_id || meta?.fe_msg_id || meta?.message_id || meta?.id || '';
            const chatId = meta?.chat_id || meta?.episode_id || '';
            if (msgId) return `${chatId}::${msgId}`;
        } catch (e) {}
        return `time::${Math.floor(Date.now() / 1500)}`;
    }

    function handleGenerateDoneEntry(entry) {
        if (!isGenerateDoneEntry(entry)) return false;
        const eventWindow = getGenerateDoneWindow();
        const key = getGenerateDoneEntryKey(entry);
        if (eventWindow.__chudLastGenerateDoneKey === key) return true;
        eventWindow.__chudLastGenerateDoneKey = key;
        finishGenerationSession(key);
        return true;
    }

    function watchGenerateDone() {
        const eventWindow = getGenerateDoneWindow();
        if (eventWindow.__chudGenerateDoneHookStarted) return;
        eventWindow.__chudGenerateDoneHookStarted = true;

        // 기존 400ms setInterval 감시는 dataLayer.push 훅으로 대체한다.
        // generate_done은 dataLayer에 push되는 항목이므로, 상시 폴링 없이 들어오는 순간만 처리한다.
        const dl = eventWindow.dataLayer = eventWindow.dataLayer || [];
        if (!Array.isArray(dl)) return;

        const scanEntries = (entries) => {
            for (const entry of entries) {
                if (handleGenerateDoneEntry(entry)) break;
            }
        };

        const seen = Number(eventWindow.__chudDataLayerSeenLen || 0);
        if (dl.length > seen) {
            scanEntries(dl.slice(seen));
            eventWindow.__chudDataLayerSeenLen = dl.length;
        } else {
            eventWindow.__chudDataLayerSeenLen = dl.length;
        }

        if (dl.__chudPushWrapped) return;
        const originalPush = dl.push;
        dl.push = function (...items) {
            const ret = originalPush.apply(this, items);
            try {
                scanEntries(items);
                eventWindow.__chudDataLayerSeenLen = this.length;
            } catch (e) {}
            return ret;
        };
        try { Object.defineProperty(dl, '__chudPushWrapped', { value: true, configurable: true }); }
        catch (e) { dl.__chudPushWrapped = true; }
    }

    function finishGenerationSession(eventKey = '') {
        const { chatId, isChat } = getPathInfo();
        if (!isChat || !chatId) return;
        const now = Date.now();
        const session = activeGenerationSession && activeGenerationSession.chatId === chatId && now - activeGenerationSession.startedAt <= 10 * 60 * 1000
            ? activeGenerationSession
            : null;
        activeGenerationSession = null;
        if (!session) return;
        if (logCache[chatId]) {
            logCache[chatId].computed = false;
            logCache[chatId].forceRawRefresh = true;
        }
        scheduleUpdate();
        setTimeout(scheduleUpdate, 1000);
        pollAndClaimConsumption({ ...session, doneAt: now }).catch((e) => console.debug('[대시보드] 크래커 사용량 claim 실패:', e));
    }

    /* =========================================================
     * 4. 아이콘
     * =======================================================*/
    const CRACKER_PATH = "M21.17 12.01c.52-.59.83-1.36.83-2.21s-.31-1.62-.83-2.21l.17-.21q0-.01.02-.02l.14-.21q0-.02.03-.05.06-.1.1-.2l.05-.08.09-.2q.01-.05.04-.11l.06-.18q0-.08.04-.14.01-.07.04-.16l.03-.19q0-.06.02-.13v-.33a3.37 3.37 0 0 0-3.36-3.37l-.33.01q-.06 0-.12.02-.1 0-.2.03-.07 0-.15.04l-.14.04-.18.06-.11.04-.2.09-.07.04-.2.11q-.03 0-.05.03l-.21.14-.02.02-.21.17a3.4 3.4 0 0 0-4.42 0 3.3 3.3 0 0 0-2.21-.83c-.85 0-1.62.31-2.21.83l-.21-.17-.02-.02-.21-.14q-.02 0-.05-.03l-.2-.11-.08-.04-.2-.09-.11-.04-.18-.06-.14-.04-.16-.04-.2-.03-.12-.02-.33-.01a3.37 3.37 0 0 0-3.34 3.82q0 .1.03.19 0 .07.04.16 0 .08.04.14l.06.18q0 .05.04.11.03.1.09.19l.04.08.1.2q.01.02.04.05l.16.23q.07.1.17.21a3.3 3.3 0 0 0-.83 2.21c0 .85.3 1.62.83 2.21a3.3 3.3 0 0 0-.83 2.21c0 .85.3 1.62.83 2.21l-.17.21-.02.02-.14.21q0 .02-.03.05l-.11.2-.04.08-.1.2-.03.11-.06.18-.04.14-.04.16-.03.19-.02.13-.01.33A3.4 3.4 0 0 0 3.02 21c.6.61 1.45.99 2.38.99l.33-.01q.06 0 .12-.02.1 0 .19-.03.07 0 .16-.04l.14-.04.18-.06.1-.04.2-.09.08-.04.2-.11q.03 0 .05-.03l.2-.14.03-.02.2-.17a3.4 3.4 0 0 0 4.43 0 3.32 3.32 0 0 0 4.42 0 3 3 0 0 0 .44.33q.03 0 .05.03l.2.11.08.04.2.09.10.04.19.06.14.04.16.04.19.03.13.02.33.01c.92 0 1.75-.37 2.36-.97l.02-.02c.6-.61.99-1.45.99-2.38l-.01-.33q0-.06-.02-.12 0-.1-.03-.19 0-.07-.04-.16l-.04-.14-.06-.18-.04-.11-.1-.19-.03-.08-.11-.2q0-.02-.03-.05l-.14-.21-.02-.02-.17-.21c.52-.59.83-1.36.83-2.21s-.31-1.62-.83-2.21M7.5 13.5 6 12l1.5-1.5L9 12zM12 6l1.5 1.5L12 9l-1.5-1.5zm0 12-1.5-1.5L12 15l1.5 1.5zm4.5-4.5L15 12l1.5-1.5L18 12z";

    const ICON = {
        settings: `<svg width="6" height="18" viewBox="0 0 6 18" fill="currentColor" class="chud-settings-icon"><circle cx="3" cy="3.5" r="1.8"/><circle cx="3" cy="9" r="1.8"/><circle cx="3" cy="14.5" r="1.8"/></svg>`,
        clock: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chud-small-icon"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
        cracker: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" class="chud-cracker-icon"><path fill="currentColor" d="${CRACKER_PATH}"></path></svg>`,
        bittenCracker: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" class="chud-cracker-icon"><defs><mask id="chud-bite-mask"><rect width="24" height="24" fill="white" /><circle cx="24" cy="0" r="12" fill="black" /></mask></defs><path fill="currentColor" mask="url(#chud-bite-mask)" d="${CRACKER_PATH}"></path></svg>`,
        model: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chud-btn-icon"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"></path><path d="M12 12l8-4.5"></path><path d="M12 12v9"></path><path d="M12 12L4 7.5"></path></svg>`,
        guide: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="15" height="15" class="chud-btn-icon"><path fill-rule="evenodd" d="M15.43 6.9c.5-.25 1.07-.14 1.44.23s.48.93.23 1.44l-2.61 5.33q-.2.4-.6.6l-5.33 2.6c-.5.26-1.08.15-1.44-.22a1.25 1.25 0 0 1-.23-1.44L9.5 10.1q.2-.4.6-.6zm-6.65 8.32 3.72-1.82-1.9-1.9z" clip-rule="evenodd"></path><path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20m0 1.6a8.41 8.41 0 0 0 0 16.8 8.41 8.41 0 0 0 0-16.8" clip-rule="evenodd"></path></svg>`,
        profile: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="15" height="15" class="chud-btn-icon"><path d="M7.97 4.3v-.77h11.82V16.6h-.78v1.6h1.08c.7 0 1.3-.57 1.3-1.3V3.23c0-.7-.57-1.3-1.3-1.3H7.67c-.7 0-1.3.57-1.3 1.3V4.3z"></path><path d="M10.11 8.9a2.66 2.66 0 1 0 0 5.32 2.66 2.66 0 0 0 0-5.32m0 6.13c-1 0-1.94.23-2.7.64a3.2 3.2 0 0 0-1.58 1.8c-.2.7.35 1.3.99 1.3h6.58c.64 0 1.2-.62 1-1.3a3.2 3.2 0 0 0-1.6-1.8 6 6 0 0 0-2.69-.64"></path><path fill-rule="evenodd" d="M3.9 5.7c-.72 0-1.3.58-1.3 1.3v13.68c0 .72.58 1.3 1.3 1.3h12.43c.72 0 1.3-.58 1.3-1.3V7c0-.72-.58-1.3-1.3-1.3zm.3 14.68V7.3h11.83v13.08z" clip-rule="evenodd"></path></svg>`,
        profileBox: `<svg width="15.5" height="15.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="chud-btn-icon" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2.25"/><path d="M5.8 16c.55-2.05 1.65-3.1 3.2-3.1s2.65 1.05 3.2 3.1"/><path d="M15 8h3"/><path d="M15 12h3"/><path d="M15 16h2"/></svg>`,
        note: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" class="chud-btn-icon"><path d="M8 8.35h8v-1.6H8zm8 4H8v-1.6h8zm-8 4h4v-1.6H8z"></path><path fill-rule="evenodd" d="M3.75 3.29c0-.72.58-1.3 1.3-1.3h13.9c.72 0 1.3.58 1.3 1.3v12.6c0 .32-.12.65-.37.9l-4.55 4.8q-.38.4-.95.41H5.05a1.3 1.3 0 0 1-1.3-1.3zm1.6.3V20.4h8.44v-3.8c0-.72.58-1.3 1.3-1.3h3.56V3.6zM17.57 16.9l-2.18 2.3v-2.3z" clip-rule="evenodd"></path></svg>`,
        output: `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="15" height="15" class="chud-btn-icon"><path d="M21 3.2H3v1.6h18zm0 5.75H3v1.6h18zM10 14.7H3v1.6h7zm10.62 2.29.01-.31-.01-.31.77-.75a.64.64 0 0 0 .11-.77l-.77-1.33a.7.7 0 0 0-.83-.33l-.96.27a4 4 0 0 0-.54-.31l-.26-1.04a.64.64 0 0 0-.62-.48h-1.61c-.3 0-.55.2-.62.48l-.26 1.04a4 4 0 0 0-.54.31l-1.03-.29a.65.65 0 0 0-.73.29l-.8 1.39c-.15.25-.1.57.11.78l.77.74-.01.31.01.31-.77.75a.64.64 0 0 0-.11.77l.8 1.39c.14.25.44.38.73.3l1.03-.29q.26.18.54.31l.26 1.04c.07.29.32.49.62.49h1.61c.29 0 .54-.2.62-.48l.26-1.04q.29-.13.54-.31l1.04.3c.28.08.58-.05.72-.3l.81-1.4a.64.64 0 0 0-.11-.77zm-3.91 1.06a1.38 1.38 0 0 1 0-2.76 1.38 1.38 0 0 1 0 2.76"></path></svg>`,
        summary: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="15" height="15" class="chud-btn-icon"><path d="M16.25 10.8a5.39 5.39 0 1 0 .02 10.78 5.39 5.39 0 0 0-.02-10.78m0 9.16a3.78 3.78 0 1 1 0-7.57 3.78 3.78 0 0 1 0 7.57"></path><path d="M17.02 13.43h-1.5v3.12l2.02 1.55.91-1.2-1.43-1.09z"></path><path d="M6.8 19.54v-3.29h-3V4.15h14.9V9.5h1.6V3.85c0-.72-.58-1.3-1.3-1.3H3.5c-.72 0-1.3.58-1.3 1.3v12.7c0 .72.58 1.3 1.3 1.3h1.7v3.2a.9.9 0 0 0 .89.89q.3 0 .58-.21l3.35-2.81-1.03-1.22z"></path><path d="M16.5 6.72H6v1.6h10.5zM11 10.03H6v1.6h5z"></path></svg>`,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" class="chud-btn-icon"><path d="m11.7 6.08 6.36 3.67-6.36 3.67z"></path><path fill-rule="evenodd" d="M6.71 3.91c0-.94.76-1.7 1.7-1.7H20.1c.94 0 1.7.76 1.7 1.7V15.6c0 .94-.76 1.7-1.7 1.7h-2.81v2.8c0 .94-.76 1.7-1.7 1.7H3.9a1.7 1.7 0 0 1-1.7-1.7V8.41c0-.94.76-1.7 1.7-1.7h2.81zm1.7-.1a.1.1 0 0 0-.1.1V15.6q0 .1.1.1H20.1a.1.1 0 0 0 .1-.1V3.91a.1.1 0 0 0-.1-.1zm0 13.49h7.28v2.8a.1.1 0 0 1-.1.1H3.9a.1.1 0 0 1-.1-.1V8.41q0-.1.1-.1h2.81v7.29c0 .94.76 1.7 1.7 1.7" clip-rule="evenodd"></path></svg>`,
        archive: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" class="chud-btn-icon"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`,
        externalArchive: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" class="chud-btn-icon"><path d="M14 3h7v7h-1.6V5.73l-6.65 6.65-1.13-1.13 6.65-6.65H14z"></path><path d="M5 5h6v1.6H5.6v11.8h11.8V13H19v6c0 .55-.45 1-1 1H5c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1z"></path><path d="M7.2 15.5l2.1-2.7 1.6 1.9 2.2-2.8 3 4H7.2z"></path></svg>`,
        start: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" class="chud-btn-icon"><path d="M4.2 4.8c0-.72.58-1.3 1.3-1.3h13c.72 0 1.3.58 1.3 1.3v10.4c0 .72-.58 1.3-1.3 1.3h-4.55l-3.6 3.15a.75.75 0 0 1-1.24-.56V16.5H5.5c-.72 0-1.3-.58-1.3-1.3zm1.6.3v9.8h4.91v2.7l2.64-2.7h4.85V5.1z"></path><path d="M11.2 7.5h1.6v2.1h2.1v1.6h-2.1v2.1h-1.6v-2.1H9.1V9.6h2.1z"></path></svg>`,
        lore: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="chud-btn-icon chud-lore-icon" aria-hidden="true"><path d="M3.5 5.65c2.72-.78 5.48-.28 8 1.5v11.7c-2.52-1.78-5.28-2.28-8-1.5z"></path><path d="M20.5 5.65c-2.72-.78-5.48-.28-8 1.5v11.7c2.52-1.78 5.28-2.28 8-1.5z"></path><path d="M12 7.15v11.7"></path><path d="m17.7 2.35.38 1.16 1.17.39-1.17.38-.38 1.17-.39-1.17-1.16-.38 1.16-.39z" fill="currentColor" stroke="none"></path></svg>`,
        translator: `<svg width="15.5" height="15.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chud-btn-icon chud-translator-icon" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"></rect><path d="M8 16.5 12 7.5l4 9"></path><path d="M9.6 13.4h4.8"></path></svg>`,
        aiSummary: `<svg width="15.5" height="15.5" viewBox="0 0 24 24" fill="currentColor" class="chud-btn-icon chud-ai-summary-icon" aria-hidden="true"><path d="M4.2 4.75c0-.72.58-1.3 1.3-1.3h13c.72 0 1.3.58 1.3 1.3v11.9c0 .72-.58 1.3-1.3 1.3h-7.1l-4.04 3.36a.75.75 0 0 1-1.23-.58v-2.78H5.5c-.72 0-1.3-.58-1.3-1.3zm1.6.3v11.3h1.93v2.37l3.08-2.37H18.2V5.05z"></path><path d="M12.34 6.72l.82 2.55 2.58.81-2.58.82-.82 2.55-.82-2.55-2.58-.82 2.58-.81z"></path><path d="M8 13.95h5.2v1.45H8zM8 7.95h1.9V9.4H8z"></path></svg>`,
        aiWriter: `<svg width="15.5" height="15.5" viewBox="0 0 24 24" fill="currentColor" class="chud-btn-icon chud-ai-writer-icon" aria-hidden="true"><path d="M4.55 18.25 3.7 21l2.75-.85 9.7-9.7-1.9-1.9z"></path><path d="M15.15 7.65l1.2-1.2c.5-.5 1.3-.5 1.8 0l.4.4c.5.5.5 1.3 0 1.8l-1.2 1.2z"></path><path d="M7.1 5.05h7.2v1.45H7.1zm0 3.1h4.5V9.6H7.1zm0 3.1h3.15v1.45H7.1z" opacity=".68"></path><path d="M18.1 13.25l.55 1.7 1.72.55-1.72.55-.55 1.7-.55-1.7-1.72-.55 1.72-.55zm-12-9.2.42 1.28 1.3.42-1.3.42-.42 1.28-.42-1.28-1.3-.42 1.3-.42z"></path></svg>`,
        gameHud: `<svg width="15.5" height="15.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="chud-btn-icon chud-game-hud-icon" aria-hidden="true"><path d="M7.2 7.6h9.6c2.15 0 3.62 1.42 4.12 4l.7 3.62c.36 1.88-.54 3.18-1.9 3.18-.8 0-1.5-.38-2.08-1.06l-1.24-1.44H7.6l-1.24 1.44c-.58.68-1.28 1.06-2.08 1.06-1.36 0-2.26-1.3-1.9-3.18l.7-3.62c.5-2.58 1.97-4 4.12-4z"></path><path d="M7.2 10.2v3.6M5.4 12h3.6"></path><circle cx="16.25" cy="10.9" r=".82" fill="currentColor" stroke="none"></circle><circle cx="18.2" cy="13.05" r=".82" fill="currentColor" stroke="none"></circle></svg>`,
        roomBackground: `<svg width="15.5" height="15.5" viewBox="0 0 24 24" fill="currentColor" class="chud-btn-icon chud-room-bg-icon" aria-hidden="true"><path d="M4.2 4.2c0-.88.72-1.6 1.6-1.6h12.4c.88 0 1.6.72 1.6 1.6v15.6c0 .88-.72 1.6-1.6 1.6H5.8c-.88 0-1.6-.72-1.6-1.6zm1.6 0v15.6h12.4V4.2z"></path><path d="M7.4 16.7 10.2 13l2 2.35 2.7-3.45 2.1 4.8z"></path><circle cx="9.1" cy="8.1" r="1.45"></circle></svg>`,
        scenePainter: `<svg width="15.5" height="15.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="chud-btn-icon chud-scene-painter-icon" aria-hidden="true"><path d="M14.7 4.2 19.8 9.3"></path><path d="m13.5 5.4 5.1 5.1-8.35 8.35-5.95 1.2 1.2-5.95z"></path><path d="m5.5 14.1 4.4 4.4"></path><path d="M15.8 3.1c.74-.74 1.94-.74 2.68 0l2.42 2.42c.74.74.74 1.94 0 2.68l-2.3 2.3-5.1-5.1z"></path></svg>`,
        wishManager: `<svg width="15.5" height="15.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="chud-btn-icon chud-wish-manager-icon" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg>`,
        sceneBlur: `<svg width="15.5" height="15.5" viewBox="0 0 24 24" fill="currentColor" class="chud-btn-icon chud-scene-blur-icon" aria-hidden="true"><path d="M4.2 4.2c0-.88.72-1.6 1.6-1.6h12.4c.88 0 1.6.72 1.6 1.6v15.6c0 .88-.72 1.6-1.6 1.6H5.8c-.88 0-1.6-.72-1.6-1.6zm1.6 0v15.6h12.4V4.2z"></path><path d="M8.1 8.2h7.8v1.45H8.1zm0 3.05h7.8v1.45H8.1zm0 3.05h4.6v1.45H8.1z" opacity=".65"></path><path d="M17.4 13.1c1.52 1.44 2.35 2.67 2.35 3.74a2.35 2.35 0 1 1-4.7 0c0-1.07.83-2.3 2.35-3.74"></path></svg>`
    };

    function extractFirstPathD(svg) {
        const m = svg.match(/<path\b[^>]*?\bd="([^"]+)"/);
        return m ? m[1] : null;
    }
    const ICON_PATHS = {
        guide: extractFirstPathD(ICON.guide),
        profile: extractFirstPathD(ICON.profile),
        note: extractFirstPathD(ICON.note),
        summary: extractFirstPathD(ICON.summary)
    };

    function isTranslatorInstalled() {
        // 초월 번역기는 내부 함수를 노출하지 않으므로, 생성되는 고유 DOM만 가볍게 확인한다.
        return !!(
            document.getElementById('trans-setting-panel') ||
            document.getElementById('trans-menu-btn') ||
            document.querySelector('.trans-bubble-btn')
        );
    }

    function getTranslatorSettingsTrigger(visibleOnly = true) {
        const direct = document.getElementById('trans-menu-btn');
        if (direct && (!visibleOnly || isVisibleClickable(direct))) return direct;

        const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], div, span'));
        for (const el of candidates) {
            if (!el || isOwnEl(el)) continue;
            if (el.id === 'trans-setting-panel' || el.closest?.('#trans-setting-panel, #trans-result-modal, #trans-nudge')) continue;
            const text = norm(el.textContent);
            if (!text.includes('초월 번역 설정')) continue;
            const clickable = el.closest('button, [role="button"], #trans-menu-btn') || el;
            if (!visibleOnly || isVisibleClickable(clickable)) return clickable;
        }
        return null;
    }

    function openTranslatorSettingsDirectly() {
        const panel = document.getElementById('trans-setting-panel');
        if (!panel) return false;
        panel.style.display = 'block';

        // 초월 번역기 내부 syncTranslatorTheme()는 IIFE 안쪽이라 직접 부르지 못한다.
        // 대신 기존 테마 클래스만 최대한 맞춰서 모달이 어긋나지 않게 한다.
        const site = `${document.documentElement.className} ${document.body.className} ${document.documentElement.dataset.theme || ''} ${document.body.dataset.theme || ''}`.toLowerCase();
        const dark = /\b(dark|theme-dark)\b/.test(site) || (!/\b(light|theme-light)\b/.test(site) && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
        for (const id of ['trans-setting-panel', 'trans-result-modal', 'trans-result-overlay', 'trans-nudge']) {
            const el = document.getElementById(id);
            if (!el) continue;
            el.classList.toggle('trans-theme-dark', !!dark);
            el.classList.toggle('trans-theme-light', !dark);
        }
        return true;
    }

    function openTranslatorSettings() {
        const tryOpen = () => {
            const t = getTranslatorSettingsTrigger(true) || getTranslatorSettingsTrigger(false);
            if (t) {
                fireClickSequence(t);
                return true;
            }
            return openTranslatorSettingsDirectly();
        };
        if (tryOpen()) return;

        // 번역기 확프가 document-start에서 늦게 UI를 붙이는 경우를 위해 짧게만 재시도한다.
        const started = Date.now();
        const retry = () => {
            if (tryOpen()) return;
            if (Date.now() - started > 5000) {
                console.warn('[대시보드] 초월 번역기 설정 패널을 찾지 못함');
                return;
            }
            setTimeout(retry, 250);
        };
        retry();
    }

    function getAiSummaryTrigger(visibleOnly = true) {
        // 구버전 헤더 버튼 + 신버전 좌측 사이드바 메뉴를 모두 지원한다.
        // 신버전(요약 메모리 편집 & AI 자동 정리)은 #crack-ext-ai-sidebar-menu만 먼저 생기는 타이밍이 있어
        // 헤더 버튼만 기준으로 설치 여부를 판단하면 대시보드에서 AI 요약 버튼이 숨겨질 수 있다.
        const candidates = Array.from(document.querySelectorAll(
            '.crack-ext-header-ai-btn, #crack-ext-ai-sidebar-menu [role="button"], #crack-ext-ai-sidebar-menu, button[data-ce-ai-summary="true"], button'
        ));
        for (const el of candidates) {
            if (!el || !el.isConnected || isOwnEl(el)) continue;
            if (el.closest?.('.crack-ext-ai-modal, .crack-ext-ai-overlay, #chud-sidebar, #chud-side-menu, #chud-side-dropdown')) continue;
            const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
            const isSidebarEntry = el.id === 'crack-ext-ai-sidebar-menu' || !!el.closest?.('#crack-ext-ai-sidebar-menu');
            const isTarget = isSidebarEntry
                || el.classList?.contains('crack-ext-header-ai-btn')
                || el.dataset?.ceAiSummary === 'true'
                || /AI\s*요약(?:\s*[·/]?\s*메모리)?/.test(text);
            if (!isTarget) continue;
            if (visibleOnly && !isVisibleClickable(el)) continue;
            return el;
        }
        return null;
    }

    function isAiSummaryInstalled() {
        return !!getAiSummaryTrigger(false);
    }

    function openAiSummary() {
        const tryOpen = () => {
            const t = getAiSummaryTrigger(true) || getAiSummaryTrigger(false);
            if (t) {
                fireClickSequence(t);
                return true;
            }
            return false;
        };
        if (tryOpen()) return;

        // AI 요약 확프도 헤더 버튼을 route-burst로 늦게 붙이므로, 클릭 시 짧게만 기다린다.
        const started = Date.now();
        const retry = () => {
            if (tryOpen()) return;
            if (Date.now() - started > 5000) {
                alert('AI 요약 확장프로그램 버튼을 찾지 못했습니다. AI 요약 확프가 켜져 있는지 확인해주세요.');
                return;
            }
            setTimeout(retry, 250);
        };
        retry();
    }

    function getAiWriterPanel() {
        return document.getElementById('crack-ai-panel');
    }

    function getAiWriterSettingsButton(visibleOnly = true) {
        const direct = document.getElementById('crack-pure-settings-btn');
        if (direct && (!visibleOnly || isVisibleClickable(direct))) return direct;

        const candidates = Array.from(document.querySelectorAll('button.crack-pure-settings, button'));
        for (const el of candidates) {
            if (!el || !el.isConnected || isOwnEl(el)) continue;
            if (el.closest?.('#crack-ai-panel, #chud-sidebar, #chud-side-menu, #chud-side-dropdown')) continue;
            const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
            const isTarget = el.id === 'crack-pure-settings-btn' || el.classList?.contains('crack-pure-settings') || /AI\s*설정|AI\s*집필/.test(text);
            if (!isTarget) continue;
            if (visibleOnly && !isVisibleClickable(el)) continue;
            return el;
        }
        return null;
    }

    function isAiWriterInstalled() {
        return !!(
            getAiWriterPanel() ||
            document.getElementById('crack-pure-settings-btn') ||
            document.getElementById('crack-pure-magic-btn') ||
            document.getElementById('crack-pure-send-left-group')
        );
    }

    function openAiWriterSettingsDirectly() {
        const panel = getAiWriterPanel();
        if (!panel) return false;
        panel.style.display = 'flex';
        return true;
    }

    function openAiWriterSettings() {
        const tryOpen = () => {
            const panel = getAiWriterPanel();
            if (panel && getComputedStyle(panel).display !== 'none') {
                panel.style.display = 'flex';
                return true;
            }

            const t = getAiWriterSettingsButton(true) || getAiWriterSettingsButton(false);
            if (t) {
                fireClickSequence(t);
                const openedPanel = getAiWriterPanel();
                if (openedPanel && getComputedStyle(openedPanel).display === 'none') openedPanel.style.display = 'flex';
                return true;
            }
            return openAiWriterSettingsDirectly();
        };
        if (tryOpen()) return;

        const started = Date.now();
        const retry = () => {
            if (tryOpen()) return;
            if (Date.now() - started > 5000) {
                alert('AI 답변 확장프로그램 버튼을 찾지 못했습니다. AI 답변 확프가 켜져 있는지 확인해주세요.');
                return;
            }
            setTimeout(retry, 250);
        };
        retry();
    }

    function getGameHudTrigger() {
        const dock = document.getElementById('cigh-clean-dock-fab');
        if (dock?.isConnected) return { el: dock, mode: 'dock' };

        const fab = document.getElementById('cigh-clean-fab');
        if (fab?.isConnected) return { el: fab, mode: 'fab' };

        return null;
    }

    function isGameHudInstalled() {
        return !!(
            document.getElementById('cigh-clean-fab') ||
            document.getElementById('cigh-clean-dock-fab') ||
            document.getElementById('cigh-clean-panel')
        );
    }

    function fireGameHudFabPointer(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const clientX = r.left + Math.max(1, r.width / 2);
        const clientY = r.top + Math.max(1, r.height / 2);
        const base = {
            bubbles: true,
            cancelable: true,
            pointerId: 9876,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            clientX,
            clientY
        };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }));
        el.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
        return true;
    }

    function openGameHud() {
        const tryOpen = () => {
            const target = getGameHudTrigger();
            if (!target) return false;

            // 헤더 도킹 버튼은 click, 기본 떠다니는 ◆ 버튼은 pointerup에서 패널을 연다.
            if (target.mode === 'dock') target.el.click();
            else fireGameHudFabPointer(target.el);
            return true;
        };
        if (tryOpen()) return;

        const started = Date.now();
        const retry = () => {
            if (tryOpen()) return;
            if (Date.now() - started > 5000) {
                alert('게임 HUD 버튼을 찾지 못했습니다. INFO Game HUD 확프가 켜져 있는지 확인해주세요.');
                return;
            }
            setTimeout(retry, 250);
        };
        retry();
    }

    function getScenePainterTrigger(visibleOnly = true) {
        const row = document.getElementById('csp-scene-painter-row');
        if (!row) return null;
        const trigger = row.querySelector('[role="button"]') || row;
        if (trigger && (!visibleOnly || isVisibleClickable(trigger))) return trigger;
        return null;
    }

    function hasScenePainterDashboardBridge() {
        return document.documentElement?.getAttribute('data-csp-dashboard-bridge') === '1';
    }

    function isScenePainterInstalled() {
        return hasScenePainterDashboardBridge()
            || !!document.getElementById('csp-scene-painter-row')
            || !!document.getElementById('csp-v35-root');
    }

    function openScenePainterSettings() {
        const tryOpen = () => {
            // 최신 Scene Painter는 userscript 샌드박스끼리 직접 함수를 공유하지 않고
            // DOM 이벤트 브리지로 설정창을 연다. 메뉴를 미리 열 필요가 없다.
            if (hasScenePainterDashboardBridge()) {
                document.dispatchEvent(new CustomEvent('csp:dashboard-open-settings'));
                return true;
            }

            // 구버전 폴백: 우측 설정 메뉴에 삽화 행이 이미 주입돼 있으면 그 행을 누른다.
            const trigger = getScenePainterTrigger(true) || getScenePainterTrigger(false);
            if (trigger) {
                fireClickSequence(trigger);
                return true;
            }
            return false;
        };
        if (tryOpen()) return;

        const started = Date.now();
        const retry = () => {
            if (tryOpen()) return;
            if (Date.now() - started > 5000) {
                alert('Scene Painter 설정을 찾지 못했습니다. 삽화 확프가 켜져 있는지 확인해주세요.');
                return;
            }
            setTimeout(retry, 250);
        };
        retry();
    }

    function getWishRpManagerTrigger(visibleOnly = true) {
        const trigger = document.getElementById('wish-rp-toolbar-launcher');
        if (trigger && (!visibleOnly || isVisibleClickable(trigger))) return trigger;
        return null;
    }

    function isWishRpManagerInstalled() {
        // Wish v1.7.9의 고유 런처/모달 DOM만 확인한다. Wish 원본 코드는 수정하지 않는다.
        return !!document.getElementById('wish-rp-toolbar-launcher')
            || !!document.getElementById('rpcm-overlay');
    }

    function openWishRpManager() {
        const tryOpen = () => {
            // 이미 Manager가 열려 있으면 그대로 둔다.
            if (document.getElementById('rpcm-overlay')) return true;
            const trigger = getWishRpManagerTrigger(true) || getWishRpManagerTrigger(false);
            if (!trigger) return false;
            fireClickSequence(trigger);
            return true;
        };
        if (tryOpen()) return;

        const started = Date.now();
        const retry = () => {
            if (tryOpen()) return;
            if (Date.now() - started > 5000) {
                alert('Wish RP Manager 버튼을 찾지 못했습니다. Wish RP Manager 확프가 켜져 있는지 확인해주세요.');
                return;
            }
            setTimeout(retry, 250);
        };
        retry();
    }

    let profileBoxSeen = false;
    function getProfileBoxTrigger() {
        return document.getElementById('cpm-launcher')
            || document.getElementById('cpm-embedded-launcher')
            || document.querySelector('[data-cpm-profile-fallback="true"]')
            || document.querySelector('.cpm-external-profile-launcher:not(#chud-profile-box-btn)');
    }
    function isProfileBoxInstalled() {
        let hooked = false;
        try {
            const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
            hooked = !!(w.__CPM_NETWORK_HOOKED__ || w.__CPM_XHR_HOOKED__ || window.__CPM_NETWORK_HOOKED__ || window.__CPM_XHR_HOOKED__);
        } catch (e) {}
        const detected = hooked || !!document.getElementById('cpm-root') || !!getProfileBoxTrigger();
        if (detected) profileBoxSeen = true;
        return detected || profileBoxSeen;
    }
    function openProfileBox() {
        const tryOpen = () => {
            if (document.getElementById('cpm-root')) return true;
            const trigger = getProfileBoxTrigger();
            if (!trigger) return false;
            fireClickSequence(trigger);
            return true;
        };
        if (tryOpen()) return;
        const started = Date.now();
        const retry = () => {
            if (tryOpen()) return;
            if (Date.now() - started > 5000) {
                alert('프로필 박스 버튼을 찾지 못했습니다. 프로필 박스 확프가 켜져 있는지 확인해주세요.');
                return;
            }
            setTimeout(retry, 250);
        };
        setTimeout(retry, 250);
    }

    function getCustomRoomBackgroundApi() {
        try {
            const w = getLoreWindow();
            return w.CrackCustomRoomBackground || w.SGBDirectBackground || window.CrackCustomRoomBackground || window.SGBDirectBackground || null;
        } catch (e) { return null; }
    }

    function getScenePainterBackgroundApi() {
        try {
            const w = getLoreWindow();
            return w.CSPGeneratedBackgroundBlur || window.CSPGeneratedBackgroundBlur || null;
        } catch (e) { return null; }
    }

    function isCustomRoomBackgroundInstalled() {
        const api = getCustomRoomBackgroundApi();
        if (api && typeof api.openSettings === 'function') return true;
        try {
            const w = getLoreWindow();
            return !!(w.__SGB_CUSTOM_ROOM_BG_110_THEMES_LOADED__ || window.__SGB_CUSTOM_ROOM_BG_110_THEMES_LOADED__);
        } catch (e) { return false; }
    }

    function isScenePainterBackgroundInstalled() {
        const api = getScenePainterBackgroundApi();
        if (api && typeof api.openSettings === 'function') return true;
        try {
            const w = getLoreWindow();
            return !!(w.__SGB_BACKGROUND_LAYER_0950_BORDERLESS_LOADED__ || w.__SGB_BACKGROUND_LAYER_0949_DIALOGUE_BRACKETS_QUOTES_LOADED__ || window.__SGB_BACKGROUND_LAYER_0950_BORDERLESS_LOADED__ || window.__SGB_BACKGROUND_LAYER_0949_DIALOGUE_BRACKETS_QUOTES_LOADED__);
        } catch (e) { return false; }
    }

    function clearSharedSgbSettingsModal() {
        // 두 배경 확프가 같은 설정 modal id를 쓰므로, 특정 확프 설정을 열 때는 기존 공유 modal을 제거해 섞임을 줄인다.
        const modal = document.getElementById('sgb-bg-settings-modal');
        if (modal && !isOwnEl(modal)) modal.remove();
    }

    function openSharedSgbSettingsRowFallback() {
        const row = document.querySelector('#sgb-bg-settings-row [data-sgb-settings-open], [data-sgb-settings-row] [data-sgb-settings-open]');
        if (row && isVisibleClickable(row)) {
            fireClickSequence(row);
            return true;
        }
        const modal = document.getElementById('sgb-bg-settings-modal');
        if (modal) {
            modal.setAttribute('data-open', 'true');
            return true;
        }
        return false;
    }

    function openCustomRoomBackgroundSettings() {
        const tryOpen = () => {
            const api = getCustomRoomBackgroundApi();
            if (api && typeof api.openSettings === 'function') {
                clearSharedSgbSettingsModal();
                api.openSettings();
                return true;
            }
            return openSharedSgbSettingsRowFallback();
        };
        if (tryOpen()) return;

        const started = Date.now();
        const retry = () => {
            if (tryOpen()) return;
            if (Date.now() - started > 5000) {
                alert('직접 방 이미지 배경 확프 설정을 찾지 못했습니다. 확프가 켜져 있는지 확인해주세요.');
                return;
            }
            setTimeout(retry, 250);
        };
        retry();
    }

    function openScenePainterBackgroundSettings() {
        const tryOpen = () => {
            const api = getScenePainterBackgroundApi();
            if (api && typeof api.openSettings === 'function') {
                clearSharedSgbSettingsModal();
                api.openSettings();
                return true;
            }
            return openSharedSgbSettingsRowFallback();
        };
        if (tryOpen()) return;

        const started = Date.now();
        const retry = () => {
            if (tryOpen()) return;
            if (Date.now() - started > 5000) {
                alert('Scene Painter 배경 블러 확프 설정을 찾지 못했습니다. 확프가 켜져 있는지 확인해주세요.');
                return;
            }
            setTimeout(retry, 250);
        };
        retry();
    }

    /* =========================================================
     * 5. 스타일
     * =======================================================*/
    /* 모델 숨기기용 아이콘 · 스타일 (기존 ICON / injectStyle 과 분리해서 관리) */
    const MODEL_HIDE_ICON = {
        eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"></path><circle cx="12" cy="12" r="2.6"></circle></svg>`,
        eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"></path><circle cx="12" cy="12" r="2.6"></circle><path d="M4 4 20 20"></path></svg>`,
        edit: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.6 18.4 3.9 21l2.6-.7 9.1-9.1-1.9-1.9zM15.6 8.1l1.1-1.1c.5-.5 1.3-.5 1.8 0l.5.5c.5.5.5 1.3 0 1.8l-1.1 1.1z"></path></svg>`,
        done: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="m19.27 7.21-9.05 9.76-5.76-6.24 1.18-1.08 4.58 4.96 7.87-8.48z"></path></svg>`
    };

    function injectModelHideStyle() {
        if (document.getElementById('chud-model-hide-style')) return;
        const s = document.createElement('style');
        s.id = 'chud-model-hide-style';
        s.textContent = `
            [data-chud-model-hidden="true"] { display: none !important; }
            [role="dialog"][data-chud-model-compact="true"] {
                height: auto !important;
                min-height: 0 !important;
                max-height: min(569px, var(--radix-popover-content-available-height, calc(100dvh - 24px))) !important;
                overflow-y: auto;
            }
            .chud-model-item.is-hidden-model { opacity: .46; }
            .chud-model-item.is-hidden-model:hover { opacity: .8; }
            .chud-eye-icon { flex: 0 0 auto; width: 16px; height: 16px; display: block; opacity: .85; }
            .chud-eye-icon svg { width: 16px; height: 16px; display: block; }

            .chud-model-toolrow {
                display: flex; align-items: center; gap: 5px;
                width: 100%; box-sizing: border-box; padding: 6px;
                border-radius: 7px; cursor: pointer; user-select: none;
                touch-action: manipulation; white-space: nowrap;
                font-size: 12px; font-weight: 600; opacity: .7;
            }
            .chud-model-toolrow:hover { background: var(--chud-item-hover-bg, #f3f4f6); opacity: 1; }
            .chud-model-toolrow svg { width: 13px; height: 13px; flex: 0 0 auto; display: block; }
            .chud-model-item + .chud-model-toolrow {
                margin-top: 4px; padding-top: 7px;
                border-top: 1px solid rgba(128,128,128,.24);
            }
        `;
        (document.head || document.documentElement).appendChild(s);
    }

    function loadHiddenModels() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE.hiddenModels) || '[]');
            return new Set(Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : []);
        } catch (e) { return new Set(); }
    }

    function saveHiddenModels(set) {
        try { localStorage.setItem(STORAGE.hiddenModels, JSON.stringify(Array.from(set || []))); } catch (e) {}
        applyOfficialModelVisibility(set);
        Core.emit('model-visibility', set);
    }

    function injectStyle() {
        if (document.getElementById('chud-base-style')) return;
        const s = document.createElement('style');
        s.id = 'chud-base-style';
        s.textContent = `
            /* 공통 바 컨테이너 */
            #chud-infobar, #chud-sidebar {
                position: absolute; left: 0; right: 0; box-sizing: border-box;
                font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 13px; font-weight: 500; pointer-events: none;
                display: flex; align-items: center; border-radius: 8px 8px 0 0;
                padding-right: 12px; transform-origin: top left;
                will-change: transform, clip-path;
            }
            #chud-sidebar { z-index: 2; padding-top: 3px; padding-bottom: 0; }
            #chud-infobar { z-index: 1; padding-top: 2px; padding-bottom: 2px; }

            /* 설정(톱니) 버튼 공통 */
            .chud-settings-button { all: unset; position: relative; pointer-events: auto; cursor: pointer;
                display: inline-flex; align-items: center; justify-content: center;
                margin-left: auto; margin-right: 8px; transition: opacity .15s; touch-action: manipulation; color: inherit; }
            .chud-settings-button::after { content: ''; position: absolute; top: -10px; bottom: -10px; left: -8px; right: -4px; }
            .chud-settings-button:hover { opacity: .7; }
            .chud-settings-icon { display: block; flex-shrink: 0; }

            /* InfoBar 본문 */
            #chud-info-text { display: flex; align-items: center; gap: 0; flex: 1 1 auto; min-width: 0; overflow: hidden; }
            .chud-part { all: unset; display: inline-flex; align-items: center; pointer-events: auto;
                border-radius: 4px; padding: 1px 2px; touch-action: manipulation; user-select: none;
                transition: background .15s; cursor: pointer; }
            .chud-sep { opacity: .45; margin: 0 3px; pointer-events: none; user-select: none; }
            .chud-small-icon { margin-right: 5px; flex-shrink: 0; }
            .chud-cracker-icon { margin: 0 4px 0 0; flex-shrink: 0; }
            @keyframes chud-pulse { 0%{opacity:.5;filter:drop-shadow(0 0 1px currentColor);} 50%{opacity:1;filter:drop-shadow(0 0 5px currentColor);} 100%{opacity:.5;filter:drop-shadow(0 0 1px currentColor);} }
            .chud-pulse { animation: chud-pulse 1s infinite ease-in-out; }
            .chud-action-btn:active, .chud-settings-button:active { transform: scale(.86); }
            @keyframes chud-heart-beat { 0%,100% { transform: scale(1); } 30% { transform: scale(1.22); } 55% { transform: scale(.95); } 75% { transform: scale(1.1); } }
            #chud-wish-manager-btn:hover .chud-wish-manager-icon { animation: chud-heart-beat .7s ease-in-out; }
            @media (prefers-reduced-motion: reduce) {
                .chud-action-btn:active, .chud-settings-button:active { transform: none; }
                #chud-wish-manager-btn:hover .chud-wish-manager-icon { animation: none; }
            }

            /* Sidebar 본문 */
            #chud-side-content { display: flex; align-items: center; overflow: hidden; white-space: nowrap; flex: 1 1 auto; min-width: 0; max-width: calc(100vw - 120px); }
            .chud-action-btn { all: unset; position: relative; pointer-events: auto; cursor: pointer; margin-left: 7px;
                display: inline-flex; align-items: center; justify-content: center; padding: 0;
                width: 20px; height: 20px; min-width: 20px; min-height: 20px; flex: 0 0 20px; box-sizing: border-box; line-height: 0;
                font-weight: 700; transition: color .15s, opacity .15s, transform .15s; touch-action: manipulation;
                background: transparent !important; border: 0 !important; box-shadow: none !important; outline: 0; color: inherit; }
            #chud-model-btn { margin-left: 0; }
            .chud-action-btn:hover { background: transparent !important; color: var(--chud-side-hover-text, currentColor); opacity: .95; }
            .chud-action-btn.is-active { background: transparent !important; color: var(--chud-side-active-text, currentColor); }
            .chud-action-btn.is-active:hover { background: transparent !important; color: var(--chud-side-active-text, currentColor); }
            .chud-btn-icon { flex: 0 0 auto; display: block; width: 16.5px; height: 16.5px; pointer-events: none; }
            .chud-lore-icon { width: 17px; height: 17px; transform: scale(1.04); transform-origin: center; }
            .chud-translator-icon { width: 16.5px; height: 16.5px; transform-origin: center; }
            .chud-ai-summary-icon { width: 16.5px; height: 16.5px; transform-origin: center; }
            .chud-ai-writer-icon { width: 16.5px; height: 16.5px; transform-origin: center; }

            /* 드롭다운 / 설정 메뉴 공통 */
            #chud-side-dropdown, #chud-side-menu, #chud-info-menu {
                display: none; position: fixed; border-radius: 8px; padding: 6px; flex-direction: column; gap: 2px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.3); z-index: 45; max-width: calc(100vw - 16px);
                border-style: solid; border-width: 1px; font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
            }
            #chud-side-dropdown {
                width: min(200px, calc(100vw - 16px)); box-sizing: border-box; max-height: 360px;
                overflow-y: auto; overflow-x: hidden; padding: 4px;
            }
            #chud-side-menu, #chud-info-menu { padding: 4px; gap: 1px; min-width: 132px; font-size: 13px; align-items: flex-start; }
            #chud-side-menu { max-height: none; overflow: visible; box-sizing: border-box; }

            .chud-menu-title { font-size: 12px; font-weight: 700; opacity: .7; padding: 0 4px 2px; white-space: nowrap; }
            .chud-menu-action { display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box; padding: 5px 6px; border-radius: 5px; cursor: pointer; user-select: none; touch-action: manipulation; white-space: nowrap; font-weight: 600; }
            .chud-menu-action:hover { background: rgba(128,128,128,0.16); }
            .chud-menu-action svg { width: 13px; height: 13px; flex: 0 0 auto; display: block; }
            .chud-menu-action + .chud-menu-title { width: 100%; box-sizing: border-box; margin-top: 2px; padding-top: 6px; border-top: 1px solid rgba(128,128,128,.24); }
            .chud-menu-row { display: flex; align-items: center; gap: 6px; padding: 2px 6px; border-radius: 5px; cursor: pointer; user-select: none; touch-action: manipulation; white-space: nowrap; }
            .chud-menu-row:hover { background: rgba(128,128,128,0.16); }
            .chud-menu-row input { margin: 0; cursor: pointer; }
            :is(#chud-side-menu, #chud-info-menu) .chud-menu-row { position: relative; width: 100%; box-sizing: border-box; gap: 8px; padding: 4px 6px; }
            :is(#chud-side-menu, #chud-info-menu) .chud-menu-row input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; pointer-events: none; }
            :is(#chud-side-menu, #chud-info-menu) .chud-menu-row .chud-btn-icon { width: 15px; height: 15px; transform: none; opacity: .85; transition: opacity .15s; }
            :is(#chud-side-menu, #chud-info-menu) .chud-menu-row span { flex: 1 1 auto; transition: opacity .15s; }
            :is(#chud-side-menu, #chud-info-menu) .chud-sw { flex: 0 0 26px; width: 26px; height: 15px; margin-left: 8px; position: relative; box-sizing: border-box; border-radius: 9px; border: 1.5px solid rgba(128,128,128,.45); transition: border-color .18s, background .18s; }
            :is(#chud-side-menu, #chud-info-menu) .chud-sw::after { content: ''; position: absolute; top: 1.5px; left: 1.5px; width: 9px; height: 9px; border-radius: 50%; background: rgba(128,128,128,.6); transition: transform .18s ease, background .18s; }
            :is(#chud-side-menu, #chud-info-menu) .chud-menu-row input:checked ~ .chud-sw { border-color: currentColor; background: rgba(128,128,128,.18); }
            :is(#chud-side-menu, #chud-info-menu) .chud-menu-row input:checked ~ .chud-sw::after { transform: translateX(11px); background: currentColor; }
            :is(#chud-side-menu, #chud-info-menu) .chud-menu-row input:not(:checked) ~ .chud-btn-icon,
            :is(#chud-side-menu, #chud-info-menu) .chud-menu-row input:not(:checked) ~ span { opacity: .45; }
            :is(#chud-side-menu, #chud-info-menu) .chud-menu-row input:focus-visible ~ .chud-sw { outline: 2px solid currentColor; outline-offset: 1px; }

            .chud-model-item {
                all: unset; display: flex; align-items: center; justify-content: space-between; gap: 6px;
                width: 100%; box-sizing: border-box; padding: 7px 6px; border-radius: 7px; cursor: pointer;
                font-size: 13px; line-height: 1.2; touch-action: manipulation; user-select: none;
                background: transparent; color: inherit; transition: background .15s, color .15s;
            }
            .chud-model-item:hover { background: var(--chud-item-hover-bg, #f3f4f6); color: var(--chud-item-hover-text, #000); }
            .chud-model-item.is-selected { color: var(--chud-selected-text, var(--chud-item-hover-text, #000)); }
            .chud-model-item.is-selected:hover { background: var(--chud-item-hover-bg, #f3f4f6); }
            .chud-model-body { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 0; }
            .chud-model-title { display: flex; align-items: center; min-width: 0; gap: 4px; }
            .chud-model-icon { display: block; flex-shrink: 0; width: 16px; height: 16px; object-fit: contain; }
            .chud-model-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
            .chud-cost-badge {
                display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
                height: 15px; padding: 0 4px; border-radius: 4px; border: 1px solid var(--chud-cost-border, rgba(128,128,128,.32));
                background: var(--chud-cost-bg, rgba(128,128,128,.08)); color: var(--chud-cost-text, #999);
                font-size: 10px; line-height: 1; font-weight: 600;
            }
            .chud-rec-badge {
                display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
                height: 15px; padding: 0 4px; border-radius: 4px; font-size: 10px; line-height: 1; font-weight: 700;
                background: var(--chud-rec-bg, rgba(128,128,128,.12)); color: var(--chud-rec-text, currentColor);
            }
            .chud-model-desc { display: none; }
            .chud-check-icon {
                flex: 0 0 auto; width: 16px; height: 16px; color: var(--chud-check-text, currentColor);
                opacity: 0; transform: scale(.86); transition: opacity .12s, transform .12s;
            }
            .chud-model-item.is-selected .chud-check-icon { opacity: 1; transform: scale(1); }

            @media (max-width: 520px) {
                #chud-infobar, #chud-sidebar { font-size: 12px; }
                .chud-action-btn { padding: 0; margin-left: 5px; width: 20px; height: 20px; min-width: 20px; min-height: 20px; flex-basis: 20px; }
                #chud-side-dropdown { width: min(196px, calc(100vw - 16px)); max-height: 320px; }
                .chud-sep { margin: 0 2px; }
                .chud-part { padding: 1px; }
            }
        `;
        document.head.appendChild(s);
    }

    /* =========================================================
     * 6. 사이드바 액션 (공식 DOM 버튼 대리 클릭)
     * =======================================================*/
    function openDialogBySpanText(textStart) {
        for (const span of document.querySelectorAll('span')) {
            const text = span.textContent.trim();
            if (!text.startsWith(textStart)) continue;
            if (isOwnEl(span) || span.closest('[role="dialog"]')) continue;
            const btn = span.closest('button') || span.closest('[role="button"]');
            if (btn && isVisibleClickable(btn)) { fireClickSequence(btn); return true; }
        }
        for (const btn of document.querySelectorAll('button, [role="button"]')) {
            if (isOwnEl(btn) || btn.closest('[role="dialog"]')) continue;
            if (!(btn.innerText || btn.textContent || '').includes(textStart)) continue;
            if (isVisibleClickable(btn)) { fireClickSequence(btn); return true; }
        }
        return false;
    }

    function openDialogByIconPath(pathData, fallbackText) {
        if (pathData) {
            for (const p of document.querySelectorAll('path')) {
                if (p.getAttribute('d') !== pathData) continue;
                const btn = p.closest('button') || p.closest('[role="button"]');
                if (!btn || isOwnEl(btn) || btn.closest('[role="dialog"]')) continue;
                if (isVisibleClickable(btn)) { fireClickSequence(btn); return true; }
            }
        }
        return openDialogBySpanText(fallbackText);
    }

    function openOutputDialog() {
        const open = Array.from(document.querySelectorAll('[role="dialog"][data-state="open"]')).some((el) => el.querySelector('h2')?.textContent?.trim() === '답변 길이 및 생각 조절');
        if (open) return;
        const trigger = document.getElementById('max-output-modal-menu-button');
        if (trigger) fireClickSequence(trigger);
        else openDialogBySpanText('최대 출력량');
    }

    function getContextImageSwitch() {
        for (const span of document.querySelectorAll('span')) {
            if (span.textContent.trim() === '상황 이미지 보기') {
                const btn = span.closest('[role="button"]')?.querySelector('button[role="switch"]');
                if (btn) return btn;
            }
        }
        return null;
    }
    function getImageSwitchState(toggle = getContextImageSwitch()) {
        if (!toggle) return null;
        return toggle.getAttribute('aria-checked') === 'true' || toggle.getAttribute('data-state') === 'checked';
    }
    function toggleContextImage() {
        const t = getContextImageSwitch();
        if (t) { fireClickSequence(t); shared.heavyStale = true; scheduleUpdate(); }
    }

    function getNativeImageArchiveTrigger() {
        const labels = Array.from(document.querySelectorAll('span')).filter((span) => {
            const text = span.textContent.trim();
            if (!text.startsWith('이미지 보관함')) return false;
            if (text.startsWith('외부 이미지 보관함')) return false;
            if (isOwnEl(span) || span.closest('#eic-modal-content') || span.closest('[role="dialog"]')) return false;
            return true;
        });
        for (const l of labels) {
            const btn = l.closest('button') || l.closest('[role="button"]');
            if (btn) return btn;
        }
        return null;
    }
    function openNativeImageArchive() {
        const t = getNativeImageArchiveTrigger();
        if (t) fireClickSequence(t);
    }

    function getExternalImageArchiveTrigger() {
        const wrap = document.getElementById('eic-sidebar-btn-wrapper');
        const direct = wrap?.querySelector('button');
        if (direct) return direct;
        const label = document.getElementById('eic-sidebar-label');
        const lb = label?.closest('button') || label?.closest('[role="button"]');
        if (lb) return lb;
        const fb = Array.from(document.querySelectorAll('span')).find((span) => {
            const text = span.textContent.trim();
            if (!text.startsWith('외부 이미지 보관함')) return false;
            if (isOwnEl(span) || span.closest('#eic-modal-content')) return false;
            return true;
        });
        return fb?.closest('button') || fb?.closest('[role="button"]') || null;
    }
    function openExternalImageArchive() {
        const t = getExternalImageArchiveTrigger();
        if (t) fireClickSequence(t);
    }

    function getLoreWindow() {
        try { if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow; } catch (e) {}
        return window;
    }

    function getLoreState() {
        try { return getLoreWindow().__LoreInj || window.__LoreInj || null; } catch (e) { return null; }
    }

    function isLoreToolsInstalled() {
        const state = getLoreState();
        if (state && (state.__uiLoaded || state.universalBundle || state.chatBootstrapVersion || state.VER)) return true;
        return !!getLoreToolsTrigger(false);
    }

    function getLoreToolsTrigger(visibleOnly = true) {
        const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
        const usable = (el) => !!el && !isOwnEl(el) && (!visibleOnly || isVisibleClickable(el));
        const clickableOf = (el) => el?.closest?.('button, [role="button"], a') || el || null;
        const matchesLore = (el) => {
            const hay = [
                el.textContent,
                el.getAttribute?.('aria-label'),
                el.getAttribute?.('title'),
                el.getAttribute?.('data-tooltip'),
                el.getAttribute?.('data-label')
            ].map(norm).join(' ');
            return hay.includes('Chasm Tools') || hay.includes('결정화 캐즘') || hay.includes('로어 인젝터 열기');
        };

        // 1순위: Universal.24부터 쓰는 공식 Lore 진입 버튼.
        // 헤더·입력창 툴바·고정 폴백 어디에 주입돼도 고유 ID/클래스로 바로 찾는다.
        const entry = document.querySelector('#lore-inj-entry-button, .lore-inj-entry-button, [data-lore-inj-entry="true"]');
        if (usable(entry)) return clickableOf(entry);

        // 2순위: 크랙 설정 모달 안에 복제되는 "결정화 캐즘" 메뉴.
        // 설정 모달이 닫혀 있어도 visibleOnly=false 재시도에서는 onclick을 직접 실행할 수 있다.
        const chasmMenu = document.getElementById('chasm-decentral-menu');
        if (usable(chasmMenu)) return clickableOf(chasmMenu);

        // 3순위: 구버전 LoreInj 배너 고유 클래스.
        const burner = Array.from(document.querySelectorAll('.burner-button, [class*="burner-button"]'))
            .find(usable);
        if (burner) return clickableOf(burner);

        // 4순위: 텍스트뿐 아니라 aria-label/title에 라벨이 있는 클릭 요소도 본다(아이콘 버튼 대응).
        const candidates = document.querySelectorAll('button, [role="button"], a, .burner-button, [class*="burner"]');
        const seen = new Set();
        for (const el of candidates) {
            if (!el || seen.has(el) || isOwnEl(el)) continue;
            seen.add(el);
            if (!matchesLore(el)) continue;
            const clickable = clickableOf(el);
            if (usable(clickable)) return clickable;
        }
        return null;
    }

    function openLoreToolsDirectly() {
        // 에리 확프가 원본 배너 버튼을 아직 못 꽂은 타이밍이면, 가능한 경우 모달 매니저를 직접 호출한다.
        // ModalManager가 외부 window에 노출되지 않는 버전도 있어서 실패해도 조용히 버튼 재시도로 이어간다.
        try {
            const w = getLoreWindow();
            const mm = w.ModalManager || window.ModalManager;
            if (mm && typeof mm.getOrCreateManager === 'function') {
                const modal = mm.getOrCreateManager('c2');
                if (modal && typeof modal.display === 'function') {
                    modal.display(document.body.getAttribute('data-theme') !== 'light');
                    return true;
                }
            }
        } catch (e) {}
        return false;
    }

    function openLoreTools() {
        const tryOpen = () => {
            if (openLoreToolsDirectly()) return true;
            const t = getLoreToolsTrigger(true) || getLoreToolsTrigger(false);
            if (!t) return false;
            fireClickSequence(t);
            return true;
        };
        if (tryOpen()) return;

        // LoreInj:ready가 UI 버튼 주입보다 먼저 끝나는 순간이 있어 1회만 찍고 포기하지 말고 짧게 재시도한다.
        const started = Date.now();
        const retry = () => {
            if (tryOpen()) return;
            if (Date.now() - started > 6000) {
                console.warn('[대시보드] 에리 로어 Chasm Tools 버튼을 찾지 못함');
                return;
            }
            setTimeout(retry, 250);
        };

        const w = getLoreWindow();
        const ready = w.__LoreInjReady;
        if (ready && typeof ready.then === 'function') {
            Promise.race([
                ready.catch(() => null),
                new Promise((resolve) => setTimeout(() => resolve(null), 1500))
            ]).then(retry);
        } else {
            retry();
        }
    }

    function getStartSettingTrigger() {
        const title = Array.from(document.querySelectorAll('p, span')).find((el) => {
            if (isOwnEl(el) || el.closest('[role="dialog"]')) return false;
            return (el.textContent || '').replace(/\s+/g, '').trim() === '시작설정';
        });
        if (title) {
            let next = title.nextElementSibling;
            for (let i = 0; next && i < 6; i++, next = next.nextElementSibling) {
                if (!(next instanceof HTMLElement)) continue;
                const text = (next.textContent || '').replace(/\s+/g, ' ').trim();
                if (text.includes('채팅방 설정') || text.includes('전체 설정') || text.includes('나의 크래커')) break;
                const btn = next.matches('button, [role="button"]') ? next : next.querySelector('button, [role="button"]');
                if (btn && isVisibleClickable(btn)) return btn;
            }
        }
        return Array.from(document.querySelectorAll('button, [role="button"]')).find((btn) => {
            if (isOwnEl(btn) || btn.closest('[role="dialog"]') || !isVisibleClickable(btn)) return false;
            return (btn.textContent || '').replace(/\s+/g, ' ').trim() === '이미지+세계관 질의응답';
        }) || null;
    }
    function openStartSetting() {
        const t = getStartSettingTrigger();
        if (t) { fireClickSequence(t); shared.heavyStale = true; scheduleUpdate(); }
    }

    // 모델 메뉴를 화면에 안 보이게 숨겼다 복구
    function createModelMenuAutoHider() {
        const hidden = new Map();
        const wrapperSelector = '[data-radix-popper-content-wrapper]';
        const hideWrapper = (w) => {
            if (!w) return;
            const txt = w.textContent || '';
            const models = shared.models || [];
            const looksLikeModelMenu = !!w.querySelector('img[src*="model-icon"]') || models.some((m) => m?.name && txt.includes(m.name));
            if (!looksLikeModelMenu) return;

            // v3.3.5:
            // 신 Radix Select는 열린 뒤 option 포커스/키보드 선택을 사용한다.
            // visibility:hidden은 포커스 자체를 막을 수 있으므로 사용하지 않고,
            // 화면에서만 투명하게 숨겨 공식 Select의 내부 동작은 그대로 살린다.
            if (!hidden.has(w)) {
                hidden.set(w, {
                    opacity: w.style.opacity,
                    pointerEvents: w.style.pointerEvents
                });
            }
            w.style.opacity = '0';
            w.style.pointerEvents = 'none';
        };
        document.querySelectorAll(wrapperSelector).forEach(hideWrapper);
        const stopModelWatch = Core.on('mutations', (muts) => {
            for (const m of muts) for (const n of m.addedNodes) {
                if (!(n instanceof HTMLElement)) continue;
                const ownWrapper = n.matches?.(wrapperSelector) ? n : n.closest?.(wrapperSelector);
                if (ownWrapper) hideWrapper(ownWrapper);
                n.querySelectorAll?.(wrapperSelector).forEach(hideWrapper);
            }
        });
        return () => {
            stopModelWatch();
            for (const [w, old] of hidden.entries()) {
                w.style.opacity = old.opacity;
                w.style.pointerEvents = old.pointerEvents;
            }
        };
    }
    // v3.4.3: Popover 항목은 빈 img.alt + 이름/가격/설명을 포함한 중첩 span이다.
    function getOfficialModelName(el) {
        const img = el?.querySelector(SELECTOR.modelIcon);
        const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const alt = clean(img?.alt);
        if (alt) return alt;
        const label = img?.nextElementSibling;
        if (label?.tagName === 'SPAN') return clean(label.textContent);
        const leaf = Array.from(el?.querySelectorAll('span') || []).find((span) =>
            !span.children.length && clean(span.textContent) && !/^\d[\d,]*개$/.test(clean(span.textContent)));
        return clean(leaf?.textContent || el?.textContent);
    }

    function isOfficialModelSelected(item) {
        // 명시적인 false를 체크 아이콘 추측으로 덮어쓰지 않는다.
        if (item.hasAttribute('aria-current')) return item.getAttribute('aria-current') === 'true';
        if (item.hasAttribute('aria-selected')) return item.getAttribute('aria-selected') === 'true';
        if (item.getAttribute('data-state') === 'unchecked') return false;
        return item.getAttribute('data-state') === 'checked'
            || !!item.querySelector('svg.fill-brand, .fill-brand, [data-radix-select-item-indicator]');
    }

    function getOfficialModelButton() {
        const models = shared.models || [];
        return Array.from(document.querySelectorAll(SELECTOR.modelButton)).find((btn) => {
            if (isOwnEl(btn) || btn.closest(SELECTOR.modelMenu)) return false;
            if (btn.querySelector(SELECTOR.modelIcon)) return true;
            return models.some((m) => m?.name && (btn.textContent || '').includes(m.name));
        });
    }
    function getOfficialModelMenu() {
        const btn = getOfficialModelButton();
        const controlledId = btn?.getAttribute('aria-controls');
        if (controlledId) {
            const controlled = document.getElementById(controlledId);
            if (controlled && !isOwnEl(controlled)) return controlled;
        }
        const models = shared.models || [];
        return Array.from(document.querySelectorAll(SELECTOR.modelMenu)).find((menu) => {
            if (isOwnEl(menu)) return false;
            if (menu.querySelector(SELECTOR.modelIcon)) return true;
            return models.some((m) => m?.name && (menu.textContent || '').includes(m.name));
        }) || null;
    }
    // 편집창은 전체 목록을 유지하고, 순정 선택창의 항목만 숨긴다.
    // DOM을 제거하지 않아 공식 목록 수집 및 모델 변경 기능은 유지된다.
    function applyOfficialModelVisibility(hidden = loadHiddenModels()) {
        const menu = getOfficialModelMenu();
        if (!menu || isOwnEl(menu)) return;
        let hasHidden = false;
        for (const item of menu.querySelectorAll(SELECTOR.menuItem)) {
            if (isOwnEl(item) || !item.querySelector(SELECTOR.modelIcon)) continue;
            if (hidden.has(getOfficialModelName(item))) {
                hasHidden = true;
                if (item.getAttribute('data-chud-model-hidden') !== 'true') item.setAttribute('data-chud-model-hidden', 'true');
            } else if (item.hasAttribute('data-chud-model-hidden')) {
                item.removeAttribute('data-chud-model-hidden');
            }
        }
        // 순정 Popover의 고정 569px 높이는 숨긴 항목 수와 무관하게 남는다.
        // 숨김이 있을 때만 내용 높이로 줄이고, 화면 경계와 스크롤 상한은 유지한다.
        if (hasHidden && menu.getAttribute('role') === 'dialog') {
            if (menu.getAttribute('data-chud-model-compact') !== 'true') menu.setAttribute('data-chud-model-compact', 'true');
        } else if (menu.hasAttribute('data-chud-model-compact')) {
            menu.removeAttribute('data-chud-model-compact');
        }
    }

    function fireModelSelectSequence(el) {
        if (!el) return;
        const opts = {
            bubbles: true,
            cancelable: true,
            pointerType: 'mouse',
            pointerId: 1,
            isPrimary: true,
            button: 0,
            buttons: 1,
            ctrlKey: false
        };
        try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) {}
        try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, ctrlKey: false })); } catch (e) {}
        try { el.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 })); } catch (e) {}
        try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, ctrlKey: false })); } catch (e) {}
        try { el.click(); } catch (e) {}
    }

    function officialModelButtonMatches(targetName) {
        const btn = getOfficialModelButton();
        if (!btn) return false;
        return !!targetName && getOfficialModelName(btn) === targetName.trim();
    }

    async function findOfficialModelItem(targetName, attempts = 20) {
        for (let i = 0; i < attempts; i++) {
            const menu = getOfficialModelMenu();
            if (menu) {
                const item = Array.from(menu.querySelectorAll(SELECTOR.menuItem)).find((it) =>
                    !it.disabled && it.getAttribute('aria-disabled') !== 'true'
                    && getOfficialModelName(it) === targetName.trim());
                if (item) return item;
            }
            await sleep(50);
        }
        return null;
    }

    function closeOfficialModelMenu() {
        const btn = getOfficialModelButton();
        if (!btn || btn.getAttribute('aria-expanded') !== 'true') return;

        // 키보드 이벤트 없이 Radix의 outside-pointer 닫기 경로를 먼저 탄다.
        try {
            const base = {
                bubbles: true,
                cancelable: true,
                pointerType: 'mouse',
                pointerId: 91,
                isPrimary: true,
                button: 0,
                buttons: 1
            };
            document.body.dispatchEvent(new PointerEvent('pointerdown', base));
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
            document.body.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
            document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }));
        } catch (e) {}

        // 그래도 열려 있으면 trigger를 마우스로 한 번 눌러 닫는다.
        setTimeout(() => {
            const latest = getOfficialModelButton();
            if (latest && latest.getAttribute('aria-expanded') === 'true') {
                fireModelSelectSequence(latest);
            }
        }, 40);
    }

    async function selectModelInvisibly(targetName) {
        // v3.3.6:
        // 키보드 이벤트를 전혀 만들지 않고 공식 Radix Select를 마우스 이벤트로만 조작한다.
        // 선택 성공 뒤 팝업이 남아 있으면 outside-pointer/trigger 경로로 즉시 닫는다.
        markModelSelectionPending(targetName);

        const btn = getOfficialModelButton();
        if (!btn) {
            pendingModelName = '';
            pendingModelUntil = 0;
            console.warn('[대시보드] 공식 모델 버튼 못 찾음');
            requestModelResync();
            return;
        }

        if (officialModelButtonMatches(targetName)) {
            pendingModelName = '';
            pendingModelUntil = 0;
            closeOfficialModelMenu();
            requestModelResync();
            return;
        }

        const stop = createModelMenuAutoHider();
        let success = false;
        try {
            if (btn.getAttribute('aria-expanded') !== 'true') {
                fireModelSelectSequence(btn);
            }

            let item = await findOfficialModelItem(targetName, 20);
            if (!item) {
                console.warn('[대시보드] 공식 모델 항목 못 찾음:', targetName);
                requestModelResync();
                return;
            }

            // 실제 마우스 선택 순서만 사용한다. KeyboardEvent는 절대 생성하지 않는다.
            fireModelSelectSequence(item);
            await sleep(200);
            success = officialModelButtonMatches(targetName);

            // 첫 pointer 시퀀스가 씹힌 경우 한 번만 재시도한다.
            if (!success) {
                const btn2 = getOfficialModelButton();
                if (btn2 && btn2.getAttribute('aria-expanded') !== 'true') {
                    fireModelSelectSequence(btn2);
                    await sleep(90);
                }
                item = await findOfficialModelItem(targetName, 12);
                if (item) {
                    fireModelSelectSequence(item);
                    await sleep(200);
                    success = officialModelButtonMatches(targetName);
                }
            }

            if (success) {
                pendingModelName = '';
                pendingModelUntil = 0;
                shared.heavyStale = true;
                closeOfficialModelMenu();
                requestModelResync();
                setTimeout(scheduleUpdate, 120);
                setTimeout(scheduleUpdate, 500);
                setTimeout(scheduleUpdate, 1100);
            } else {
                console.warn('[대시보드] 모델 선택 확인 실패:', targetName);
                closeOfficialModelMenu();
                requestModelResync();
            }
        } finally {
            if (!success) {
                pendingModelName = '';
                pendingModelUntil = 0;
                requestModelResync();
            }
            // 팝업이 다시 보이지 않도록 닫기를 먼저 요청하고, 그 뒤 투명화만 복구한다.
            closeOfficialModelMenu();
            setTimeout(stop, 180);
        }
    }

    /* =========================================================
     * 7. InfoBar 모듈 (턴/사용·잔여·차감 크래커)
     * =======================================================*/
    const InfoBar = (() => {
        const DEFAULT_DETAIL = { turn: false, cumulative: false, deducted: false, cracker: false };
        const DEFAULT_VISIBLE = { turn: true, cumulative: true, deducted: true, cracker: true };

        let el = null, textSpan = null, settingsBtn = null, menu = null;
        let detail = load(STORAGE.infoDetail, DEFAULT_DETAIL);
        let visible = load(STORAGE.infoVisible, DEFAULT_VISIBLE);
        let lastHtml = '';

        function load(key, def) {
            try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch (e) { return { ...def }; }
        }
        function saveDetail() { try { localStorage.setItem(STORAGE.infoDetail, JSON.stringify(detail)); } catch (e) {} }
        function saveVisible() { try { localStorage.setItem(STORAGE.infoVisible, JSON.stringify(visible)); } catch (e) {} }

        function build(container) {
            el = document.createElement('div');
            el.id = 'chud-infobar';

            settingsBtn = document.createElement('button');
            settingsBtn.className = 'chud-settings-button';
            settingsBtn.type = 'button';
            settingsBtn.innerHTML = ICON.settings;
            settingsBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleMenu(); };

            textSpan = document.createElement('span');
            textSpan.id = 'chud-info-text';
            textSpan.onclick = (e) => {
                const part = e.target.closest('.chud-part');
                if (!part) return;
                if (part.dataset.part === 'deducted') return;
                e.preventDefault(); e.stopPropagation();
                toggleDetail(part.dataset.part);
            };

            el.append(textSpan, settingsBtn);
            container.appendChild(el);

            menu = buildMenu();
            document.body.appendChild(menu);

            applyTheme();
            lastHtml = '';
        }

        function buildMenu() {
            const m = document.createElement('div');
            m.id = 'chud-info-menu';
            const t = document.createElement('div');
            t.className = 'chud-menu-title'; t.textContent = '정보 표시';
            m.appendChild(t);
            const items = [
                { key: 'turn', label: '턴수', icon: ICON.clock },
                { key: 'cumulative', label: '누적 사용 크래커', icon: ICON.bittenCracker.replaceAll('chud-bite-mask', 'chud-info-menu-bite-mask') },
                { key: 'cracker', label: '잔여 크래커', icon: ICON.cracker },
                { key: 'deducted', label: '차감 크래커', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16m-6-6 6 6 6-6"/></svg>' }
            ];
            for (const it of items) {
                const row = document.createElement('label');
                row.className = 'chud-menu-row';
                const icon = it.icon.replace(/ class="[^"]*"/, '').replace('<svg ', '<svg class="chud-btn-icon" aria-hidden="true" focusable="false" ');
                row.innerHTML = `<input type="checkbox" data-part="${it.key}">${icon}<span>${it.label}</span><i class="chud-sw" aria-hidden="true"></i>`;
                row.querySelector('input').onchange = (e) => {
                    e.stopPropagation();
                    visible[it.key] = e.target.checked; saveVisible();
                    lastHtml = '__FORCE__'; render(); syncMenu();
                };
                m.appendChild(row);
            }
            return m;
        }

        function toggleDetail(key) {
            if (!Object.prototype.hasOwnProperty.call(detail, key)) return;
            if (visible[key] === false) return;
            // 기본 바는 숫자만 작게 보이고, 라벨은 눌렀을 때만 펼친다.
            if (key === 'deducted') return;
            detail[key] = !detail[key]; saveDetail(); lastHtml = ''; render();
        }

        function toggleMenu() {
            if (!menu) return;
            if (menu.style.display === 'flex') { hideMenu(); return; }
            menu.style.display = 'flex'; syncMenu(); positionMenu();
        }
        function hideMenu() { if (menu) menu.style.display = 'none'; }
        function positionMenu() {
            if (!menu || !settingsBtn) return;
            const r = settingsBtn.getBoundingClientRect();
            menu.style.left = '0px'; menu.style.top = '0px';
            const w = menu.offsetWidth, h = menu.offsetHeight, gap = 8;
            let left = Math.max(gap, Math.min(r.left, window.innerWidth - w - gap));
            let top = r.top - h - gap; if (top < gap) top = r.bottom + gap;
            menu.style.left = `${left}px`; menu.style.top = `${top}px`;
        }
        function syncMenu() {
            if (!menu) return;
            menu.querySelectorAll('input[data-part]').forEach((i) => { i.checked = visible[i.dataset.part] !== false; });
        }

        function applyTheme() {
            if (!el) return;
            const c = getThemeColors(currentInput || document.body);
            el.style.backgroundColor = 'transparent';
            el.style.color = c.text;
            if (menu) { menu.style.background = c.menuBg; menu.style.borderColor = c.menuBorder; menu.style.color = c.itemText; }
        }

        function render() {
            if (!textSpan) return;
            const logs = shared.logs;
            const domGroups = Core.messageCount();
            const parts = [];

            // 턴수
            let turns = logs ? Math.max(0, Number(logs.officialTurnCount ?? (logs.chatCounts - 1)) || 0) : Math.max(0, Math.floor(domGroups / 2) - 1);
            if (turns > 0) {
                const summary = `${ICON.clock}<span style="font-weight:700;">${turns}</span>턴`;
                let det = `${ICON.clock}<span style="opacity:.75;margin-right:2px;">진행</span><span style="font-weight:700;">${turns}</span>턴`;
                const total = logs ? logs.totalMessages : domGroups;
                const userTurns = logs ? Math.max(0, Number(logs.userTurnCount ?? logs.officialTurnCount ?? turns) || 0) : turns;
                const currentAi = logs ? Math.max(0, Number(logs.currentAssistantCount ?? 0) || 0) : 0;
                const currentPrologue = logs ? Math.max(0, Number(logs.currentPrologueCount ?? 0) || 0) : 0;
                const hints = [];
                if (userTurns > 0) hints.push(`유저 ${userTurns.toLocaleString()}개`);
                if (currentAi > 0) hints.push(`현재 답변 ${currentAi.toLocaleString()}개`);
                if (currentPrologue > 0) hints.push(`프롤로그 ${currentPrologue.toLocaleString()}개`);
                if (total > 0) hints.push(`총 ${total.toLocaleString()}개`);
                if (hints.length) det += `&nbsp;<span style="opacity:.75;">(${hints.join(' · ')})</span>`;
                parts.push({ key: 'turn', summaryHtml: summary, detailHtml: det });
            } else {
                const summary = `${ICON.clock}<span style="font-weight:700;">0</span>턴`;
                const det = `${ICON.clock}<span style="opacity:.75;margin-right:2px;">진행</span><span style="font-weight:700;">0</span>턴`;
                parts.push({ key: 'turn', summaryHtml: summary, detailHtml: det });
            }

            // 사용 크래커
            if (visible.cumulative !== false) {
                let txt = '대기 중', suffix = '', anim = '';
                if (shared.cumBusy) { txt = '...'; anim = 'chud-pulse'; }
                else if (shared.cumulative !== null && shared.cumulative !== undefined) { txt = shared.cumulative.toLocaleString(); suffix = '개'; }
                else if (turns <= 0) { txt = '0'; suffix = '개'; }
                const bit = ICON.bittenCracker.replace('class="chud-cracker-icon"', `class="chud-cracker-icon ${anim}"`);
                const summary = `${bit}<span style="font-weight:700;">${txt}</span>${suffix}`;
                const det = `${bit}<span style="opacity:.75;margin-right:2px;">누적 사용 크래커</span><span style="font-weight:700;">${txt}</span>${suffix}`;
                parts.push({ key: 'cumulative', summaryHtml: summary, detailHtml: det });
            }

            // 잔여 + 차감
            // 차감액(▼)은 잔여 크래커 역산이 아니라 generate_done 이후 crackers/history API에서 claim한 실제 소비 기록만 표시한다.
            // 잔여 API 차이는 다른 탭/다른 방 소비가 섞일 수 있어, 여기서는 잔여 표시용 snapshot만 저장한다.
            const bal = shared.balance;
            const turnInfo = getCurrentTurnInfo();
            const cost = turnInfo ? turnInfo.cost : null;
            let diff = loadLastDeductedAmount(shared.chatId || getPathInfo().chatId);
            if (bal !== null && bal !== undefined) {
                let summary = `${ICON.cracker}<span style="font-weight:700;">${bal.toLocaleString()}</span>개`;
                let det = `${ICON.cracker}<span style="opacity:.75;margin-right:2px;">잔여</span><span style="font-weight:700;">${bal.toLocaleString()}</span>개`;
                if (cost) {
                    const can = Math.floor(bal / cost);
                    const multTxt = (turnInfo && turnInfo.multLabel && turnInfo.multLabel !== '기본') ? ` · ${turnInfo.multLabel}` : '';
                    det += `&nbsp;<span style="opacity:.75;">(${can.toLocaleString()}턴 가능, 1회 ${cost.toLocaleString()}개${multTxt})</span>`;
                }
                parts.push({ key: 'cracker', summaryHtml: summary, detailHtml: det });
            }

            if (diff > 0) {
                const html = `<span style="display:inline-flex;align-items:center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="margin-right:2px;flex-shrink:0;"><polygon points="4,8 20,8 12,18"></polygon></svg><span style="font-weight:700;">${diff}</span>개</span>`;
                parts.push({ key: 'deducted', summaryHtml: html, detailHtml: html });
            }

            renderParts(parts);
        }

        function renderParts(parts) {
            if (!textSpan) return;
            const vis = parts.filter((p) => visible[p.key] !== false);
            if (!vis.length) { textSpan.replaceChildren(); lastHtml = '__EMPTY__'; return; }
            const html = vis.map((p, i) => {
                const sep = i > 0 ? `<span class="chud-sep">|</span>` : '';
                const content = detail[p.key] ? p.detailHtml : p.summaryHtml;
                const cur = p.key === 'deducted' ? 'style="cursor:default;"' : '';
                return `${sep}<button class="chud-part" data-part="${p.key}" ${cur}>${content}</button>`;
            }).join('');
            if (html === lastHtml) return;
            textSpan.innerHTML = html;
            lastHtml = html;
        }

        return {
            get el() { return el; },
            mount(container) {
                if (el && el.parentElement === container) return;
                this.unmount();
                build(container);
            },
            unmount() {
                el?.remove(); menu?.remove();
                el = textSpan = settingsBtn = menu = null;
                hideMenu();
            },
            render() { if (el) { applyTheme(); render(); } },
            reposition() { if (menu && menu.style.display === 'flex') positionMenu(); },
            settingsBtn() { return settingsBtn; }
        };
    })();

    /* =========================================================
     * 8. Sidebar 모듈 (모델 변경 + 액션 버튼)
     * =======================================================*/
    const Sidebar = (() => {
        const DEFAULT_VISIBLE = {
            modelButton: true, guideButton: true, profileButton: true, profileBoxButton: true, noteButton: true, outputButton: true,
            summaryButton: true, imageButton: true, archiveButton: true, externalArchiveButton: true, roomBackgroundButton: true, scenePainterButton: true, wishManagerButton: true, sceneBlurButton: true, startButton: true, loreButton: true, translatorButton: true, aiSummaryButton: true, aiWriterButton: true, gameHudButton: true
        };

        let el = null, content = null, settingsBtn = null, dropdown = null, menu = null;
        let btns = {};
        let visible = load(STORAGE.sideVisible, DEFAULT_VISIBLE);
        let modelDropdownSyncBusy = false;
        let lastModelDropdownSync = 0;
        let hiddenModels = loadHiddenModels();
        let editMode = false;
        let dropdownAnchor = null;

        function load(key, def) {
            try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch (e) { return { ...def }; }
        }
        function saveVisible() { try { localStorage.setItem(STORAGE.sideVisible, JSON.stringify(visible)); } catch (e) {} }

        function makeBtn(id, icon, onclick) {
            const b = document.createElement('button');
            b.id = id; b.className = 'chud-action-btn'; b.type = 'button'; b.tabIndex = -1;
            b.innerHTML = icon;
            b.addEventListener('pointerdown', (e) => e.preventDefault());
            b.addEventListener('keydown', (e) => { e.preventDefault(); e.stopPropagation(); });
            b.onclick = (e) => {
                if (e.detail === 0) { e.preventDefault(); e.stopPropagation(); return; }
                e.preventDefault(); e.stopPropagation(); onclick();
            };
            return b;
        }

        function build(container) {
            el = document.createElement('div');
            el.id = 'chud-sidebar';

            settingsBtn = document.createElement('button');
            settingsBtn.className = 'chud-settings-button';
            settingsBtn.type = 'button'; settingsBtn.tabIndex = -1;
            settingsBtn.innerHTML = ICON.settings;
            settingsBtn.addEventListener('pointerdown', (e) => e.preventDefault());
            settingsBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleMenu(); };

            content = document.createElement('div');
            content.id = 'chud-side-content';

            btns.model = makeBtn('chud-model-btn', ICON.model, toggleDropdown);
            btns.model.title = '모델 변경';
            btns.model.setAttribute('aria-label', '모델 변경');
            btns.guide = makeBtn('chud-guide-btn', ICON.guide, () => openDialogByIconPath(ICON_PATHS.guide, '플레이 가이드'));
            btns.profile = makeBtn('chud-profile-btn', ICON.profile, () => openDialogByIconPath(ICON_PATHS.profile, '대화 프로필'));
            btns.profileBox = makeBtn('chud-profile-box-btn', ICON.profileBox, openProfileBox);
            btns.profileBox.title = '프로필 박스';
            btns.profileBox.setAttribute('aria-label', '프로필 박스');
            btns.profileBox.dataset.cpmExternalProfileLauncher = 'true';
            btns.note = makeBtn('chud-note-btn', ICON.note, () => openDialogByIconPath(ICON_PATHS.note, '유저 노트'));
            btns.output = makeBtn('chud-output-btn', ICON.output, openOutputDialog);
            btns.summary = makeBtn('chud-summary-btn', ICON.summary, () => openDialogByIconPath(ICON_PATHS.summary, '요약 메모리'));
            btns.image = makeBtn('chud-image-btn', ICON.image, toggleContextImage);
            btns.archive = makeBtn('chud-archive-btn', ICON.archive, openNativeImageArchive);
            btns.external = makeBtn('chud-external-btn', ICON.externalArchive, openExternalImageArchive);
            btns.roomBackground = makeBtn('chud-room-bg-btn', ICON.roomBackground, openCustomRoomBackgroundSettings);
            btns.roomBackground.title = '직접 방 이미지 배경 설정';
            btns.roomBackground.setAttribute('aria-label', '직접 방 이미지 배경 설정');
            btns.scenePainter = makeBtn('chud-scene-painter-btn', ICON.scenePainter, openScenePainterSettings);
            btns.scenePainter.title = 'AI 삽화 생성 · Scene Painter 설정';
            btns.scenePainter.setAttribute('aria-label', 'AI 삽화 생성 · Scene Painter 설정');
            btns.wishManager = makeBtn('chud-wish-manager-btn', ICON.wishManager, openWishRpManager);
            btns.wishManager.title = 'Wish RP Manager';
            btns.wishManager.setAttribute('aria-label', 'Wish RP Manager');
            btns.sceneBlur = makeBtn('chud-scene-blur-btn', ICON.sceneBlur, openScenePainterBackgroundSettings);
            btns.sceneBlur.title = 'Scene Painter 배경 블러 설정';
            btns.sceneBlur.setAttribute('aria-label', 'Scene Painter 배경 블러 설정');
            btns.start = makeBtn('chud-start-btn', ICON.start, openStartSetting);
            btns.lore = makeBtn('chud-lore-btn', ICON.lore, openLoreTools);
            btns.lore.title = '에리 로어';
            btns.translator = makeBtn('chud-translator-btn', ICON.translator, openTranslatorSettings);
            btns.translator.title = '초월 번역기';
            btns.translator.setAttribute('aria-label', '초월 번역기');
            btns.aiSummary = makeBtn('chud-ai-summary-btn', ICON.aiSummary, openAiSummary);
            btns.aiSummary.title = 'AI 요약·메모리';
            btns.aiSummary.setAttribute('aria-label', 'AI 요약·메모리');
            btns.aiWriter = makeBtn('chud-ai-writer-btn', ICON.aiWriter, openAiWriterSettings);
            btns.aiWriter.title = 'AI 답변';
            btns.aiWriter.setAttribute('aria-label', 'AI 답변');
            btns.gameHud = makeBtn('chud-game-hud-btn', ICON.gameHud, openGameHud);
            btns.gameHud.title = '게임 HUD';
            btns.gameHud.setAttribute('aria-label', '게임 HUD');

            content.append(btns.model, btns.guide, btns.profile, btns.profileBox, btns.note, btns.output, btns.summary, btns.image, btns.archive, btns.external, btns.roomBackground, btns.scenePainter, btns.wishManager, btns.sceneBlur, btns.start, btns.lore, btns.translator, btns.aiSummary, btns.aiWriter, btns.gameHud);
            el.append(content, settingsBtn);
            container.appendChild(el);

            dropdown = document.createElement('div');
            dropdown.id = 'chud-side-dropdown';
            document.body.appendChild(dropdown);

            menu = buildMenu();
            document.body.appendChild(menu);

            refreshModelList();
            applyTheme();
            applyVisible();
        }

        function buildMenu() {
            const m = document.createElement('div');
            m.id = 'chud-side-menu';

            const editRow = document.createElement('div');
            editRow.className = 'chud-menu-action';
            editRow.innerHTML = `${MODEL_HIDE_ICON.edit}<span>출력 모델·추론 숨기기</span>`;
            editRow.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                openModelEditor();
            };
            m.appendChild(editRow);

            const t = document.createElement('div');
            t.className = 'chud-menu-title'; t.textContent = '버튼 표시';
            m.appendChild(t);
            const items = [
                { key: 'modelButton', label: '모델 아이콘' }, { key: 'guideButton', label: '플레이 가이드' },
                { key: 'profileButton', label: '대화 프로필' },
                { key: 'profileBoxButton', label: '프로필 박스' }, { key: 'noteButton', label: '유저노트 표시' },
                { key: 'outputButton', label: '출력량 조절' }, { key: 'summaryButton', label: '요약 메모리' },
                { key: 'imageButton', label: '이미지 ON/OFF' }, { key: 'archiveButton', label: '이미지 보관함' },
                { key: 'externalArchiveButton', label: '외부 이미지 보관함' }, { key: 'roomBackgroundButton', label: '직접 방 이미지 배경' },
                { key: 'scenePainterButton', label: 'AI 삽화 · Scene Painter' }, { key: 'wishManagerButton', label: 'Wish RP Manager' }, { key: 'sceneBlurButton', label: 'SP 배경 블러' }, { key: 'startButton', label: '시작 설정' },
                { key: 'loreButton', label: '에리 로어' }, { key: 'translatorButton', label: '초월 번역기' }, { key: 'aiSummaryButton', label: 'AI 요약·메모리' }, { key: 'aiWriterButton', label: 'AI 답변' },
                { key: 'gameHudButton', label: '게임 HUD' }
            ];
            for (const it of items) {
                const row = document.createElement('label');
                row.className = 'chud-menu-row'; row.dataset.part = it.key;
                row.innerHTML = `<input type="checkbox" data-part="${it.key}">${ICON[it.key.replace(/Button$/, '')] || ''}<span>${it.label}</span><i class="chud-sw" aria-hidden="true"></i>`;
                row.querySelector('input').onchange = (e) => {
                    e.stopPropagation();
                    visible[it.key] = e.target.checked; saveVisible();
                    applyVisible(); syncMenu();
                };
                m.appendChild(row);
            }
            return m;
        }

        function refreshModelList() {
            if (!dropdown) return;
            const models = shared.models || [];
            dropdown.replaceChildren();

            // 숨기기는 현재 선택과 독립적이다. 현재 모델도 일반 목록에서는 숨기고,
            // 편집 모드에서는 모두 보여 다시 표시할 수 있게 한다.
            const listed = models.filter((model) => editMode || !hiddenModels.has(model.name));

            for (const model of listed) {
                const isHidden = hiddenModels.has(model.name);
                const item = document.createElement('div');
                item.className = `chud-model-item${isHidden ? ' is-hidden-model' : ''}`;
                item.dataset.modelName = model.name;
                item.setAttribute('role', editMode ? 'menuitemcheckbox' : 'menuitemradio');
                item.setAttribute('aria-checked', 'false');

                const body = document.createElement('div');
                body.className = 'chud-model-body';

                const title = document.createElement('div');
                title.className = 'chud-model-title';

                if (model.icon) {
                    const img = document.createElement('img');
                    img.src = model.icon;
                    img.alt = model.name;
                    img.className = 'chud-model-icon';
                    img.width = 16;
                    img.height = 16;
                    title.appendChild(img);
                }

                const name = document.createElement('span');
                name.className = 'chud-model-name';
                name.textContent = model.name;
                title.appendChild(name);

                if (model.cost != null) {
                    const cost = document.createElement('span');
                    cost.className = 'chud-cost-badge';
                    cost.textContent = `${Number(model.cost).toLocaleString()}개`;
                    title.appendChild(cost);
                }

                if (model.recommended) {
                    const rec = document.createElement('span');
                    rec.className = 'chud-rec-badge';
                    rec.textContent = '권장';
                    rec.title = '제작자 권장';
                    title.appendChild(rec);
                }

                body.appendChild(title);

                if (editMode) {
                    const eye = document.createElement('span');
                    eye.className = 'chud-eye-icon';
                    eye.setAttribute('aria-hidden', 'true');
                    eye.innerHTML = isHidden ? MODEL_HIDE_ICON.eyeOff : MODEL_HIDE_ICON.eye;
                    item.append(body, eye);
                    item.title = isHidden ? '목록에 다시 표시' : '목록에서 숨기기';
                } else {
                    const check = document.createElement('span');
                    check.className = 'chud-check-icon';
                    check.setAttribute('aria-hidden', 'true');
                    check.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path fill-rule="evenodd" d="m19.27 7.21-9.05 9.76-5.76-6.24 1.18-1.08 4.58 4.96 7.87-8.48z" clip-rule="evenodd"></path></svg>';
                    item.append(body, check);
                }

                item.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (editMode) {
                        if (hiddenModels.has(model.name)) hiddenModels.delete(model.name);
                        else hiddenModels.add(model.name);
                        saveHiddenModels(hiddenModels);
                        refreshModelList();
                        return;
                    }
                    markModelSelectionPending(model.name);
                    highlightCurrent();
                    // 공식 메뉴도 선택 직후 닫히므로, 미니 메뉴도 체크가 보일 만큼만 아주 짧게 보여주고 닫는다.
                    setTimeout(hideDropdown, 160);
                    selectModelInvisibly(model.name);
                };
                dropdown.appendChild(item);
            }

            highlightCurrent();
            // 항목 개수가 바뀌면 높이도 바뀌므로, 열려 있을 때는 위치를 다시 잡는다.
            if (dropdown.style.display === 'flex') positionFloat(dropdown, dropdownAnchor || btns.model || settingsBtn);
        }

        function highlightCurrent() {
            if (!dropdown) return;
            const cur = shared.currentModel?.name || pendingModelName || '';
            dropdown.querySelectorAll('.chud-model-item').forEach((it) => {
                const on = it.dataset.modelName === cur;
                it.classList.toggle('is-selected', on);
                const checked = editMode ? !hiddenModels.has(it.dataset.modelName) : on;
                it.setAttribute('aria-checked', checked ? 'true' : 'false');
            });
        }

        function setModelDropdownLoading(message = '모델 목록 확인 중...') {
            if (!dropdown) return;
            dropdown.replaceChildren();
            const row = document.createElement('div');
            row.className = 'chud-model-item';
            row.style.cursor = 'default';
            row.style.opacity = '0.72';
            row.textContent = message;
            dropdown.appendChild(row);
        }

        function syncMiniModelDropdownLight(force = false) {
            if (!dropdown) return;

            // v3.0.39: 미니 모델창의 기본 목록은 API를 쓴다.
            // 단, v3 API에는 폐기/대체 모델도 남을 수 있으므로 loadModels()에서
            // isBlock/deletedAt/replacementChatModelId/deprecateAnnouncementId를 필터링한다.
            const harvested = harvestOfficialModels();
            if (harvested && harvested.length) {
                // 사용자가 공식 모델창을 직접 열어둔 경우만 DOM을 보정값으로 사용한다.
                applyOfficialModelList(harvested, { persist: true, refreshSidebar: true });
                const selected = harvested.find((m) => m.selected);
                if (selected) {
                    pendingModelName = '';
                    pendingModelUntil = 0;
                    shared.currentModel = findModelByName(selected.name) || selected;
                    highlightCurrent();
                    refreshAll();
                }
            }
            // 공식 목록이 같아 applyOfficialModelList가 갱신을 생략해도,
            // 편집 모드/숨김 설정에 따른 렌더링은 매번 적용한다.
            if ((shared.models || []).length) refreshModelList();
            else setModelDropdownLoading();

            const now = Date.now();
            if (!force && now - lastModelDropdownSync < MODEL_OPEN_REFRESH_TTL) {
                highlightCurrent();
                return;
            }
            if (modelDropdownSyncBusy) return;
            modelDropdownSyncBusy = true;
            lastModelDropdownSync = now;

            const storyId = shared.storyId;
            const chatId = shared.chatId;
            const generation = Core.epoch;
            const jobs = [];

            if (storyId) {
                jobs.push(loadModels(storyId, { force: true }).then((models) => {
                    if (shared.storyId !== storyId || Core.route().storyId !== storyId) return;
                    if (Array.isArray(models) && models.length) {
                        shared.models = models;
                        refreshModelList();
                    }
                }).catch(() => {}));
            }

            if (chatId) {
                jobs.push(fetchChatMeta(chatId).then((meta) => {
                    if (shared.chatId !== chatId || Core.route().chatId !== chatId) return;
                    shared.meta = meta;
                    shared.currentModel = detectCurrentModel() || shared.currentModel;
                    highlightCurrent();
                    refreshAll();
                }).catch(() => {}));
            }

            Promise.allSettled(jobs).finally(() => {
                modelDropdownSyncBusy = false;
                if(generation!==Core.epoch||Core.route().chatId!==chatId)return;
                const harvestedLate = harvestOfficialModels();
                if (harvestedLate && harvestedLate.length) {
                    applyOfficialModelList(harvestedLate, { persist: true, refreshSidebar: true });
                    const selected = harvestedLate.find((m) => m.selected);
                    if (selected) shared.currentModel = findModelByName(selected.name) || selected;
                } else {
                    shared.currentModel = detectCurrentModel() || shared.currentModel;
                    refreshModelList();
                }
                highlightCurrent();
                refreshAll();
            });
        }

        function openModelEditor() {
            if (!dropdown) return;
            hideMenu();
            editMode = true;
            dropdownAnchor = settingsBtn;
            refreshModelList();
            dropdown.style.display = 'flex';
            syncMiniModelDropdownLight(true);
            positionFloat(dropdown, dropdownAnchor);
        }

        function toggleDropdown() {
            if (!dropdown) return;
            if (dropdown.style.display === 'flex') { hideDropdown(); return; }
            hideMenu();
            editMode = false;
            dropdownAnchor = btns.model;
            dropdown.style.display = 'flex';
            // API 목록을 기본으로 쓰고, 공식 모델창이 이미 열려 있을 때만 DOM 보정값을 섞는다.
            syncMiniModelDropdownLight(true);
            positionFloat(dropdown, dropdownAnchor);
        }
        function hideDropdown() {
            if (!dropdown) return;
            dropdown.style.display = 'none';
            dropdownAnchor = null;
            // 다음에 열 때는 항상 편집 종료 상태로 시작한다.
            if (editMode) {
                editMode = false;
                refreshModelList();
            }
        }

        function toggleMenu() {
            if (!menu) return;
            if (menu.style.display === 'flex') { hideMenu(); return; }
            hideDropdown();
            menu.style.display = 'flex'; syncMenu(); positionFloat(menu, settingsBtn);
        }
        function hideMenu() { if (menu) menu.style.display = 'none'; }
        function hideAll() { hideDropdown(); hideMenu(); }

        function positionFloat(floatEl, anchor) {
            if (!floatEl || !anchor) return;
            const r = anchor.getBoundingClientRect();
            const gap = 8;
            const minH = 160;
            const maxDefault = floatEl.id === 'chud-side-dropdown' ? 450 : 360;
            const above = Math.max(0, r.top - gap);
            const below = Math.max(0, window.innerHeight - r.bottom - gap);

            // 입력창에 붙은 대시보드 메뉴는 기본적으로 위쪽 공간을 우선 사용한다.
            // 화면이 낮거나 키보드/줌 때문에 위쪽이 부족할 때만 아래쪽으로 폴백한다.
            const preferAbove = !!anchor.closest?.('#chud-sidebar, #chud-infobar') || above >= below;
            const usable = preferAbove && above >= minH ? above : Math.max(above, below);
            if (floatEl.id === 'chud-side-dropdown' || floatEl.id === 'chud-info-menu') {
                floatEl.style.maxHeight = `${Math.max(minH, Math.min(maxDefault, Math.floor(usable)))}px`;
            } else if (floatEl.id === 'chud-side-menu') {
                // 버튼 표시 메뉴는 내용 높이만큼 그대로 펼친다.
                floatEl.style.maxHeight = 'none';
            }

            floatEl.style.left = '0px';
            floatEl.style.top = '0px';
            const w = floatEl.offsetWidth;
            const h = floatEl.offsetHeight;
            let left = Math.max(gap, Math.min(r.left, window.innerWidth - w - gap));
            let top;

            if (preferAbove && above >= Math.min(h, minH)) top = r.top - h - gap;
            else top = r.bottom + gap;

            if (top + h > window.innerHeight - gap) top = window.innerHeight - h - gap;
            if (top < gap) top = gap;

            floatEl.style.left = `${left}px`;
            floatEl.style.top = `${top}px`;
        }

        function syncMenu() {
            if (!menu) return;
            menu.querySelectorAll('input[data-part]').forEach((i) => { i.checked = visible[i.dataset.part] !== false; });
        }

        function applyVisible() {
            const set = (b, on) => { if (b) b.style.display = on ? 'inline-flex' : 'none'; };
            set(btns.model, visible.modelButton !== false);
            set(btns.guide, visible.guideButton !== false);
            set(btns.profile, visible.profileButton !== false);
            set(btns.note, visible.noteButton !== false);
            set(btns.output, visible.outputButton !== false);
            set(btns.summary, visible.summaryButton !== false);
            set(btns.start, visible.startButton !== false);
            set(btns.lore, shared.loreAvailable && visible.loreButton !== false);
            set(btns.translator, shared.translatorAvailable && visible.translatorButton !== false);
            set(btns.aiSummary, shared.aiSummaryAvailable && visible.aiSummaryButton !== false);
            set(btns.aiWriter, shared.aiWriterAvailable && visible.aiWriterButton !== false);
            set(btns.gameHud, shared.gameHudAvailable && visible.gameHudButton !== false);
            set(btns.roomBackground, shared.roomBackgroundAvailable && visible.roomBackgroundButton !== false);
            set(btns.scenePainter, shared.scenePainterAvailable && visible.scenePainterButton !== false);
            set(btns.wishManager, shared.wishManagerAvailable && visible.wishManagerButton !== false);
            set(btns.profileBox, shared.profileBoxAvailable && visible.profileBoxButton !== false);
            set(btns.sceneBlur, shared.sceneBlurAvailable && visible.sceneBlurButton !== false);
            // 가용성 의존 버튼
            set(btns.image, shared.imageSwitchAvailable && visible.imageButton !== false);
            set(btns.archive, shared.nativeArchiveAvailable && visible.archiveButton !== false);
            set(btns.external, shared.externalArchiveAvailable && visible.externalArchiveButton !== false);

            // 설정 메뉴 행 표시
            const rowVis = (key, on) => { const r = menu?.querySelector(`[data-part="${key}"]`); if (r) r.style.display = on ? 'flex' : 'none'; };
            rowVis('imageButton', shared.imageSwitchAvailable);
            rowVis('archiveButton', shared.nativeArchiveAvailable);
            rowVis('externalArchiveButton', shared.externalArchiveAvailable);
            rowVis('loreButton', shared.loreAvailable);
            rowVis('translatorButton', shared.translatorAvailable);
            rowVis('aiSummaryButton', shared.aiSummaryAvailable);
            rowVis('aiWriterButton', shared.aiWriterAvailable);
            rowVis('gameHudButton', shared.gameHudAvailable);
            rowVis('roomBackgroundButton', shared.roomBackgroundAvailable);
            rowVis('scenePainterButton', shared.scenePainterAvailable);
            rowVis('wishManagerButton', shared.wishManagerAvailable);
            rowVis('profileBoxButton', shared.profileBoxAvailable);
            rowVis('sceneBlurButton', shared.sceneBlurAvailable);
        }

        function applyTheme() {
            if (!el) return;
            const c = getThemeColors(currentInput || document.body);
            el.style.backgroundColor = 'transparent';
            el.style.color = c.sideIconText || c.text;
            el.style.setProperty('--chud-side-hover-text', c.sideIconHoverText || c.itemHoverText);
            el.style.setProperty('--chud-side-active-text', c.sideIconActiveText || c.activeBtnText);
            if (btns.image) btns.image.classList.toggle('is-active', !!shared.imageSwitchState);
            if (btns.roomBackground) {
                btns.roomBackground.classList.remove('is-active');
                btns.roomBackground.title = '직접 방 이미지 배경 설정';
            }
            if (btns.scenePainter) {
                btns.scenePainter.classList.remove('is-active');
                btns.scenePainter.title = 'AI 삽화 생성 · Scene Painter 설정';
            }
            if (btns.wishManager) {
                btns.wishManager.classList.remove('is-active');
                btns.wishManager.title = 'Wish RP Manager';
            }
            if (btns.sceneBlur) {
                btns.sceneBlur.classList.remove('is-active');
                btns.sceneBlur.title = 'Scene Painter 배경 블러 설정';
            }
            if (dropdown) {
                dropdown.style.background = c.menuBg; dropdown.style.borderColor = c.menuBorder; dropdown.style.color = c.itemText;
                dropdown.style.setProperty('--chud-item-hover-bg', c.itemHoverBg);
                dropdown.style.setProperty('--chud-item-hover-text', c.itemHoverText);
                dropdown.style.setProperty('--chud-selected-text', c.itemHoverText);
                dropdown.style.setProperty('--chud-check-text', c.activeBtnText || c.itemHoverText);
                dropdown.style.setProperty('--chud-cost-text', c.costText);
                dropdown.style.setProperty('--chud-cost-border', c.menuBorder);
                dropdown.style.setProperty('--chud-cost-bg', c.chipBg);
                dropdown.style.setProperty('--chud-rec-bg', c.chipBg);
                dropdown.style.setProperty('--chud-rec-text', c.activeBtnText || c.itemHoverText);
            }
            if (menu) { menu.style.background = c.menuBg; menu.style.borderColor = c.menuBorder; menu.style.color = c.itemText; }
        }

        return {
            get el() { return el; },
            mount(container) {
                if (el && el.parentElement === container) return;
                this.unmount();
                build(container);
            },
            unmount() {
                el?.remove(); dropdown?.remove(); menu?.remove();
                el = content = settingsBtn = dropdown = menu = null;
                btns = {};
                hideAll();
            },
            render() { if (el) { applyTheme(); applyVisible(); highlightCurrent(); } },
            refreshModelList() { if (el) refreshModelList(); },
            reposition() {
                if (dropdown && dropdown.style.display === 'flex') positionFloat(dropdown, dropdownAnchor || btns.model || settingsBtn);
                if (menu && menu.style.display === 'flex') positionFloat(menu, settingsBtn);
            },
            hideAll,
            settingsBtn() { return settingsBtn; },
            modelBtn() { return btns.model; },
            dropdownEl() { return dropdown; },
            menuEl() { return menu; }
        };
    })();

    /* =========================================================
     * 9. 공용 상태 / 스케줄러 / 레이아웃
     * =======================================================*/
    const shared = {
        chatId: null, storyId: null,
        models: [], meta: null, currentModel: null,
        balance: null, logs: null, cumulative: null, cumBusy: false,
        imageSwitchAvailable: false, imageSwitchState: false,
        nativeArchiveAvailable: false, externalArchiveAvailable: false,
        loreAvailable: false, translatorAvailable: false, aiSummaryAvailable: false, aiWriterAvailable: false, gameHudAvailable: false, roomBackgroundAvailable: false, scenePainterAvailable: false, wishManagerAvailable: false, profileBoxAvailable: false, sceneBlurAvailable: false,
        heavyStale: true
    };

    const featureEnabled = {
        infoBar: loadFeat('infoBar'),
        sidebar: loadFeat('sidebar'),
        listCracker: loadFeat('listCracker')
    };
    function loadFeat(key) {
        try { const v = localStorage.getItem(FEATURE_KEYS[key]); return v === null ? true : v === '1'; } catch (e) { return true; }
    }
    function saveFeat(key, val) { try { localStorage.setItem(FEATURE_KEYS[key], val ? '1' : '0'); } catch (e) {} }

    function findModelByName(name) {
        const target = (name || '').trim();
        if (!target) return null;
        return (shared.models || []).find((m) => m.name === target || target.includes(m.name) || m.name.includes(target)) || null;
    }

    function parseMultiplier(mult) {
        const s = String(mult || '').trim();
        if (!s || s === '기본') return 1;
        const n = parseFloat(s.replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) && n > 0 ? n : 1;
    }

    function getCurrentTurnInfo() {
        const model = shared.currentModel;
        if (!model) return null;
        const base = Number(model.cost);
        if (!Number.isFinite(base)) return null;
        const per100 = Number(model.per100) || 0;
        const defOut = Number(model.defaultMaxOutput) || 800;
        // 현재 선택된 모델의 배율은 방 메타 chatModelId와 일치하는 항목에서 가져온다.
        const settings = Array.isArray(shared.meta?.maxOutputSettings) ? shared.meta.maxOutputSettings : [];
        const curId = shared.meta?.chatModelId || model.id;
        const entry = settings.find((s) => s.chatModelId === curId);
        const multLabel = entry?.maxOutputMultiplier || '기본';
        const mult = parseMultiplier(multLabel);
        let cost = base;
        if (mult > 1 && per100 > 0) {
            const maxTokens = defOut * mult;
            cost = Math.round(base + Math.max(0, maxTokens - defOut) / 100 * per100);
        }
        return { cost, multLabel, mult };
    }

    function markModelSelectionPending(name) {
        const m = findModelByName(name);
        if (!m) return;
        pendingModelName = m.name;
        pendingModelUntil = Date.now() + 3500;
        shared.currentModel = m;
        refreshAll();
    }

    function requestModelResync() {
        scheduleUpdate();
        const chatId = shared.chatId;
        if (!chatId) return;
        // 공식 상태 반영이 비동기라 3번만 가볍게 재확인. 상시 폴링이 아니라 클릭 직후에만 돈다.
        [250, 900, 1800].forEach((delay) => {
            setTimeout(() => {
                fetchChatMeta(chatId).then((meta) => {
                    if (shared.chatId !== chatId || Core.route().chatId !== chatId) return;
                    shared.meta = meta;
                    shared.currentModel = detectCurrentModel();
                    refreshAll();
                }).catch(() => {});
            }, delay);
        });
    }

    let currentInput = null, currentContainer = null;
    let observer = null, updateTimer = null;
    let dashboardScrollInput = null, dashboardScrollRaf = 0;
    let busy = { balance: false, logs: false };
    let lastChatId = null;
    let lastBalanceTime = 0;
    let lastHeavyTime = 0;
    let pendingModelName = '';
    let pendingModelUntil = 0;

    function isVisibleInputCandidate(el) { return el === Core.editor; }

    function resolveInput() { return Core.editor; }

    function resetInputLayout(inputEl) {
        if (!inputEl) return;
        try {
            inputEl.style.removeProperty('padding-top');
            inputEl.style.removeProperty('min-height');
        } catch (e) {}
    }

    function resetDashboardBarMotion() {
        for (const bar of [Sidebar.el, InfoBar.el]) {
            if (!bar) continue;
            bar.style.removeProperty('transform');
            bar.style.removeProperty('clip-path');
            bar.style.removeProperty('visibility');
        }
    }

    function applyDashboardBarScroll(bar, scrollTop) {
        if (!bar || bar.parentElement !== currentContainer) return;

        // padding-top은 입력 내용과 같이 스크롤된다.
        // 바도 같은 거리만큼 올려 항상 자신의 빈 여백 안에만 머물게 한다.
        const baseTop = parseFloat(bar.style.top) || 0;
        const height = Math.max(1, bar.offsetHeight || 1);
        const clippedTop = Math.max(0, scrollTop - baseTop);

        bar.style.transform = `translate3d(0, ${-scrollTop}px, 0)`;
        if (clippedTop <= 0) {
            bar.style.clipPath = 'none';
            bar.style.visibility = '';
        } else if (clippedTop >= height) {
            bar.style.clipPath = 'inset(100% 0 0 0)';
            bar.style.visibility = 'hidden';
        } else {
            // overflow:visible인 테마에서도 바가 윗 테두리 밖으로 새지 않게 잘라낸다.
            bar.style.clipPath = `inset(${clippedTop}px 0 0 0)`;
            bar.style.visibility = '';
        }
    }

    function syncDashboardBarsToInputScroll() {
        dashboardScrollRaf = 0;
        if (!currentInput || dashboardScrollInput !== currentInput) {
            resetDashboardBarMotion();
            return;
        }
        const scrollTop = Math.max(0, Number(currentInput.scrollTop) || 0);
        applyDashboardBarScroll(Sidebar.el, scrollTop);
        applyDashboardBarScroll(InfoBar.el, scrollTop);
    }

    function scheduleDashboardScrollSync() {
        if (dashboardScrollRaf) return;
        dashboardScrollRaf = requestAnimationFrame(syncDashboardBarsToInputScroll);
    }

    function stopDashboardScrollSync() {
        if (dashboardScrollInput) {
            dashboardScrollInput.removeEventListener('scroll', scheduleDashboardScrollSync);
        }
        if (dashboardScrollRaf) cancelAnimationFrame(dashboardScrollRaf);
        dashboardScrollInput = null;
        dashboardScrollRaf = 0;
        resetDashboardBarMotion();
    }

    function startDashboardScrollSync(inputEl) {
        if (!inputEl) return;
        if (dashboardScrollInput !== inputEl) {
            stopDashboardScrollSync();
            dashboardScrollInput = inputEl;
            dashboardScrollInput.addEventListener('scroll', scheduleDashboardScrollSync, { passive: true });
        }
        scheduleDashboardScrollSync();
    }

    function refreshAvailability() {
        const imgSwitch = getContextImageSwitch();
        shared.nativeArchiveAvailable = !!getNativeImageArchiveTrigger();
        shared.externalArchiveAvailable = !!getExternalImageArchiveTrigger();
        shared.loreAvailable = isLoreToolsInstalled();
        shared.translatorAvailable = isTranslatorInstalled();
        shared.aiSummaryAvailable = isAiSummaryInstalled();
        shared.aiWriterAvailable = isAiWriterInstalled();
        shared.gameHudAvailable = isGameHudInstalled();
        shared.roomBackgroundAvailable = isCustomRoomBackgroundInstalled();
        shared.scenePainterAvailable = isScenePainterInstalled();
        shared.wishManagerAvailable = isWishRpManagerInstalled();
        shared.profileBoxAvailable = isProfileBoxInstalled();
        shared.sceneBlurAvailable = isScenePainterBackgroundInstalled();
        shared.imageSwitchAvailable = !!imgSwitch && shared.nativeArchiveAvailable;
        shared.imageSwitchState = getImageSwitchState(imgSwitch);
        lastHeavyTime = Date.now();
        shared.heavyStale = false;
    }

    function applyLayout() {
        if (!currentInput || !currentContainer) return;
        const sb = featureEnabled.sidebar && Sidebar.el && Sidebar.el.parentElement === currentContainer;
        const ib = featureEnabled.infoBar && InfoBar.el && InfoBar.el.parentElement === currentContainer;

        const cs = getComputedStyle(currentInput);
        const padL = parseFloat(cs.paddingLeft) || 12;

        if (sb) { Sidebar.el.style.top = '0px'; Sidebar.el.style.paddingLeft = `${padL}px`; }
        if (ib) { InfoBar.el.style.top = sb ? '24px' : '1px'; InfoBar.el.style.paddingLeft = `${padL}px`; }

        if (!sb && !ib) {
            currentInput.style.removeProperty('padding-top');
            currentInput.style.removeProperty('min-height');
            resetDashboardBarMotion();
            return;
        }
        let pad = 6;
        if (sb) pad += 24;
        if (ib) pad += 22;
        currentInput.style.setProperty('padding-top', `${pad}px`, 'important');
        currentInput.style.setProperty('min-height', `${pad + 40}px`, 'important');
        scheduleDashboardScrollSync();
    }

    function refreshAll() {
        applyOfficialModelVisibility();
        if (featureEnabled.infoBar) InfoBar.render();
        if (featureEnabled.sidebar) Sidebar.render();
    }

    async function tick() {
        const { storyId, chatId, isChat } = getPathInfo();
        if (!isChat || !chatId) {
            stopDashboardScrollSync();
            InfoBar.unmount(); Sidebar.unmount();
            resetInputLayout(currentInput);
            currentInput = currentContainer = null;
            if (lastChatId) lastChatId = null;
            return;
        }

        if (!featureEnabled.infoBar && !featureEnabled.sidebar) {
            stopDashboardScrollSync();InfoBar.unmount();Sidebar.unmount();resetInputLayout(currentInput);
            return;
        }
        const inputEl = resolveInput();
        if (!inputEl) {
            stopDashboardScrollSync();
            InfoBar.unmount(); Sidebar.unmount();
            resetInputLayout(currentInput);
            currentInput = currentContainer = null;
            return;
        }
        if (currentInput && currentInput !== inputEl) {
            stopDashboardScrollSync();
            resetInputLayout(currentInput);
        }
        const container = findInputContainer(inputEl);
        currentInput = inputEl; currentContainer = container;
        ensurePosition(container);
        startDashboardScrollSync(inputEl);

        // 바 붙이기/떼기
        if (featureEnabled.infoBar) InfoBar.mount(container); else InfoBar.unmount();
        if (featureEnabled.sidebar) Sidebar.mount(container); else Sidebar.unmount();

        // 방 전환
        if (chatId !== lastChatId) {
            lastChatId = chatId;
            shared.chatId = chatId; shared.storyId = storyId;
            const roomDomCount = Core.messageCount();
            const cachedLogs = chatId ? loadRoomStatsCache(chatId, roomDomCount) : null;
            // 최근 캐시는 바로 재사용한다. 다른 기기/복귀 등으로 오래된 캐시만 raw messages API로 재검진한다.
            if (cachedLogs && (!cachedLogs.cachedAt || Date.now() - Number(cachedLogs.cachedAt || 0) > RAW_REMOTE_SYNC_TTL)) {
                cachedLogs.forceRawRefresh = true;
            }
            shared.logs = cachedLogs;
            if (chatId && cachedLogs) logCache[chatId] = cachedLogs;
            shared.cumulative = chatId ? (loadCumCache(chatId).sum || 0) : null; shared.meta = null; shared.currentModel = null;
            const generation = Core.epoch;
            shared.models = [];
            if (storyId) loadModels(storyId).then((ms) => { if(Core.epoch!==generation||Core.route().chatId!==chatId)return; shared.models = ms; Sidebar.refreshModelList(); refreshAll(); });
            if (chatId) fetchChatMeta(chatId).then((meta) => { if(Core.epoch!==generation||Core.route().chatId!==chatId)return; shared.meta = meta; shared.currentModel = detectCurrentModel(); refreshAll(); });
        }

        // 가용성 (무거운 DOM 스캔) — 관련 DOM 변화 또는 5초 간격일 때만
        const now = Date.now();
        if (shared.heavyStale || now - lastHeavyTime > HEAVY_SCAN_INTERVAL) refreshAvailability();

        // 잔여 크래커 (5s 스로틀)
        if (!busy.balance && now - lastBalanceTime > 5000) {
            busy.balance = true; lastBalanceTime = now;
            fetchBalance().then((q) => { shared.balance = q; busy.balance = false; refreshAll(); }).catch(() => { busy.balance = false; });
        }

        // 로그 (메시지 수 바뀔 때만 무거운 순회)
        if (featureEnabled.infoBar && isChat && chatId && !busy.logs) {
            const domCount = Core.messageCount();
            const cached = logCache[chatId];
            const rawStale = cached?.computed && Number(cached.cachedAt || 0) > 0 && now - Number(cached.cachedAt || 0) > RAW_REMOTE_SYNC_TTL;
            if (rawStale && document.visibilityState !== 'hidden') cached.forceRawRefresh = true;
            if (!cached || cached.domCount !== domCount || !cached.computed || cached.forceRawRefresh) {
                busy.logs = true;
                const generation = Core.epoch;
                calcRoomLogs(chatId, domCount).then((r) => {
                    busy.logs = false;
                    if (r && generation === Core.epoch && Core.route().chatId === chatId) {
                        shared.logs = r;
                        refreshAll();
                        // 사용/차감 크래커는 generate_done + crackers/history claim 경로만 갱신한다.
                        // 기존 timestamp 기반 자동 누적 계산은 history 중복 가산 위험이 있어 제거했다.
                        shared.cumulative = loadCumCache(chatId).sum || 0;
                    }
                }).catch(() => { busy.logs = false; });
            } else {
                shared.logs = cached;
            }
        }

        // 공식 모델 메뉴가 떠 있으면 목록/비용을 공식 DOM 기준으로 자동 동기화한다.
        // 모델 API 캐시가 오래됐거나 신규 모델 비용이 바뀐 경우에도 메뉴를 한 번 열면 85/58/50/20개 같은 실제 표시값으로 덮어쓴다.
        const harvested = harvestOfficialModels();
        if (harvested && harvested.length) {
            applyOfficialModelList(harvested, { persist: true, refreshSidebar: true });
            const selectedHarvested = harvested.find((m) => m.selected);
            if (selectedHarvested) {
                pendingModelName = '';
                pendingModelUntil = 0;
                shared.currentModel = findModelByName(selectedHarvested.name) || selectedHarvested;
            }
        }

        // 현재 모델
        shared.currentModel = detectCurrentModel() || shared.currentModel;

        refreshAll();
        applyLayout();

        if (featureEnabled.infoBar) InfoBar.reposition();
        if (featureEnabled.sidebar) Sidebar.reposition();
    }

    // 공식 모델 메뉴가 열려 있으면 거기서 목록 직접 수확 (추가/중단 자동 반영)
    function harvestOfficialModels() {
        const menus = document.querySelectorAll(SELECTOR.modelMenu);
        for (const menu of menus) {
            if (isOwnEl(menu)) continue;
            const items = menu.querySelectorAll(SELECTOR.menuItem);
            if (!items.length) continue;
            const list = [];
            for (const it of items) {
                const img = it.querySelector('img[src*="model-icon"]');
                if (!img) continue;
                const name = getOfficialModelName(it);
                if (!name) continue;
                let cost = null;
                for (const d of it.querySelectorAll('div, span')) {
                    const t = (d.textContent || '').trim();
                    if (/^\d[\d,]*개$/.test(t)) { cost = parseInt(t.replace(/[^\d]/g, ''), 10); break; }
                }
                let description = '';
                for (const d of it.querySelectorAll('div, span')) {
                    const t = (d.textContent || '').replace(/\s+/g, ' ').trim();
                    if (!t || t === name || /^\d[\d,]*개$/.test(t)) continue;
                    if (d.children.length === 0 && t.length >= 6) { description = t; break; }
                }
                list.push({
                    id: name,
                    name,
                    slug: fileNameOf(img.src).replace(/\.[a-z0-9]+$/i, ''),
                    cost,
                    icon: img.src,
                    description,
                    selected: isOfficialModelSelected(it),
                    recommended: /제작자\s*권장/.test(it.textContent || '') || Array.from(it.querySelectorAll('span')).some((span) => (span.textContent || '').trim() === '권장')
                });
            }
            if (list.length >= 2) return list;
        }
        return null;
    }

    function applyOfficialModelList(harvested, { persist = true, refreshSidebar = true } = {}) {
        if (!harvested || !harvested.length) return false;
        const prevByName = new Map((shared.models || []).map((m) => [m.name, m]));
        const officialOnly = harvested.map((m) => {
            const prev = prevByName.get(m.name) || {};
            return {
                ...prev,
                ...m,
                // 이름은 공식 메뉴 alt/text가 최우선. id는 기존 API id가 있으면 보존해서 방 메타 매칭을 돕는다.
                id: prev.id || m.id || m.name,
                slug: prev.slug || m.slug,
                cost: m.cost != null ? m.cost : prev.cost,
                icon: m.icon || prev.icon,
                description: m.description || prev.description,
                recommended: !!m.recommended,
                selected: !!m.selected,
                source: 'official-menu'
            };
        });
        if (modelListSignature(officialOnly) === modelListSignature(shared.models)) return false;
        shared.models = officialOnly;
        if (persist && shared.storyId) {
            try {
                const store = JSON.parse(localStorage.getItem(STORAGE.models) || '{}');
                // 공식 메뉴에 보이는 목록만 저장해 v3.0.37에서 섞인 숨김/중단 모델 캐시를 덮어쓴다.
                store[shared.storyId] = { models: officialOnly, ts: Date.now(), source: 'official-menu' };
                localStorage.setItem(STORAGE.models, JSON.stringify(store));
            } catch (e) {}
        }
        if (refreshSidebar) Sidebar.refreshModelList();
        return true;
    }

    function detectSelectedOfficialModel(models = shared.models || []) {
        if (!models.length) return null;
        const menus = document.querySelectorAll(SELECTOR.modelMenu);
        for (const menu of menus) {
            if (isOwnEl(menu)) continue;
            const items = menu.querySelectorAll(SELECTOR.menuItem);
            for (const it of items) {
                const img = it.querySelector('img[src*="model-icon"]');
                if (!img) continue;
                // 구 Menu는 fill-brand 체크, 신 Radix Select는 data-state=checked / aria-selected=true를 사용한다.
                const selected = isOfficialModelSelected(it);
                if (!selected) continue;
                const name = getOfficialModelName(it);
                const fn = fileNameOf(img.src);
                const slug = fn.replace(/\.[a-z0-9]+$/i, '');
                return models.find((m) => m.name === name)
                    || models.find((m) => m.icon && fileNameOf(m.icon) === fn)
                    || models.find((m) => m.slug === slug)
                    || null;
            }
        }
        return null;
    }

    function detectModelFromOfficialButton(models = shared.models || []) {
        if (!models.length) return null;
        const btn = getOfficialModelButton();
        if (!btn || isOwnEl(btn)) return null;

        // 닫힌 공식 모델 버튼은 현재 방에서 실제 선택된 모델의 아이콘/이름을 보여준다.
        const img = btn.querySelector(SELECTOR.modelIcon);
        if (img) {
            const fn = fileNameOf(img.src);
            if (fn) {
                const byIcon = models.find((m) => m.icon && fileNameOf(m.icon) === fn);
                if (byIcon) return byIcon;
            }
            const alt = (img.alt || '').trim();
            if (alt) {
                const byAlt = models.find((m) => alt.includes(m.name));
                if (byAlt) return byAlt;
            }
        }

        // 아이콘이 없으면 버튼 텍스트로 매칭하되, 짧은 이름이 긴 이름에 먼저 걸리지 않게 가장 긴 이름을 고른다.
        const text = (btn.textContent || '').trim();
        if (text) {
            let best = null;
            for (const m of models) {
                if (m.name && text.includes(m.name) && (!best || m.name.length > best.name.length)) best = m;
            }
            if (best) return best;
        }
        return null;
    }

    function detectCurrentModel() {
        const models = shared.models || [];
        if (!models.length) return null;

        if (pendingModelName && Date.now() < pendingModelUntil) {
            const pending = findModelByName(pendingModelName);
            if (pending) return pending;
        }

        const selectedFromMenu = detectSelectedOfficialModel(models);
        if (selectedFromMenu) {
            pendingModelName = '';
            pendingModelUntil = 0;
            return selectedFromMenu;
        }

        // 새로고침 직후 공식 모델창은 닫혀 있다. 이때 닫힌 공식 모델 버튼이
        // 현재 방에서 실제 선택된 모델을 보여주므로, meta 슬러그보다 먼저 신뢰한다.
        // (meta.crackerModel은 새로고침 후 권장/기본 모델로 돌아와 A 고착을 일으킬 수 있어 뒤로 둔다.)
        const fromButton = detectModelFromOfficialButton(models);
        if (fromButton) return fromButton;

        const slug = shared.meta && shared.meta.crackerModel;
        if (slug) {
            const norm = (s) => (s || '').toLowerCase().replace(/[_\s]/g, '');
            const m = models.find((x) => x.slug === slug || norm(x.slug) === norm(slug));
            if (m) return m;
        }

        // 마지막 폴백: 페이지 전체 model-icon 스캔.
        // 권장 모델 배너/카드의 아이콘을 먼저 잡아 권장 모델로 고착될 수 있어 가장 마지막에만 쓴다.
        for (const ic of document.querySelectorAll(SELECTOR.modelIcon)) {
            if (isOwnEl(ic) || ic.closest('[role="menuitem"]') || ic.closest('[role="dialog"]')) continue;
            const fn = fileNameOf(ic.src);
            if (fn) { const m = models.find((x) => x.icon && fileNameOf(x.icon) === fn); if (m) return m; }
            const m2 = models.find((x) => (ic.alt || '').includes(x.name));
            if (m2) return m2;
        }
        return null;
    }

    function forceRoomRawRefresh(chatId = shared?.chatId) {
        if (!chatId) return;
        const target = logCache[chatId] || shared.logs || loadRoomStatsCache(chatId, 0) || makeEmptyLogPrev(chatId);
        target.forceRawRefresh = true;
        target.computed = !!target.computed;
        logCache[chatId] = target;
        if (shared?.chatId === chatId) shared.logs = target;
    }

    function isRelevantMutationNode(node) {
        if (!(node instanceof Element)) return false;
        if (isOwnEl(node)) return false;
        try {
            return node.matches?.(RELEVANT_MUTATION_SELECTOR) || !!node.querySelector?.(RELEVANT_MUTATION_SELECTOR);
        } catch (e) {
            return false;
        }
    }

    function shouldHandleDashboardMutation(m) {
        const target = m.target?.nodeType === Node.ELEMENT_NODE ? m.target : m.target?.parentElement;
        if (target && isOwnEl(target)) return false;
        if (target && target.closest('.wrtn-markdown,[contenteditable="true"]')) return false;

        if (m.type === 'attributes') {
            return isRelevantMutationNode(target);
        }

        if (m.type === 'childList') {
            for (const node of [...m.addedNodes, ...m.removedNodes]) {
                if (isRelevantMutationNode(node)) return true;
            }
            // 라우트 전환/입력창 교체는 body/main 쪽 childList만 보고도 한 번 갱신한다.
            return target === document.body || target?.tagName === 'MAIN' || target?.id === 'root' || target?.id === '__next';
        }

        return false;
    }

    let lastTickTime = 0;
    function scheduleUpdate() {
        const now = Date.now();
        // 마지막 업데이트 후 500ms가 지났다면 다른 확프의 변화를 무시하고 강제 실행
        if (now - lastTickTime > 500) {
            lastTickTime = now;
            clearTimeout(updateTimer);
            Promise.resolve(tick()).catch((e) => console.debug('[대시보드] tick 실패:', e));
            return;
        }

        clearTimeout(updateTimer);
        updateTimer = setTimeout(() => {
            lastTickTime = Date.now();
            Promise.resolve(tick()).catch((e) => console.debug('[대시보드] tick 실패:', e));
        }, 120);
    }

    function startObserver() {
        if (observer) return;
        observer = Core.on('mutations',muts=>{
            if (!featureEnabled.infoBar && !featureEnabled.sidebar) return;
            if (!muts.some(shouldHandleDashboardMutation)) return;
            shared.heavyStale = true;scheduleUpdate();
        });
    }

    function handleOfficialModelPick(target) {
        const item = target?.closest?.(SELECTOR.menuItem);
        if (!item || isOwnEl(item) || item.disabled || item.getAttribute('aria-disabled') === 'true') return false;
        if (!item.closest(SELECTOR.modelMenu)) return false;
        const img = item.querySelector('img[src*="model-icon"]');
        if (!img) return false;
        const pickedName = getOfficialModelName(item);
        if (!pickedName) return false;
        const harvested = harvestOfficialModels();
        if (harvested && harvested.length) applyOfficialModelList(harvested, { persist: true, refreshSidebar: true });
        markModelSelectionPending(pickedName);
        requestModelResync();
        setTimeout(scheduleUpdate, 450);
        setTimeout(scheduleUpdate, 1200);
        return true;
    }

    function bindGlobalEvents() {
        const resyncAfterReturn = () => {
            const { chatId, isChat } = getPathInfo();
            if (isChat && chatId) {
                const cached = logCache[chatId] || loadRoomStatsCache(chatId, 0);
                if (!cached?.cachedAt || Date.now() - Number(cached.cachedAt || 0) > RAW_REMOTE_SYNC_TTL) {
                    forceRoomRawRefresh(chatId);
                }
            }
            scheduleUpdate();
            setTimeout(scheduleUpdate, 900);
        };
        window.addEventListener('pageshow', resyncAfterReturn);
        window.addEventListener('focus', resyncAfterReturn);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) resyncAfterReturn(); });
        try {
            getLoreWindow().addEventListener?.('LoreInj:ready', () => {
                shared.heavyStale = true;
                scheduleUpdate();
                setTimeout(scheduleUpdate, 700);
                setTimeout(scheduleUpdate, 2200);
            });
        } catch (e) {}
        document.addEventListener('click', (e) => {
            // 공식 모델 선택은 아래 capture pointerup에서 우선 처리하고, click은 폴백으로만 한 번 더 확인한다.
            handleOfficialModelPick(e.target);

            // InfoBar 메뉴
            const ibBtn = InfoBar.settingsBtn?.();
            const ibMenu = document.getElementById('chud-info-menu');
            if (ibMenu && ibMenu.style.display === 'flex' && !ibBtn?.contains(e.target) && !ibMenu.contains(e.target)) ibMenu.style.display = 'none';

            // Sidebar 드롭다운/메뉴
            const sbDrop = Sidebar.dropdownEl?.();
            const sbMenu = Sidebar.menuEl?.();
            const sbModelBtn = Sidebar.modelBtn?.();
            const sbSetBtn = Sidebar.settingsBtn?.();
            if (sbDrop && sbDrop.style.display === 'flex' && !sbModelBtn?.contains(e.target) && !sbDrop.contains(e.target)) sbDrop.style.display = 'none';
            if (sbMenu && sbMenu.style.display === 'flex' && !sbSetBtn?.contains(e.target) && !sbMenu.contains(e.target)) sbMenu.style.display = 'none';

            // 유저 노트 다이얼로그 바깥 클릭 시 닫기 (원본 동작 유지)
            const dialogs = document.querySelectorAll('[role="dialog"]');
            if (dialogs.length === 1) {
                const d = dialogs[0];
                if (d.textContent.includes('유저 노트') && !d.contains(e.target)) {
                    const close = d.querySelector('button[aria-label="닫기"], button[aria-label*="Close"]');
                    if (close) { e.preventDefault(); e.stopPropagation(); setTimeout(() => close.click(), 50); }
                }
            }
        });

        Core.on('keydown', (e) => {
            const target = e.target;
            if (!target || isOwnEl(target)) return;
            const inputEl = target.matches?.(SELECTOR.input) ? target : target.closest?.(SELECTOR.input);
            if (!inputEl || !isVisibleInputCandidate(inputEl)) return;
            if (currentInput && inputEl !== currentInput) return;
            if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
            const { chatId, isChat } = getPathInfo();
            if (isChat && chatId) startGenerationSession(chatId);
        });

        document.addEventListener('pointerdown', (e) => {
            const target = e.target;
            if (!target || isOwnEl(target)) return;
            const btn = target.closest?.('button, [role="button"]');
            if (!btn || !isVisibleClickable(btn)) return;
            const { chatId, isChat } = getPathInfo();
            if (isChat && chatId) startGenerationSession(chatId);
        }, true);

        // 공식 모델 메뉴는 Radix라서 선택 즉시 메뉴가 닫히며 menuitem이 DOM에서 떨어진다.
        // 그러면 document까지 버블되는 click을 놓쳐 동기화가 늦는다.
        // capture 단계 pointerup은 Radix가 메뉴를 닫기 전에 먼저 잡혀 선택을 안정적으로 감지한다.
        document.addEventListener('pointerup', (e) => {
            if (!e.target || isOwnEl(e.target)) return;
            handleOfficialModelPick(e.target);
        }, true);

        window.addEventListener('storage', (e) => {
            if (!shared?.chatId) return;
            if (e.key === STORAGE.cumPrefix + shared.chatId) {
                shared.cumulative = loadCumCache(shared.chatId).sum || 0;
                refreshAll();
            }
            if (e.key === getLastDiffKey(shared.chatId)) {
                refreshAll();
            }
        });

        const hideFloats = () => {
            const ibMenu = document.getElementById('chud-info-menu'); if (ibMenu) ibMenu.style.display = 'none';
            Sidebar.hideAll?.();
        };
        window.addEventListener('scroll', (e) => {
            // 긴 모델 편집 목록 자체를 스크롤할 때는 창을 닫지 않는다.
            if (e.target instanceof Element && e.target.closest('#chud-side-dropdown, #chud-side-menu, #chud-info-menu')) return;
            hideFloats();
        }, true);
        window.addEventListener('resize', hideFloats);
    }

    /* =========================================================
     * 10. 템퍼몽키 메뉴 (즉시 ON/OFF)
     * =======================================================*/
    let menuHandles = [];
    function clearMenus() {
        if (typeof GM_unregisterMenuCommand === 'function') {
            for (const h of menuHandles) { try { GM_unregisterMenuCommand(h); } catch (e) {} }
        }
        menuHandles = [];
    }
    function registerMenus() {
        clearMenus();
        if (typeof GM_registerMenuCommand !== 'function') return;
        const add = (label, fn) => { try { menuHandles.push(GM_registerMenuCommand(label, fn)); } catch (e) {} };
        add(`📊 턴·크래커 바: ${featureEnabled.infoBar ? '켜짐 ✅' : '꺼짐 ⛔'}`, () => toggleFeature('infoBar'));
        add(`📱 미니 사이드바: ${featureEnabled.sidebar ? '켜짐 ✅' : '꺼짐 ⛔'}`, () => toggleFeature('sidebar'));
        add(`💰 목록 크래커 표시: ${featureEnabled.listCracker ? '켜짐 ✅' : '꺼짐 ⛔'}`, () => toggleFeature('listCracker'));
    }
    function toggleFeature(key) {
        featureEnabled[key] = !featureEnabled[key];
        saveFeat(key, featureEnabled[key]);
        if (key === 'infoBar') {
            if (featureEnabled.infoBar && currentContainer) InfoBar.mount(currentContainer);
            else InfoBar.unmount();
        }
        if (key === 'sidebar') {
            if (featureEnabled.sidebar && currentContainer) Sidebar.mount(currentContainer);
            else Sidebar.unmount();
        }
        if (key === 'listCracker') {
            if (featureEnabled.listCracker) { injectListCrackerStyle(); scheduleListCrackerUpdate(0); }
            else document.querySelectorAll('.chud-list-cracker').forEach((el) => el.remove());
        }
        applyLayout();
        refreshAll();
        registerMenus();
        scheduleUpdate();
    }

    function hookHistoryForUpdate() { Core.on('route',scheduleUpdate);Core.on('editor',scheduleUpdate); }

    /* =========================================================
     * 목록 크래커 뱃지
     * =======================================================*/
    let listCrackerTimer = null;

    function injectListCrackerStyle() {
        if (document.getElementById('chud-list-cracker-style')) return;
        const s = document.createElement('style');
        s.id = 'chud-list-cracker-style';
        s.textContent = `
            .chud-list-cracker {
                position: static; z-index: auto;
                display: inline-flex; align-items: center; gap: 2px;
                flex: 0 0 auto; min-width: 0; max-width: 58px;
                margin-left: 4px; padding: 0; border-radius: 0;
                font-size: 10px; font-weight: 700; line-height: 1;
                pointer-events: none; white-space: nowrap;
                overflow: hidden; text-overflow: ellipsis;
                background: transparent; color: rgba(255,255,255,0.50);
                box-shadow: none; opacity: .72;
                transform: translateY(0.5px);
                font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
            }
            body[data-theme="light"] .chud-list-cracker {
                background: transparent; color: rgba(80,60,42,0.58);
                box-shadow: none;
            }
            .chud-list-cracker svg { width: 9.5px; height: 9.5px; display: block; flex-shrink: 0; opacity: .82; }
            .chud-list-cracker span { overflow: hidden; text-overflow: ellipsis; }
            a[href*="/episodes/"]:hover .chud-list-cracker { display: none !important; }
        `;
        (document.head || document.documentElement).appendChild(s);
    }

    function getListCrackerSvg() {
        return `<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="${CRACKER_PATH}"></path></svg>`;
    }

    function extractEpisodeIdFromHref(href) {
        const m = String(href || '').match(/\/episodes\/([a-f0-9]+)/i);
        return m ? m[1] : '';
    }

    function findListCrackerMetaRow(link) {
        // 순정 목록: 요약/날짜가 들어있는 2번째 줄에 끼워 넣는다.
        // direct child absolute 배치보다 레이아웃 흐름 안에 들어가서 덜 붕 뜬다.
        const date = link.querySelector('.chat-update-date-label');
        if (date?.parentElement) return date.parentElement;

        const rows = Array.from(link.querySelectorAll('div'));
        for (const row of rows) {
            if (!(row instanceof HTMLElement)) continue;
            const cs = getComputedStyle(row);
            if (cs.display !== 'flex') continue;
            const hasMutedEllipsis = Array.from(row.children).some((child) => {
                if (!(child instanceof HTMLElement) || child.tagName !== 'SPAN') return false;
                const cls = String(child.className || '');
                return /text-muted-foreground|text-ellipsis|line-clamp|chat-update-date-label/i.test(cls);
            });
            if (hasMutedEllipsis) return row;
        }
        return null;
    }

    function updateListCrackerBadges() {
        if (!featureEnabled.listCracker) {
            document.querySelectorAll('.chud-list-cracker').forEach((el) => el.remove());
            return;
        }
        const links = document.querySelectorAll('a[href*="/episodes/"]');
        for (const link of links) {
            if (isOwnEl(link)) continue;
            const chatId = extractEpisodeIdFromHref(link.getAttribute('href'));
            if (!chatId) continue;

            const sum = loadCumCache(chatId).sum || 0;
            let badge = link.querySelector('.chud-list-cracker');

            if (sum <= 0) { if (badge) badge.remove(); continue; }

            const metaRow = findListCrackerMetaRow(link);
            if (!metaRow) { if (badge) badge.remove(); continue; }

            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'chud-list-cracker';
            }
            const date = metaRow.querySelector(':scope > .chat-update-date-label');
            if (badge.parentElement !== metaRow) metaRow.insertBefore(badge, date || null);

            const text = sum.toLocaleString();
            if (badge.dataset.sum !== text) {
                badge.dataset.sum = text;
                badge.innerHTML = `${getListCrackerSvg()}<span>${text}</span>`;
            }
        }
    }

    function scheduleListCrackerUpdate(delay = 150) {
        if (!featureEnabled.listCracker) return;
        clearTimeout(listCrackerTimer);
        listCrackerTimer = setTimeout(updateListCrackerBadges, delay);
    }

    function startListCrackerObserver() {
        Core.on('mutations',muts=>{
            if (!featureEnabled.listCracker) return;
            for (const m of muts) {
                if(m.target instanceof Element&&m.target.closest('.chud-list-cracker'))continue;
                for(const n of m.addedNodes){
                    if(!(n instanceof Element))continue;
                    if(n.matches('a[href*="/episodes/"]')||n.querySelector('a[href*="/episodes/"]')){scheduleListCrackerUpdate();return;}
                }
            }
        });
    }

    /* =========================================================
     * 부팅
     * =======================================================*/
    injectStyle();
    injectModelHideStyle();
    bindGlobalEvents();
    hookHistoryForUpdate();
    watchGenerateDone();
    registerMenus();
    startObserver();
    injectListCrackerStyle();
    startListCrackerObserver();
    scheduleListCrackerUpdate(300);
    Core.on('maintenance',()=>{if(Core.editor&&((featureEnabled.infoBar&&!InfoBar.el?.isConnected)||(featureEnabled.sidebar&&!Sidebar.el?.isConnected)))scheduleUpdate();});
    Core.on('layout',()=>{applyLayout();InfoBar.reposition();Sidebar.reposition();});
    scheduleUpdate();
})();

// ===== output model mirror module =====
// 채팅 모델 편집의 숨김 목록을 출력 길이/추론 설정에도 그대로 적용한다.
(() => {
  const TITLE = '답변 길이 및 생각 조절';
  const STORAGE_KEY = 'chud_hidden_models_v1';
  const HIDDEN_CLASS = 'chub-output-model-hidden';
  const normalize = text => String(text || '').replace(/\s+/g,' ').trim();
  let hidden = loadHidden();
  let currentDialog = null;

  function loadHidden() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return new Set(Array.isArray(raw) ? raw.filter(name => typeof name === 'string') : []);
    } catch (_) { return new Set(); }
  }

  function modelRows(dialog) {
    if (!(dialog instanceof HTMLElement) || !dialog.isConnected ||
        dialog.getAttribute('role') !== 'dialog' || dialog.getAttribute('data-state') === 'closed') return null;
    const title = [...dialog.children].some(child => normalize(child.querySelector?.('h2')?.textContent) === TITLE);
    if (!title) return null;

    let best = null;
    for (const root of dialog.querySelectorAll('div[data-orientation="vertical"]')) {
      const rows = []; let iconCount = 0, collectionCount = 0;
      for (const item of root.children) {
        const heading = [...item.children].find(child => child.tagName === 'H3');
        const trigger = heading && [...heading.children].find(child =>
          child.tagName === 'BUTTON' && child.hasAttribute('aria-expanded') &&
          child.getAttribute('data-orientation') === 'vertical');
        if (!trigger) continue;
        const nameNode = [...trigger.children].find(child => child.tagName === 'SPAN' && child.classList.contains('flex-1')) ||
          [...trigger.children].find(child => child.tagName === 'SPAN');
        const name = normalize(nameNode?.textContent);
        if (!name) continue;
        if ([...trigger.children].some(child => child.tagName === 'IMG')) iconCount++;
        if (trigger.hasAttribute('data-radix-collection-item')) collectionCount++;
        rows.push({item,name});
      }
      if (rows.length < 3 || iconCount / rows.length < .6 || collectionCount / rows.length < .6) continue;
      if (!best || rows.length > best.length) best = rows;
    }
    return best;
  }

  function apply(dialog) {
    const rows = modelRows(dialog);
    if (!rows) return;
    currentDialog = dialog;
    for (const {item,name} of rows) {
      const shouldHide = hidden.has(name);
      if (item.classList.contains(HIDDEN_CLASS) !== shouldHide) item.classList.toggle(HIDDEN_CLASS,shouldHide);
    }
  }
  function applyOpen() {
    hidden = loadHidden();
    if (currentDialog?.isConnected) apply(currentDialog);
    else for (const dialog of document.querySelectorAll('[role="dialog"][data-state="open"]')) apply(dialog);
  }

  const style = document.createElement('style');
  style.id = 'chub-output-model-mirror-style';
  style.textContent = `.${HIDDEN_CLASS}{display:none!important}`;
  (document.head || document.documentElement).appendChild(style);

  Core.on('mutations',records => {
    const dialogs = new Set();
    for (const mutation of records) {
      const target = mutation.target instanceof Element ? mutation.target : null;
      const owner = target?.closest('[role="dialog"]');
      if (owner) dialogs.add(owner);
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('[role="dialog"]')) dialogs.add(node);
        for (const dialog of node.querySelectorAll('[role="dialog"]')) dialogs.add(dialog);
      }
    }
    if (currentDialog && !currentDialog.isConnected) currentDialog = null;
    for (const dialog of dialogs) apply(dialog);
  });
  Core.on('model-visibility',applyOpen);
  Core.on('route',() => {currentDialog = null;});
  window.addEventListener('storage',event => {if (event.key === STORAGE_KEY) applyOpen();});
  applyOpen();
})();

// ===== radiosonde module =====
(() => {
  "use strict";

  const YAME_MODELS = [
    { slug: "yame-fable5", apiId: "fable5", source: "yame", label: "Fable 5.0", short: "F5" },
  ];

  const FALLBACK_MODELS = [
    { slug: "claude-fable-5.1", source: "igx", label: "Claude Fable 5.1", short: "F5.1" },
    { slug: "claude-opus-5", source: "igx", label: "Claude Opus 5", short: "O5" },
    { slug: "claude-opus-4.8", source: "igx", label: "Claude Opus 4.8", short: "O4.8" },
    { slug: "claude-opus-4.7", source: "igx", label: "Claude Opus 4.7", short: "O4.7" },
    { slug: "claude-opus-4.6", source: "igx", label: "Claude Opus 4.6", short: "O4.6" },
    { slug: "claude-sonnet-5", source: "igx", label: "Claude Sonnet 5", short: "S5" },
    { slug: "gemini-3.1-pro-preview", source: "igx", label: "Gemini 3.1 Pro Preview", short: "G3.1P" },
    { slug: "gemini-2.5-pro", source: "igx", label: "Gemini 2.5 Pro", short: "G2.5P" },
    { slug: "gemini-3.6-flash", source: "igx", label: "Gemini 3.6 Flash", short: "G3.6F" },
    { slug: "gemini-3.5-flash", source: "igx", label: "Gemini 3.5 Flash", short: "G3.5F" },
    { slug: "gemini-3.5-flash-lite", source: "igx", label: "Gemini 3.5 Flash Lite", short: "G3.5FL" },
    { slug: "gpt-5.6-sol", source: "igx", label: "ChatGPT 5.6 Sol", short: "G5.6S" },
    { slug: "gpt-5.6-terra", source: "igx", label: "ChatGPT 5.6 Terra", short: "G5.6T" },
    { slug: "gpt-5.6-luna", source: "igx", label: "ChatGPT 5.6 Luna", short: "G5.6L" },
  ];

  const EXCLUDED_MODELS = new Set([
    "gemini-3-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ]);

  const NON_MODEL_SLUGS = new Set([
    "statistics", "statistic", "stats",
    "status", "state", "health",
    "summary", "overview",
    "data", "result", "results",
    "models", "model",
    "metrics", "metric",
    "history", "latest", "current",
    "latency", "score", "tps",
    "api", "meta", "metadata",
  ]);

  function slugLooksValid(value) {
    return /^[a-z0-9][a-z0-9._-]*$/i.test(String(value || "").trim());
  }

  function looksLikeModelSlug(value) {
    const slug = String(value || "").trim().toLowerCase();
    if (!slugLooksValid(slug)) return false;
    if (EXCLUDED_MODELS.has(slug) || NON_MODEL_SLUGS.has(slug)) return false;
    if (!slug.includes("-") || !/\d/.test(slug)) return false;
    if (/^(?:api|stats?|statistics|status|summary|metrics?|history|latest|current|health|data|results?)-/i.test(slug)) return false;
    return true;
  }

  const MODEL_OVERRIDES = new Map(
    FALLBACK_MODELS.map(model => [model.slug, model])
  );

  let MODELS = [];

  const IGX_BASE_URL = "https://rs.igx.kr";

  const YAME_STATUS_URL = "https://claude-radiosonde.chyoyam.chatgpt.site/api/v1/status";
  const POLL_MS = 60 * 1000;
  const VALID_STATUSES = new Set(["active", "degraded", "impacted"]);

  const STORE_KEY_VISIBILITY = "igx_rs_popup_vis_v3";
  const STORE_KEY_MODELS = "igx_rs_models_v3";
  const STORE_KEY_HOME_CHECK = "igx_rs_home_check_v1";
  const HOME_CHECK_MS = 30 * 60 * 1000;
  const STORE_KEY_LATENCY = "igx_rs_show_latency_v1";

  function isIgxChatRoomPage() { return Core.route().isChat; }

  GM_addStyle(`
    #igx-live-popup,
    #igx-live-settings {
      --text-title: rgba(255, 255, 255, .85);
      --text-name: rgba(255, 255, 255, .88);
      --text-unknown: rgba(255, 255, 255, .72);
      --btn-border: rgba(255, 255, 255, .14);
      --btn-bg: rgba(255, 255, 255, .06);
      --btn-bg-hover: rgba(255, 255, 255, .12);
      --panel-bg: rgba(20, 20, 20, .96);
      --panel-border: rgba(255, 255, 255, .14);
      --row-border: rgba(255, 255, 255, .09);
      --c-active: #3ddc84;
      --c-degraded: #ffd54a;
      --c-impacted: #ff5c5c;
      --c-unknown: #9aa0a6;
      --y-score-excellent: #74c78f;
      --y-score-good: #74c78f;
      --y-score-fair: #aaa06b;
      --y-score-poor: #ce875f;
      --y-score-error: #ef655c;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", Arial;
      color: var(--text-title);
      box-sizing: border-box;
    }

    #igx-live-popup.igx-light,
    #igx-live-settings.igx-light {
      --text-title: rgba(0, 0, 0, .85);
      --text-name: rgba(0, 0, 0, .82);
      --text-unknown: rgba(0, 0, 0, .62);
      --btn-border: rgba(0, 0, 0, .13);
      --btn-bg: rgba(0, 0, 0, .05);
      --btn-bg-hover: rgba(0, 0, 0, .10);
      --panel-bg: rgba(250, 250, 250, .97);
      --panel-border: rgba(0, 0, 0, .14);
      --row-border: rgba(0, 0, 0, .09);
      --c-active: #1da851;
      --c-degraded: #d49500;
      --c-impacted: #e03535;
      --c-unknown: #7b8086;
      --y-score-excellent: #2f8f50;
      --y-score-good: #2f8f50;
      --y-score-fair: #897d35;
      --y-score-poor: #b85e2d;
      --y-score-error: #d9433b;
    }

    .igx-inline-overlay-host {
      position: relative !important;
    }

    #igx-live-popup {
      position: absolute !important;
      top: 6px !important;
      left: 0 !important;
      right: 0 !important;
      width: auto !important;
      max-width: none !important;
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      transform: none !important;
      z-index: 3 !important;
      overflow: visible !important;
      pointer-events: none !important;
      user-select: none;
    }

    #igx-live-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      min-height: 18px;
      padding: 0 4px;
      gap: 4px;
      pointer-events: auto;
      box-sizing: border-box;
    }

    #igx-live-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
      overflow: hidden;
    }

    #igx-live-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      flex: 0 0 auto;
    }

    .inline-icon {
      display: block;
      width: 14px;
      height: 14px;
      opacity: .6;
      margin-right: 2px;
      color: var(--text-title);
      flex: 0 0 auto;
    }

    .igx-btn {
      width: 18px;
      height: 18px;
      min-width: 18px;
      padding: 0;
      border-radius: 7px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-title);
      cursor: pointer;
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: 13px;
      line-height: 1;
      opacity: .65;
      box-sizing: border-box;
    }

    .igx-btn:hover,
    .igx-btn:focus-visible {
      background: var(--btn-bg-hover);
      border-color: var(--btn-border);
      opacity: 1;
      outline: none;
    }

    #igx-live-barline {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex: 1;
      white-space: nowrap;
      color: var(--text-unknown);
      font-size: 11px;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }

    #igx-live-barline::-webkit-scrollbar { display: none; }

    .bitem {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 1px 2px;
      min-height: 0;
      flex: 0 0 auto;
    }

    .bname {
      opacity: 1;
      font-weight: 700;
      color: var(--text-title);
      line-height: 1;
    }

    .bscore {
      font-weight: 900;
      line-height: 1;
    }

    .blat {
      opacity: .75;
      color: var(--text-name);
      line-height: 1;
    }

    .bdot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      display: inline-block;
      flex: 0 0 auto;
    }

    .b-active .bdot { background: var(--c-active); }
    .b-active .bscore { color: var(--c-active); }
    .b-degraded .bdot { background: var(--c-degraded); }
    .b-degraded .bscore { color: var(--c-degraded); }
    .b-impacted .bdot { background: var(--c-impacted); }
    .b-impacted .bscore { color: var(--c-impacted); }
    .b-unknown .bdot { background: var(--c-unknown); }
    .b-unknown .bscore { color: var(--text-unknown); }

    .y-score-excellent .bscore { color: var(--y-score-excellent) !important; }
    .y-score-excellent .bdot { background: var(--y-score-excellent) !important; }
    .y-score-good .bscore { color: var(--y-score-good) !important; }
    .y-score-good .bdot { background: var(--y-score-good) !important; }
    .y-score-fair .bscore { color: var(--y-score-fair) !important; }
    .y-score-fair .bdot { background: var(--y-score-fair) !important; }
    .y-score-poor .bscore { color: var(--y-score-poor) !important; }
    .y-score-poor .bdot { background: var(--y-score-poor) !important; }
    .y-score-error .bscore { color: var(--y-score-error) !important; }
    .y-score-error .bdot { background: var(--y-score-error) !important; }

    #igx-live-settings {
      display: none;
      position: fixed;
      z-index: 2147483000;
      width: min(390px, calc(100vw - 16px));
      max-height: min(480px, 72vh);
      overflow-y: auto;
      padding: 10px;
      border: 1px solid var(--panel-border);
      border-radius: 12px;
      background: var(--panel-bg);
      box-shadow: 0 12px 34px rgba(0, 0, 0, .34);
      backdrop-filter: blur(10px);
      pointer-events: auto;
      user-select: none;
      box-sizing: border-box;
    }

    #igx-live-settings.open { display: block; }

    .igx-settings-title {
      margin: 0 0 6px;
      font-size: 12px;
      font-weight: 800;
      color: var(--text-title);
    }

    .igx-settings-desc {
      margin: 0 0 8px;
      font-size: 10px;
      color: var(--text-unknown);
    }

    .igx-settings-divider {
      height: 1px;
      margin: 6px 0 8px;
      background: var(--row-border);
    }

    .igx-set-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 28px;
      padding: 3px 2px;
      border-bottom: 1px solid var(--row-border);
      font-size: 11px;
      color: var(--text-name);
      box-sizing: border-box;
    }

    .igx-set-row:last-child { border-bottom: none; }

    .igx-set-label {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      flex: 1;
      cursor: pointer;
    }

    .igx-set-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .igx-set-chk {
      width: 15px;
      height: 15px;
      margin: 0;
      accent-color: #3ddc84;
      cursor: pointer;
      flex: 0 0 auto;
    }

    .igx-model-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 10px;
      align-items: start;
    }

    .igx-model-group {
      min-width: 0;
      padding: 6px 7px 4px;
      border: 1px solid var(--row-border);
      border-radius: 9px;
      background: var(--btn-bg);
      box-sizing: border-box;
    }

    .igx-model-group-title {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 2px;
      padding: 0 1px 4px;
      border-bottom: 1px solid var(--row-border);
      color: var(--text-title);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .1px;
      cursor: pointer;
    }

    .igx-group-chk {
      width: 13px;
      height: 13px;
      margin: 0;
      accent-color: #3ddc84;
      cursor: pointer;
      flex: 0 0 auto;
    }

    .igx-model-group .igx-set-row {
      min-height: 25px;
      padding: 3px 1px;
      border-bottom: none;
    }

    .igx-model-group .igx-set-label {
      gap: 6px;
    }

    @media (max-width: 600px) {
      #igx-live-head { padding: 0 4px 2px; }
      #igx-live-barline { gap: 4px; }
      .bitem { gap: 5px; }
      .bname, .bscore, .blat { font-size: 11px; letter-spacing: -.3px; }
      #igx-live-settings { padding: 9px; }
      .igx-model-grid { gap: 7px 8px; }
      .igx-model-group { padding: 5px 6px 3px; }
      .igx-model-group .igx-set-row { font-size: 10.5px; }
    }
  `);

  const popup = document.createElement("div");
  popup.id = "igx-live-popup";
  popup.className = "inline";
  // 입력 박스 바로 위의 별도 줄: 대시보드·모바일 폭·펼치기와 간섭하지 않는다.
  popup.style.cssText='position:relative!important;top:auto!important;left:auto!important;right:auto!important;width:100%!important;max-width:100%!important;margin:0 0 4px!important;box-sizing:border-box!important;flex-shrink:0!important';
  popup.dataset.igxStableInlineHost = "1";

  const head = document.createElement("div");
  head.id = "igx-live-head";

  const left = document.createElement("div");
  left.id = "igx-live-left";

  const inlineIcon = document.createElement("div");
  inlineIcon.className = "inline-icon";
  inlineIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:100%;height:100%;"><path d="M2 12h4l2.25-11.25a.5.5 0 0 1 .98 0l4.54 22.5a.5.5 0 0 0 .98 0L17 12h5"/></svg>`;

  const barline = document.createElement("div");
  barline.id = "igx-live-barline";
  barline.textContent = "불러오는 중…";

  left.append(inlineIcon, barline);

  const actions = document.createElement("div");
  actions.id = "igx-live-actions";

  const btnRefresh = document.createElement("button");
  btnRefresh.className = "igx-btn";
  btnRefresh.type = "button";
  btnRefresh.title = "갱신";
  btnRefresh.setAttribute("aria-label", "라디오존데 갱신");
  btnRefresh.textContent = "↻";

  const btnSettings = document.createElement("button");
  btnSettings.className = "igx-btn";
  btnSettings.type = "button";
  btnSettings.title = "표시 설정";
  btnSettings.setAttribute("aria-label", "라디오존데 표시 설정");
  btnSettings.textContent = "⚙";

  actions.append(btnRefresh, btnSettings);
  head.append(left, actions);
  popup.appendChild(head);

  const settingsArea = document.createElement("div");
  settingsArea.id = "igx-live-settings";
  settingsArea.setAttribute("role", "dialog");
  settingsArea.setAttribute("aria-label", "라디오존데 표시 설정");

  let visibility = {};
  try {
    visibility = JSON.parse(localStorage.getItem(STORE_KEY_VISIBILITY)) || {};
  } catch {}

  // 4.2.0 이전 YAME Opus 항목은 더 이상 제공되지 않으므로 저장된 표시 설정에서도 정리한다.
  delete visibility["yame-opus5"];
  delete visibility["yame-opus48"];

  let showLatency = localStorage.getItem(STORE_KEY_LATENCY) !== "0";
  const last = new Map();

  const MODEL_GROUPS = [
    { id: "fable", label: "Fable" },
    { id: "opus", label: "Opus" },
    { id: "gemini", label: "Gemini" },
    { id: "sonnet", label: "Sonnet" },
    { id: "gpt", label: "GPT" },
    { id: "haiku", label: "Haiku" },
    { id: "other", label: "기타" },
  ];

  function modelGroupId(model) {
    const text = `${model?.slug || ""} ${model?.label || ""}`.toLowerCase();
    if (text.includes("fable")) return "fable";
    if (text.includes("opus")) return "opus";
    if (text.includes("gpt") || text.includes("openai")) return "gpt";
    if (text.includes("gemini")) return "gemini";
    if (text.includes("sonnet")) return "sonnet";
    if (text.includes("haiku")) return "haiku";
    return "other";
  }

  function settingsModelLabel(model, groupId) {
    if (model?.source === "yame" && model?.apiId === "fable5") return "Fable 5.0";

    const { version, descriptors } = parseSlug(model?.slug);
    const shownVersion = /^\d+$/.test(version) ? `${version}.0` : version;

    if (groupId === "fable" && shownVersion) return `Fable ${shownVersion}`;
    if (groupId === "opus" && shownVersion) return `Opus ${shownVersion}`;
    if (groupId === "sonnet" && shownVersion) return `Sonnet ${shownVersion}`;
    if (groupId === "haiku" && shownVersion) return `Haiku ${shownVersion}`;
    if (groupId === "gpt" && shownVersion) {
      const suffix = descriptors
        .filter(value => !["gpt", "openai"].includes(value))
        .map(titleWord)
        .join(" ");
      return `GPT ${shownVersion}${suffix ? ` ${suffix}` : ""}`;
    }

    if (groupId === "gemini" && shownVersion) {
      const suffix = descriptors
        .filter(value => !["gemini"].includes(value))
        .map(titleWord)
        .join(" ");
      return `Gemini ${shownVersion}${suffix ? ` ${suffix}` : ""}`;
    }

    return model?.label || model?.slug || "Model";
  }

  function syncGroupCheckbox(check, models) {
    const enabledCount = models.reduce((count, model) =>
      count + (visibility[model.slug] !== false ? 1 : 0), 0);

    check.checked = enabledCount === models.length;
    check.indeterminate = enabledCount > 0 && enabledCount < models.length;
    check.setAttribute("aria-checked", check.indeterminate ? "mixed" : String(check.checked));
  }

  function buildModelToggleRow(model, groupId, onVisibilityChanged) {
    if (visibility[model.slug] === undefined) visibility[model.slug] = true;

    const row = document.createElement("div");
    row.className = "igx-set-row";

    const label = document.createElement("label");
    label.className = "igx-set-label";
    label.title = `${model.label} (${model.slug})`;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "igx-set-chk";
    check.checked = visibility[model.slug];

    const labelText = document.createElement("span");
    labelText.className = "igx-set-text";
    labelText.textContent = settingsModelLabel(model, groupId);

    check.addEventListener("change", () => {
      visibility[model.slug] = check.checked;
      localStorage.setItem(STORE_KEY_VISIBILITY, JSON.stringify(visibility));
      if (typeof onVisibilityChanged === "function") onVisibilityChanged();
      renderBarline();
      nextRefreshAt=0;
    });

    label.append(check, labelText);
    row.appendChild(label);
    return row;
  }

  function buildModelUI() {
    const fragment = document.createDocumentFragment();

    const title = document.createElement("div");
    title.className = "igx-settings-title";
    title.textContent = "라디오존데 표시 설정";

    const desc = document.createElement("div");
    desc.className = "igx-settings-desc";
    desc.textContent = "입력창에 표시할 항목을 선택하세요.";

    const latencyRow = document.createElement("div");
    latencyRow.className = "igx-set-row";
    const latencyLabel = document.createElement("label");
    latencyLabel.className = "igx-set-label";
    const latencyCheck = document.createElement("input");
    latencyCheck.type = "checkbox";
    latencyCheck.className = "igx-set-chk";
    latencyCheck.checked = showLatency;
    const latencyText = document.createElement("span");
    latencyText.className = "igx-set-text";
    latencyText.textContent = "응답시간 표시";
    latencyLabel.append(latencyCheck, latencyText);
    latencyRow.appendChild(latencyLabel);
    latencyCheck.addEventListener("change", () => {
      showLatency = latencyCheck.checked;
      localStorage.setItem(STORE_KEY_LATENCY, showLatency ? "1" : "0");
      renderBarline();
      nextRefreshAt=0;
    });

    const divider = document.createElement("div");
    divider.className = "igx-settings-divider";

    const grouped = new Map(MODEL_GROUPS.map(group => [group.id, []]));
    for (const model of MODELS) {
      const groupId = modelGroupId(model);
      grouped.get(groupId).push(model);
    }

    const grid = document.createElement("div");
    grid.className = "igx-model-grid";

    for (const group of MODEL_GROUPS) {
      const models = grouped.get(group.id);
      if (!models?.length) continue;

      const section = document.createElement("section");
      section.className = "igx-model-group";

      for (const model of models) {
        if (visibility[model.slug] === undefined) visibility[model.slug] = true;
      }

      const heading = document.createElement("label");
      heading.className = "igx-model-group-title";
      heading.title = `${group.label} 그룹 전체 표시 전환`;

      const groupCheck = document.createElement("input");
      groupCheck.type = "checkbox";
      groupCheck.className = "igx-group-chk";
      groupCheck.setAttribute("aria-label", `${group.label} 그룹 전체 표시`);

      const groupText = document.createElement("span");
      groupText.textContent = group.label;

      const syncThisGroup = () => syncGroupCheckbox(groupCheck, models);
      syncThisGroup();

      groupCheck.addEventListener("change", () => {
        const enabled = groupCheck.checked;
        for (const model of models) visibility[model.slug] = enabled;
        localStorage.setItem(STORE_KEY_VISIBILITY, JSON.stringify(visibility));
        buildModelUI();
        renderBarline();
      });

      heading.append(groupCheck, groupText);
      section.appendChild(heading);

      for (const model of models) {
        section.appendChild(buildModelToggleRow(model, group.id, syncThisGroup));
      }

      grid.appendChild(section);
    }

    fragment.append(title, desc, latencyRow, divider, grid);
    settingsArea.replaceChildren(fragment);
    localStorage.setItem(STORE_KEY_VISIBILITY, JSON.stringify(visibility));
  }

  function compareModelOrder(a, b) {
    const group = model => MODEL_GROUPS.findIndex(item => item.id === modelGroupId(model));
    const family = group(a) - group(b);
    if(family)return family;
    const version = model => (parseSlug(model.slug).version || model.label.match(/\d+(?:\.\d+)*/)?.[0] || '0').split('.').map(Number);
    const av=version(a),bv=version(b);
    for(let i=0;i<Math.max(av.length,bv.length);i++){
      const difference=(bv[i]||0)-(av[i]||0);
      if(difference)return difference;
    }
    return 0; // Keep the existing tier order for models with the same version.
  }

  function modelSignature(models) {
    return JSON.stringify(models.map(model => [
      model.slug,
      model.apiId || model.slug,
      model.source || "igx",
      model.label,
      model.short,
    ]));
  }

  function applyModels(nextModels) {
    if (!Array.isArray(nextModels) || nextModels.length === 0) return false;

    const clean = YAME_MODELS.map(model => ({ ...model }));
    const seen = new Set(clean.map(model => model.slug));

    for (const model of nextModels) {
      if (!model || typeof model.slug !== "string") continue;
      const slug = model.slug.trim();
      if (!slug || seen.has(slug) || !looksLikeModelSlug(slug)) continue;
      if (typeof model.label !== "string" || !model.label.trim()) continue;
      if (typeof model.short !== "string" || !model.short.trim()) continue;

      seen.add(slug);
      clean.push({
        slug,
        apiId: slug,
        source: "igx",
        label: model.label.trim(),
        short: model.short.trim(),
      });
    }

    clean.sort(compareModelOrder);
    if (clean.length === YAME_MODELS.length || modelSignature(clean) === modelSignature(MODELS)) return false;

    MODELS = clean;
    for (const slug of [...last.keys()]) {
      if (!seen.has(slug)) last.delete(slug);
    }

    buildModelUI();
    renderBarline();
    return true;
  }

  const YAME_SCORE_BANDS = new Set(["excellent", "good", "fair", "poor", "error"]);

  function normalizeStatus(status) {
    const value = String(status || "unknown").trim().toLowerCase();
    if (["active", "operational", "ok", "healthy", "online", "normal"].includes(value)) return "active";
    if (["degraded", "slow", "warning", "warn"].includes(value)) return "degraded";
    if (["impacted", "critical", "down", "offline", "error", "failed", "failure", "unavailable"].includes(value)) return "impacted";
    return VALID_STATUSES.has(value) ? value : "unknown";
  }

  function normalizeYameScoreBand(band, score, hasError = false) {
    if (hasError) return "error";
    const explicit = String(band || "").toLowerCase();
    if (YAME_SCORE_BANDS.has(explicit)) return explicit;

    if(score===null||score===undefined||score==='')return "";
    const value = Number(score);
    if (!Number.isFinite(value)) return "";
    if (value >= 85) return "excellent";
    if (value >= 70) return "good";
    if (value >= 50) return "fair";
    return "poor";
  }

  function titleWord(word) {
    const known = {
      api: "API",
      ai: "AI",
      gpt: "GPT",
      claude: "Claude",
      gemini: "Gemini",
      opus: "Opus",
      sonnet: "Sonnet",
      haiku: "Haiku",
      pro: "Pro",
      flash: "Flash",
      lite: "Lite",
      mini: "Mini",
      max: "Max",
      turbo: "Turbo",
      preview: "Preview",
      thinking: "Thinking",
      experimental: "Experimental",
      exp: "Exp",
    };
    return known[word] || (word ? word.charAt(0).toUpperCase() + word.slice(1) : "");
  }

  function parseSlug(slug) {
    const tokens = String(slug || "")
      .toLowerCase()
      .split("-")
      .map(value => value.trim())
      .filter(Boolean);

    const brand = tokens[0] || "model";
    const isNumberToken = token => /^\d+(?:\.\d+)*$/.test(token);
    const firstNumberIndex = tokens.findIndex((token, index) => index > 0 && isNumberToken(token));

    let version = "";
    if (firstNumberIndex !== -1) {
      const parts = [];
      for (let i = firstNumberIndex; i < tokens.length && isNumberToken(tokens[i]); i++) {
        parts.push(tokens[i]);
      }
      version = parts.join(".");
    }

    const descriptors = tokens.slice(1).filter(token => !isNumberToken(token));
    return { brand, version, descriptors };
  }

  function autoLabel(slug) {
    const override = MODEL_OVERRIDES.get(slug);
    if (override) return override.label;

    const { brand, version, descriptors } = parseSlug(slug);
    const brandName = titleWord(brand);
    const descriptorText = descriptors.map(titleWord).join(" ");

    if (version && descriptorText) return `${brandName} ${version} ${descriptorText}`;
    if (version) return `${brandName} ${version}`;
    if (descriptorText) return `${brandName} ${descriptorText}`;
    return brandName;
  }

  function autoShort(slug) {
    const override = MODEL_OVERRIDES.get(slug);
    if (override) return override.short;

    const { brand, version, descriptors } = parseSlug(slug);
    const descriptorInitials = descriptors
      .filter(v => !["preview", "experimental", "exp"].includes(v))
      .map(v => v.charAt(0).toUpperCase())
      .join("");

    if (brand === "claude") {
      const family = descriptors.find(v => ["opus", "sonnet", "haiku"].includes(v));
      const familyInitial = family ? family.charAt(0).toUpperCase() : "C";
      return `${familyInitial}${version || ""}`;
    }

    if (brand === "gemini") {
      const tier = descriptors.filter(v => v !== "pro").map(v => v.charAt(0).toUpperCase()).join("");
      return `G${version || ""}${tier}`;
    }

    if (version) {
      return `${brand.charAt(0).toUpperCase()}${version}${descriptorInitials}`.slice(0, 8);
    }

    if (descriptors.length) {
      return `${brand.charAt(0).toUpperCase()}${descriptorInitials}`.slice(0, 6);
    }

    return brand.slice(0, 3).toUpperCase();
  }

  function makeModelMeta(slug) {
    return {
      slug,
      apiId: slug,
      source: "igx",
      label: autoLabel(slug),
      short: autoShort(slug),
    };
  }

  function ensureUniqueShorts(models) {
    const used = new Set();

    return models.map((model) => {
      const original = String(model.short || "M").slice(0, 8) || "M";
      let candidate = original;

      if (used.has(candidate)) {
        const brandPrefix = model.slug.split("-")[0].slice(0, 2).toUpperCase() || "M";
        candidate = `${brandPrefix}${original}`.slice(0, 8);
      }

      let suffix = 2;
      while (used.has(candidate)) {
        const suffixText = String(suffix++);
        const baseLength = Math.max(1, 8 - suffixText.length);
        candidate = `${original.slice(0, baseLength)}${suffixText}`;
      }

      used.add(candidate);
      return { ...model, short: candidate };
    });
  }

  function loadModelCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY_MODELS));
      const source = Array.isArray(parsed) ? parsed : parsed?.models;
      if (!Array.isArray(source)) return null;

      const models = source.filter(model =>
        model && typeof model.slug === "string" && looksLikeModelSlug(model.slug) &&
        typeof model.label === "string" && typeof model.short === "string"
      );

      return models.length ? models : null;
    } catch {
      return null;
    }
  }

  function saveModelCache(models) {
    try {
      localStorage.setItem(STORE_KEY_MODELS, JSON.stringify(models));
    } catch {}
  }

  const active = () => !document.hidden && isIgxChatRoomPage();
  let nextModelListAt = 0;
  let nextHomepageAt = 0;
  try {
    const checked = Number(localStorage.getItem(STORE_KEY_HOME_CHECK));
    if (loadModelCache()?.length && checked > 0 && checked <= Date.now()) nextHomepageAt = checked + HOME_CHECK_MS;
  } catch {}
  let nextRefreshAt = 0;
  let refreshBusy = false;
  let lastSuccessAt = 0;

  function gmGetText(url, accept = 'application/json') {
    return new Promise((resolve,reject) => {
      GM_xmlhttpRequest({method:'GET',url,anonymous:true,timeout:15000,
        headers:{Accept:accept},
        onload(response){
          if(response.status<200||response.status>=300){reject(new Error('HTTP '+response.status));return;}
          resolve(response.responseText);
        },onerror:()=>reject(new Error('network error')),
        ontimeout:()=>reject(new Error('timeout')),onabort:()=>reject(new Error('aborted'))
      });
    });
  }
  async function gmGetJson(url) { return JSON.parse(await gmGetText(url)); }

  function homepageModelSlugs(html) {
    // Read only the model-ID labels observed on the official homepage; never insert its HTML.
    if(typeof html!=='string'||html.length>3*1024*1024)throw new Error('invalid homepage');
    const ids=new Set();
    const labels=/<div\b[^>]*\bclass=["'][^"']*\bcard-title-model-id\b[^"']*["'][^>]*>\s*([a-z0-9][a-z0-9._-]*)\s*<\/div>/gi;
    for(const match of html.matchAll(labels)){
      const slug=match[1].toLowerCase();
      if(looksLikeModelSlug(slug))ids.add(slug);
    }
    if(!ids.size)throw new Error('homepage model labels missing');
    return [...ids];
  }
  function finite(value) {
    if(value===null||value===undefined||value===''||typeof value==='boolean')return null;
    const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;
  }
  async function updateModelList() {
    const signals=new Map();
    if(Date.now()<nextModelListAt)return signals;
    nextModelListAt=Date.now()+5*60*1000;
    // A temporary omission must not delete models already discovered or their visibility preferences.
    const slugs=new Set(MODELS.filter(m=>m.source==='igx').map(m=>m.slug));
    try{
      const payload=await gmGetJson(IGX_BASE_URL+'/api/v2/models');
      if(payload?.success!==true||!Array.isArray(payload.data))throw new Error('invalid models');
      for(const slug of payload.data)if(typeof slug==='string'&&looksLikeModelSlug(slug))slugs.add(slug);
    }catch(_){/* Keep cached models and still try the independent homepage source when due. */}
    if(active()&&Date.now()>=nextHomepageAt){
      nextHomepageAt=Date.now()+5*60*1000;
      try{
        const candidates=homepageModelSlugs(await gmGetText(IGX_BASE_URL+'/', 'text/html'))
          .filter(slug=>!slugs.has(slug));
        let index=0,failed=false;
        async function verify(){
          while(active()&&index<candidates.length){
            const slug=candidates[index++];
            try{
              const payload=await gmGetJson(IGX_BASE_URL+'/api/v2/simple/'+encodeURIComponent(slug));
              parseIgx(payload); // A homepage label alone is not sufficient to add a model.
              signals.set(slug,payload);
            }catch(_){failed=true;}
          }
        }
        await Promise.all(Array.from({length:Math.min(4,candidates.length)},verify));
        for(const slug of candidates)if(signals.has(slug))slugs.add(slug);
        if(!failed&&index===candidates.length){
          const checked=Date.now();nextHomepageAt=checked+HOME_CHECK_MS;
          try{localStorage.setItem(STORE_KEY_HOME_CHECK,String(checked));}catch{}
        }
      }catch(_){/* Layout/network failures retain the prior list; retry no sooner than five minutes. */}
    }
    if(slugs.size){
      const models=ensureUniqueShorts([...slugs].map(makeModelMeta));
      saveModelCache(models);applyModels(models);
    }
    return signals;
  }
  function parseIgx(payload) {
    if(payload?.success!==true||!payload.data||typeof payload.data!=='object')throw new Error('invalid signal');
    const d=payload.data;
    const score=finite(d.score),latency=finite(d.latency);
    if(score===null&&latency===null)throw new Error('missing metrics');
    return {status:normalizeStatus(d.status),score,latency,tps:finite(d.tps),scoreBand:''};
  }
  function parseYame(payload,id) {
    const m=payload?.models?.find(x=>x.id===id);
    if(!m)throw new Error('missing YAME model');
    const score=finite(m.experience_score?.value),latency=finite(m.metrics?.ttft_ms);
    if(score===null&&latency===null&&!m.error)throw new Error('missing YAME metrics');
    return {status:m.error?'impacted':normalizeStatus(m.state),score,latency,tps:finite(m.metrics?.tps),
      scoreBand:normalizeYameScoreBand(m.experience_score?.band,score,!!m.error)};
  }
  async function refreshAll() {
    if(!active()||refreshBusy)return;
    refreshBusy=true;nextRefreshAt=Date.now()+POLL_MS;
    btnRefresh.disabled=true;
    try{
      const discoveredSignals=await updateModelList();
      if(!active())return;
      const pending=MODELS.filter(m=>visibility[m.slug]);
      let index=0,success=0,failed=0;
      async function worker(){
        while(active()&&index<pending.length){
          const model=pending[index++];
          try{
            const yame=model.source==='yame';
            const payload=!yame&&discoveredSignals.has(model.slug)?discoveredSignals.get(model.slug)
              :await gmGetJson(yame?YAME_STATUS_URL:IGX_BASE_URL+'/api/v2/simple/'+encodeURIComponent(model.slug));
            const d=yame?parseYame(payload,model.apiId):parseIgx(payload);
            last.set(model.slug,{status:d.status,score:fmt0(d.score)??'—',lat:latencySeconds(d.latency)??'—',
              scoreBand:d.scoreBand,receivedAt:Date.now(),stale:false});success++;
          }catch(_){
            const previous=last.get(model.slug)||{status:'unknown',score:'—',lat:'—',scoreBand:''};
            last.set(model.slug,{...previous,stale:true});failed++;
          }
        }
      }
      await Promise.all(Array.from({length:Math.min(4,pending.length)},worker));
      if(success)lastSuccessAt=Date.now();
      if(active()){
        renderBarline();
        btnRefresh.title=failed?`${failed}개 조회 실패 · 흐린 항목은 이전 수신값`:
          (success?`갱신 · 마지막 수신 ${new Date(lastSuccessAt).toLocaleTimeString()}`:'선택된 모델 없음');
      }
    }finally{refreshBusy=false;btnRefresh.disabled=false;}
  }

  function fmt0(x) {
    if (x === null || x === undefined || x === "") return null;
    const n = Number(x);
    return Number.isFinite(n) ? Math.round(n).toString() : null;
  }

  function latencySeconds(latencyInt) {
    if (latencyInt === null || latencyInt === undefined || latencyInt === "") return null;
    const n = Number(latencyInt);
    if (!Number.isFinite(n)) return null;
    return n >= 0 ? (n / 1000).toFixed(2) : null;
  }

  function renderBarline() {
    const fragment = document.createDocumentFragment();
    let visibleCount = 0;

    for (const model of MODELS) {
      if (!visibility[model.slug]) continue;
      visibleCount++;

      const data = last.get(model.slug) || { status: "unknown", score: "—", lat: "—", scoreBand: "" };
      const item = document.createElement("span");
      item.className = `bitem b-${normalizeStatus(data.status)}`;
      if(data.stale){item.style.opacity='.45';item.title=data.receivedAt?`조회 실패 · 이전 수신 ${new Date(data.receivedAt).toLocaleTimeString()}`:'조회 실패 · 수신값 없음';}
      if (YAME_SCORE_BANDS.has(data.scoreBand)) item.classList.add(`y-score-${data.scoreBand}`);

      const dot = document.createElement("span");
      dot.className = "bdot";

      const name = document.createElement("span");
      name.className = "bname";
      name.textContent = model.short;

      const score = document.createElement("span");
      score.className = "bscore";
      score.textContent = data.score ?? "—";

      item.append(dot, name, score);

      if (showLatency) {
        const latency = document.createElement("span");
        latency.className = "blat";
        latency.textContent = `${data.lat ?? "—"}s`;
        item.appendChild(latency);
      }

      fragment.appendChild(item);
    }

    if (!visibleCount) {
      const empty = document.createElement("span");
      empty.style.cssText = "opacity:.6;padding:0 4px";
      empty.textContent = "선택된 모델 없음";
      fragment.appendChild(empty);
    }

    barline.replaceChildren(fragment);
  }

  let currentInlineHost = null;

  function closeSettings() {
    settingsArea.classList.remove("open");
    btnSettings.setAttribute("aria-expanded", "false");
  }

  function positionSettingsPopover() {
    if (!settingsArea.classList.contains("open")) return;
    const rect = btnSettings.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const viewportWidth = window.visualViewport?.width || window.innerWidth;
    const gap = 6;
    const right = Math.max(8, viewportWidth - rect.right);

    settingsArea.style.right = `${right}px`;
    settingsArea.style.left = "auto";
    settingsArea.style.top = "auto";
    settingsArea.style.bottom = `${Math.max(8, viewportHeight - rect.top + gap)}px`;

    requestAnimationFrame(() => {
      if (!settingsArea.classList.contains("open")) return;
      const panelRect = settingsArea.getBoundingClientRect();
      if (panelRect.top < 8) {
        settingsArea.style.bottom = "auto";
        settingsArea.style.top = `${Math.min(viewportHeight - panelRect.height - 8, rect.bottom + gap)}px`;
      }
    });
  }

  function openSettings() {
    if (!settingsArea.isConnected) document.documentElement.appendChild(settingsArea);
    settingsArea.classList.add("open");
    btnSettings.setAttribute("aria-expanded", "true");
    positionSettingsPopover();
  }

  function toggleSettings() {
    if (settingsArea.classList.contains("open")) closeSettings();
    else openSettings();
  }

  function clearInlineHost() {
    if (currentInlineHost?.isConnected) {
      currentInlineHost.classList.remove("igx-inline-overlay-host");
    }
    currentInlineHost = null;
  }

  function detachPopupOutsideChat() {
    closeSettings();
    clearInlineHost();
    if (popup.parentNode) popup.parentNode.removeChild(popup);
    if (settingsArea.parentNode) settingsArea.parentNode.removeChild(settingsArea);
  }

  function isVisibleEnough(element) {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 18) return false;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    if (rect.right < 0 || rect.left > window.innerWidth) return false;
    return true;
  }

  function findComposerElement() { return Core.editor; }

  function findInlineHost() {
    const composer=Core.editor;
    return composer?.closest('[data-cmu-theme-input-box],[data-sgb-input-box],div[class*="rounded"][class*="border"]') || composer?.closest('form') || composer?.parentElement;
  }

  function attachInlineIfPossible() {
    if(!isIgxChatRoomPage()){detachPopupOutsideChat();return false;}
    const host=findInlineHost();
    if(!host?.parentElement){popup.remove();clearInlineHost();closeSettings();return false;}
    currentInlineHost=host;
    if(popup.parentNode!==host.parentNode||popup.nextElementSibling!==host)host.parentNode.insertBefore(popup,host);
    // 입력창 부모의 flex gap과 라디오존데 여백이 중복되지 않도록 최종 간격을 4px로 맞춘다.
    const rowGap=parseFloat(getComputedStyle(host.parentElement).rowGap)||0;
    const marginBottom=`${4-rowGap}px`;
    if(popup.style.marginBottom!==marginBottom)popup.style.setProperty('margin-bottom',marginBottom,'important');
    return true;
  }

  document.addEventListener("ccr:composer-layout", () => {
    if (!document.hidden && isIgxChatRoomPage()) attachInlineIfPossible();
  });

  btnSettings.setAttribute("aria-expanded", "false");
  btnSettings.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSettings();
  });

  btnRefresh.addEventListener("click", (event) => {
    event.stopPropagation();
    refreshAll();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!settingsArea.classList.contains("open")) return;
    if (settingsArea.contains(event.target) || btnSettings.contains(event.target)) return;
    closeSettings();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSettings();
  }, true);

  window.addEventListener("scroll", (event) => {
    if (settingsArea.contains(event.target)) return;
    closeSettings();
  }, { capture: true, passive: true });
  window.visualViewport?.addEventListener("resize", positionSettingsPopover, { passive: true });

  function applyTheme() {
    const isDark = document.body.getAttribute("data-theme") === "dark";
    popup.classList.toggle("igx-light", !isDark);
    settingsArea.classList.toggle("igx-light", !isDark);
  }

  Core.on('theme',applyTheme);
  Core.on('editor',()=>{attachInlineIfPossible();if(active()&&Date.now()>=nextRefreshAt)refreshAll();});
  Core.on('route',()=>{attachInlineIfPossible();if(active()&&Date.now()>=nextRefreshAt)refreshAll();});
  Core.on('layout',()=>{attachInlineIfPossible();positionSettingsPopover();});
  Core.on('visibility',()=>{if(active()&&Date.now()>=nextRefreshAt)refreshAll();});
  Core.on('maintenance',()=>{
    if(!active())return;
    if(!popup.isConnected)attachInlineIfPossible();
    if(Date.now()>=nextRefreshAt)refreshAll();
  });
  window.addEventListener('online',()=>{if(active()&&Date.now()>=nextRefreshAt)refreshAll();},{passive:true});
  const initialCache=loadModelCache();
  applyModels(initialCache?.length?initialCache:FALLBACK_MODELS);
  applyTheme();

})();
Core.start();
})();
