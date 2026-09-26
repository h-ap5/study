// ==UserScript==
// @name         Crack Char Clock Badge (크랙 글자수·시간 배지) 🕒
// @namespace    crack char clock badge
// @version      1.2.8-integrated.7
// @description  글자수·시간 배지, 선택 글자수, 입력 감싸기, 수정창 도구, 버블 메뉴·바로 수정·단어 줄바꿈을 통합합니다.
// @author       Assistant
// @match        https://crack.wrtn.ai/*
// @match        https://*.crack.wrtn.ai/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
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

  // Crack Edit Text Click Replacer v0.2.11: keep its own edit UI and saved keys.
  if (onMainHost) {
(function () {
  'use strict';

  const STYLE_ID = 'cerc-style';
  const PANEL_ID = 'cerc-panel';
  const TRIGGER_ATTR = 'data-cerc-trigger';
  const knownDoneButtons = new Set();
  const pendingDoneButtons = new Set();
  const EDITOR_HINT = '[contenteditable="true"].ProseMirror, [contenteditable="true"][data-history-hooked="true"]';
  const STORAGE_KEY = 'crack_edit_text_click_replacer_recent_terms_v1';
  const PREVIEW_TAB_KEY = 'crack_edit_text_click_replacer_preview_tab_v1';
  const MAX_CANDIDATES = 180;
  const MAX_PREVIEW_CHARS = 16000;

  let activeEditor = null;
  let lastEditor = null;
  let lastBeforeText = null;
  let injectScheduled = false;
  let syncScheduled = false;
  let editorInputHandler = null;
  let boundEditor = null;

  const state = {
    sourceText: '',
    candidates: [],
    rules: [],
    excludedMatches: new Map(),
    filter: '',
    status: '',
    previewTab: loadPreviewTab(),
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function makeId() {
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function uniqRules(rules) {
    const seen = new Set();
    return rules.filter((rule) => {
      const key = String(rule.target || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function loadRecentTerms() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 30) : [];
    } catch (_) {
      return [];
    }
  }

  function saveRecentTerms(terms) {
    try {
      const cleaned = Array.from(new Set((terms || []).map((v) => String(v || '').trim()).filter(Boolean))).slice(0, 30);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    } catch (_) {
      // ignore
    }
  }

  function loadPreviewTab() {
    try {
      const value = localStorage.getItem(PREVIEW_TAB_KEY);
      return value === 'after' ? 'after' : 'mark';
    } catch (_) {
      return 'mark';
    }
  }

  function savePreviewTab(tab) {
    try {
      localStorage.setItem(PREVIEW_TAB_KEY, tab === 'after' ? 'after' : 'mark');
    } catch (_) {
      // ignore
    }
  }

  function purgeLegacyRecentTerms() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      // ignore
    }
  }

  function rememberTerm(term) {
    // v0.2.7부터 직접 추가/드래그 추가 단어는 저장하지 않는다.
    // 선택 항목은 현재 열린 정리창 안에서만 유지된다.
    void term;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .cerc-trigger-btn span { pointer-events: none !important; }

      #${PANEL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        box-sizing: border-box;
        background: rgba(0, 0, 0, 0.36);
      }

      #${PANEL_ID}[hidden] { display: none !important; }

      .cerc-modal {
        width: min(980px, calc(100vw - 24px));
        max-height: min(820px, calc(100vh - 24px));
        overflow: hidden;
        border: 1px solid rgba(127, 127, 127, 0.26);
        border-radius: 20px;
        background: color-mix(in srgb, var(--background, #101114) 94%, transparent);
        color: var(--text_primary, var(--foreground, #f4f4f5));
        box-shadow: 0 20px 72px rgba(0, 0, 0, 0.38);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        font-family: inherit;
      }

      .cerc-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px 11px;
        border-bottom: 1px solid rgba(127, 127, 127, 0.18);
      }

      .cerc-title {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .cerc-title strong {
        font-size: 15px;
        line-height: 1.35;
      }

      .cerc-title small {
        font-size: 12px;
        line-height: 1.35;
        opacity: 0.72;
      }

      .cerc-close {
        flex: 0 0 auto;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 999px;
        cursor: pointer;
        color: inherit;
        background: rgba(127, 127, 127, 0.16);
        font-size: 18px;
        line-height: 1;
      }

      .cerc-body {
        display: grid;
        grid-template-columns: minmax(240px, 0.85fr) minmax(290px, 1fr) minmax(320px, 1.25fr);
        gap: 12px;
        padding: 14px;
        overflow: auto;
        max-height: calc(min(820px, 100vh - 24px) - 58px);
      }

      .cerc-card {
        min-width: 0;
        border: 1px solid rgba(127, 127, 127, 0.18);
        border-radius: 16px;
        background: rgba(127, 127, 127, 0.09);
        overflow: hidden;
      }

      .cerc-card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 11px 12px 8px;
        border-bottom: 1px solid rgba(127, 127, 127, 0.13);
      }

      .cerc-card-head strong {
        font-size: 13px;
        line-height: 1.35;
      }

      .cerc-card-head small {
        font-size: 11px;
        line-height: 1.35;
        opacity: 0.65;
      }

      .cerc-card-body {
        padding: 10px 12px 12px;
      }

      .cerc-input,
      .cerc-select,
      .cerc-textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid rgba(127, 127, 127, 0.24);
        border-radius: 12px;
        outline: none;
        color: inherit;
        background: rgba(0, 0, 0, 0.17);
        font: inherit;
        font-size: 12px;
      }

      /* 닫혀 있는 select 박스 디자인은 기존 톤을 유지하고,
         펼쳐지는 option 목록의 가시성만 보정한다. */
      .cerc-select option,
      .cerc-select optgroup {
        color: #f4f4f5 !important;
        background-color: #26272d !important;
      }

      .cerc-select option:checked {
        color: #ffffff !important;
        background-color: #3f63c7 !important;
      }

      .cerc-select option:disabled {
        color: #9ca3af !important;
        background-color: #26272d !important;
      }

      .cerc-input,
      .cerc-select {
        height: 36px;
        padding: 0 10px;
      }

      .cerc-textarea {
        min-height: clamp(240px, 34vh, 380px);
        resize: vertical;
        padding: 10px;
        line-height: 1.55;
        white-space: pre-wrap;
      }

      .cerc-input:focus,
      .cerc-select:focus,
      .cerc-textarea:focus {
        border-color: color-mix(in srgb, var(--ring, #8ab4ff) 62%, transparent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring, #8ab4ff) 18%, transparent);
      }

      .cerc-row {
        display: flex;
        align-items: center;
        gap: 7px;
      }

      .cerc-row + .cerc-row { margin-top: 8px; }

      .cerc-btn {
        flex: 0 0 auto;
        border: 1px solid rgba(127, 127, 127, 0.22);
        border-radius: 12px;
        padding: 9px 11px;
        cursor: pointer;
        color: inherit;
        background: rgba(127, 127, 127, 0.14);
        font: inherit;
        font-size: 12px;
        line-height: 1;
        white-space: nowrap;
      }

      .cerc-btn:hover { background: rgba(127, 127, 127, 0.23); }
      .cerc-btn:disabled { opacity: 0.45; cursor: not-allowed; }

      .cerc-primary {
        border-color: color-mix(in srgb, var(--brand, #7aa2ff) 50%, transparent);
        background: color-mix(in srgb, var(--brand, #7aa2ff) 25%, transparent);
      }

      .cerc-danger { background: rgba(255, 80, 80, 0.13); }
      .cerc-ghost { background: transparent; }

      .cerc-chip-list {
        display: flex;
        flex-wrap: wrap;
        align-content: flex-start;
        gap: 7px;
        max-height: 390px;
        overflow: auto;
        padding: 2px;
      }

      .cerc-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        border: 1px solid rgba(127, 127, 127, 0.22);
        border-radius: 999px;
        padding: 7px 9px;
        cursor: pointer;
        color: inherit;
        background: rgba(127, 127, 127, 0.12);
        font: inherit;
        font-size: 12px;
        line-height: 1;
      }

      .cerc-chip:hover { background: rgba(127, 127, 127, 0.22); }

      .cerc-chip[data-selected="true"] {
        border-color: color-mix(in srgb, var(--brand, #7aa2ff) 55%, transparent);
        background: color-mix(in srgb, var(--brand, #7aa2ff) 22%, transparent);
      }

      .cerc-chip-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cerc-chip-count {
        opacity: 0.68;
        font-size: 11px;
      }

      .cerc-rule-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 420px;
        overflow: auto;
      }

      .cerc-rule {
        border: 1px solid rgba(127, 127, 127, 0.18);
        border-radius: 14px;
        padding: 9px;
        background: rgba(0, 0, 0, 0.12);
      }

      .cerc-rule-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }

      .cerc-target {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        font-weight: 700;
      }

      .cerc-count {
        opacity: 0.7;
        font-size: 11px;
        white-space: nowrap;
      }

      .cerc-rule-grid {
        display: grid;
        grid-template-columns: minmax(86px, 1fr) minmax(112px, 1fr) 34px;
        gap: 7px;
        align-items: center;
      }

      .cerc-rule-grid .cerc-input {
        grid-column: 1 / 3;
      }

      .cerc-mini-btn {
        width: 34px;
        height: 36px;
        border: 1px solid rgba(127, 127, 127, 0.22);
        border-radius: 12px;
        cursor: pointer;
        color: inherit;
        background: rgba(127, 127, 127, 0.14);
        font: inherit;
        font-size: 14px;
        line-height: 1;
      }

      .cerc-preview-tabs {
        display: flex;
        gap: 6px;
      }

      .cerc-tab {
        border: 1px solid rgba(127, 127, 127, 0.18);
        border-radius: 999px;
        padding: 7px 9px;
        cursor: pointer;
        color: inherit;
        background: rgba(127, 127, 127, 0.10);
        font: inherit;
        font-size: 11px;
        line-height: 1;
      }

      .cerc-tab[data-active="true"] {
        background: color-mix(in srgb, var(--brand, #7aa2ff) 22%, transparent);
        border-color: color-mix(in srgb, var(--brand, #7aa2ff) 45%, transparent);
      }

      .cerc-highlight-box {
        height: clamp(240px, 34vh, 380px);
        overflow: auto;
        padding: 10px;
        border: 1px solid rgba(127, 127, 127, 0.18);
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.15);
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
        line-height: 1.6;
      }

      .cerc-mark {
        border: 0;
        border-radius: 5px;
        padding: 0 2px;
        background: color-mix(in srgb, #ffd166 50%, transparent);
        color: inherit;
        cursor: pointer;
        font: inherit;
        line-height: inherit;
        transition: background 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
      }

      .cerc-mark:hover {
        box-shadow: 0 0 0 2px color-mix(in srgb, #ffd166 42%, transparent);
      }

      .cerc-mark[data-excluded="true"] {
        background: rgba(127, 127, 127, 0.20);
        opacity: 0.62;
        text-decoration: line-through;
        text-decoration-thickness: 1px;
      }

      .cerc-mark[data-excluded="true"]:hover {
        box-shadow: 0 0 0 2px rgba(127, 127, 127, 0.28);
      }

      .cerc-preview-note {
        margin-top: 8px;
        min-height: 18px;
        text-align: right;
        font-size: 11px;
        line-height: 1.4;
        opacity: 0.72;
      }

      .cerc-footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 10px;
      }

      .cerc-status {
        flex: 1 1 220px;
        min-height: 18px;
        font-size: 12px;
        line-height: 1.45;
        opacity: 0.82;
        text-align: left;
      }

      .cerc-empty {
        padding: 16px 10px;
        border: 1px dashed rgba(127, 127, 127, 0.28);
        border-radius: 14px;
        text-align: center;
        font-size: 12px;
        line-height: 1.55;
        opacity: 0.72;
      }

      .cerc-muted {
        opacity: 0.66;
        font-size: 11px;
        line-height: 1.45;
      }

      @media (max-width: 900px) {
        #${PANEL_ID} {
          align-items: center;
          padding: 8px;
        }

        .cerc-modal {
          width: 100%;
          max-height: calc(100vh - 16px);
          border-radius: 18px;
        }

        .cerc-body {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          max-height: calc(100vh - 78px);
          gap: 10px;
          padding: 10px;
        }

        .cerc-card:nth-child(3) {
          grid-column: 1 / -1;
        }

        .cerc-chip-list,
        .cerc-rule-list {
          max-height: 180px;
        }
      }

      @media (max-width: 640px) {
        #${PANEL_ID} {
          align-items: center;
          padding: 6px;
        }

        .cerc-modal {
          max-height: calc(100vh - 12px);
          border-radius: 16px;
        }

        .cerc-head {
          padding: 12px 14px 9px;
        }

        .cerc-title strong {
          font-size: 14px;
        }

        .cerc-title small {
          font-size: 11px;
        }

        .cerc-body {
          grid-template-columns: 1fr;
          max-height: calc(100vh - 70px);
          gap: 9px;
          padding: 9px;
        }

        .cerc-card-body {
          padding: 8px 10px 10px;
        }

        .cerc-chip-list {
          max-height: 126px;
        }

        .cerc-rule-list {
          max-height: 150px;
        }

        .cerc-rule-grid {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 34px;
        }

        .cerc-highlight-box {
          height: clamp(230px, 32vh, 310px);
        }

        .cerc-textarea {
          min-height: clamp(230px, 32vh, 310px);
        }

        .cerc-row {
          gap: 6px;
        }

        .cerc-btn {
          padding: 8px 9px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function getEditorText(editor) {
    return String(editor?.innerText ?? '').replace(/\n$/, '');
  }

  function buildPlainParagraphFragment(text) {
    const fragment = document.createDocumentFragment();
    const p = document.createElement('p');
    const lines = String(text ?? '').split('\n');

    if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
      p.appendChild(document.createElement('br'));
    } else {
      lines.forEach((line, index) => {
        if (index > 0) p.appendChild(document.createElement('br'));
        p.appendChild(document.createTextNode(line));
      });
    }

    fragment.appendChild(p);
    return fragment;
  }

  function notifyEditorChanged(editor, text) {
    const value = String(text ?? '');

    try {
      editor.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertFromPaste',
        data: value,
      }));
    } catch (_) {
      // 일부 브라우저는 beforeinput 생성자를 막을 수 있음.
    }

    try {
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertFromPaste',
        data: value,
      }));
    } catch (_) {
      editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }

    editor.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setEditorText(editor, text) {
    if (!(editor instanceof HTMLElement)) return false;

    const value = String(text ?? '');
    editor.focus();

    // execCommand('insertText')로 전체 텍스트를 밀어 넣으면
    // ProseMirror/Tiptap의 마크다운 입력 규칙이 ```INFO 같은 코드펜스를
    // 실제 code_block으로 자동 변환하면서 코드블록 내용이 세로로 깨지는 경우가 있다.
    // 그래서 전체 적용은 항상 DOM을 plain paragraph + <br> 구조로 재구성해서
    // 원래 수정창의 마크다운 텍스트 형태를 유지한다.
    try {
      editor.replaceChildren(buildPlainParagraphFragment(value));
    } catch (_) {
      editor.innerHTML = '';
      editor.appendChild(buildPlainParagraphFragment(value));
    }

    notifyEditorChanged(editor, value);
    return true;
  }

  function getSelectedPageText() {
    try {
      return String(window.getSelection?.().toString() || '').trim();
    } catch (_) {
      return '';
    }
  }

  function cleanForCandidateText(text) {
    return String(text || '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/```[\s\S]*?```/g, (block) => block.replace(/[\w가-힣ㄱ-ㅎㅏ-ㅣ]+/g, ' '));
  }

  function getCandidateCountMap(text) {
    const source = cleanForCandidateText(text);
    const map = new Map();
    const tokenRe = /[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9_]{2,}/g;
    let match;

    while ((match = tokenRe.exec(source))) {
      const token = match[0].trim();
      if (!token) continue;
      if (/^\d+$/.test(token)) continue;
      if (/^[A-Za-z]{1,2}$/.test(token)) continue;
      if (/^[A-Za-z0-9_]{25,}$/.test(token)) continue;

      map.set(token, (map.get(token) || 0) + 1);
    }

    return map;
  }

  function extractCandidates(text) {
    const countMap = getCandidateCountMap(text);

    return Array.from(countMap.entries())
      .map(([textValue, count]) => ({ text: textValue, count, source: 'auto' }))
      .filter((item) => item.count >= 2)
      .sort((a, b) => (b.count - a.count) || (b.text.length - a.text.length) || a.text.localeCompare(b.text, 'ko'))
      .slice(0, MAX_CANDIDATES);
  }

  function countOccurrences(text, target) {
    const needle = String(target || '');
    if (!needle) return 0;
    const re = new RegExp(escapeRegExp(needle), 'g');
    let count = 0;
    String(text || '').replace(re, () => {
      count += 1;
      return '';
    });
    return count;
  }

  function getRuleSpaceMode(rule) {
    const value = String(rule?.spaceMode || '').trim();
    if (['exact', 'smart', 'left', 'right', 'both'].includes(value)) return value;
    return rule?.mode === 'delete' ? 'smart' : 'exact';
  }

  function makeRuleRegExp(rule) {
    const target = String(rule?.target || '');
    if (!target) return null;

    const word = escapeRegExp(target);
    const hSpace = '[ \t\u00A0　]';
    const spaceMode = getRuleSpaceMode(rule);

    if (spaceMode === 'smart' || spaceMode === 'both') return new RegExp(`(${hSpace}*)${word}(${hSpace}*)`, 'g');
    if (spaceMode === 'left') return new RegExp(`(${hSpace}+)${word}`, 'g');
    if (spaceMode === 'right') return new RegExp(`${word}(${hSpace}+)`, 'g');
    return new RegExp(word, 'g');
  }

  function getRuleReplacement(rule, replacement, captures) {
    const spaceMode = getRuleSpaceMode(rule);

    if (spaceMode === 'smart') {
      const left = String(captures?.[0] || '');
      const right = String(captures?.[1] || '');
      if (rule.mode === 'delete') return left && right ? ' ' : '';
      return `${left}${replacement}${right}`;
    }

    return replacement;
  }

  function getExcludedMatchSet(ruleId, create = false) {
    const id = String(ruleId || '');
    if (!id) return null;

    let set = state.excludedMatches.get(id);
    if (!set && create) {
      set = new Set();
      state.excludedMatches.set(id, set);
    }
    return set || null;
  }

  function isMatchExcluded(ruleId, matchIndex) {
    const set = getExcludedMatchSet(ruleId, false);
    return Boolean(set?.has(Number(matchIndex)));
  }

  function clearRuleExcludedMatches(ruleId) {
    state.excludedMatches.delete(String(ruleId || ''));
  }

  function clearAllExcludedMatches() {
    state.excludedMatches.clear();
  }

  function getRuleMatchStats(text, rule) {
    const re = makeRuleRegExp(rule);
    if (!re) return { total: 0, included: 0, excluded: 0 };

    let total = 0;
    let excluded = 0;
    String(text || '').replace(re, (match) => {
      if (!match) return match;
      if (isMatchExcluded(rule.id, total)) excluded += 1;
      total += 1;
      return match;
    });

    return { total, included: Math.max(0, total - excluded), excluded };
  }

  function getExcludedMatchCount(text, rules) {
    return uniqRules(rules).reduce((sum, rule) => sum + getRuleMatchStats(text, rule).excluded, 0);
  }

  function toggleExcludedMatch(ruleId, matchIndex) {
    const rule = findRule(ruleId);
    const index = Number(matchIndex);
    if (!rule || !Number.isInteger(index) || index < 0) return;

    const set = getExcludedMatchSet(rule.id, true);
    if (set.has(index)) {
      set.delete(index);
      if (!set.size) clearRuleExcludedMatches(rule.id);
      state.status = `“${rule.target}”의 이 위치를 다시 적용 대상에 넣었어.`;
    } else {
      set.add(index);
      state.status = `“${rule.target}”의 이 위치 1개만 적용에서 제외했어. 회색 표시를 다시 누르면 복구돼.`;
    }

    renderRules();
    renderPreview();
    renderStatus();
  }

  function applyRulesToText(text, rules) {
    let next = String(text ?? '');
    let total = 0;
    let skipped = 0;
    const details = [];

    for (const rule of uniqRules(rules)) {
      const target = String(rule.target || '');
      if (!target) continue;
      const replacement = rule.mode === 'replace' ? String(rule.replacement ?? '') : '';
      const re = makeRuleRegExp(rule);
      if (!re) continue;
      let count = 0;
      let skippedCount = 0;
      let matchIndex = 0;

      next = next.replace(re, (...args) => {
        const match = args[0];
        const captures = args.slice(1, -2);
        if (!match) return match;

        const currentIndex = matchIndex;
        matchIndex += 1;
        if (isMatchExcluded(rule.id, currentIndex)) {
          skippedCount += 1;
          return match;
        }

        count += 1;
        return getRuleReplacement(rule, replacement, captures);
      });

      if (count || skippedCount) {
        details.push({
          target,
          count,
          skipped: skippedCount,
          replacement,
          mode: rule.mode,
          spaceMode: getRuleSpaceMode(rule),
        });
      }
      total += count;
      skipped += skippedCount;
    }

    return { text: next, total, skipped, details };
  }

  function findEditorForButton(doneButton) {
    let node = doneButton?.parentElement;

    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const editor = node.querySelector?.(
        '[contenteditable="true"][data-history-hooked="true"], .tiptap.ProseMirror[contenteditable="true"], [contenteditable="true"].ProseMirror'
      );

      if (editor instanceof HTMLElement) return editor;
    }

    return null;
  }

  function findDoneButtons(root = document) {
    const candidates = [];
    if (root instanceof HTMLButtonElement) candidates.push(root);
    root.querySelectorAll?.('button').forEach(button => candidates.push(button));
    return candidates.filter(button => {
      if (!(button instanceof HTMLButtonElement) || button.hasAttribute(TRIGGER_ATTR)) return false;
      if (button.closest(`#${PANEL_ID}`)) return false;
      return (button.textContent || '').replace(/\s+/g, ' ').trim().includes('수정 완료');
    });
  }

  function queueDoneButtons(root) {
    if (!root) return;
    const el = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    if (!el || el.closest?.(`#${PANEL_ID}, [${TRIGGER_ATTR}]`)) return;
    for (const button of findDoneButtons(el)) {
      knownDoneButtons.add(button);
      pendingDoneButtons.add(button);
    }
    if (pendingDoneButtons.size) scheduleInject();
  }

  function handleCleanerMutations(records) {
    const touchedTargets = new Set();
    let editorAdded = false;
    for (const record of records) {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      if (target?.closest?.(`#${PANEL_ID}, [${TRIGGER_ATTR}]`)) continue;
      const added = Array.from(record.addedNodes);
      if (!record.removedNodes.length && added.length && added.every(node =>
          node instanceof Element && node.matches(`[${TRIGGER_ATTR}]`))) continue;
      touchedTargets.add(target);
      const button = target?.closest?.('button');
      if (button) queueDoneButtons(button);
      for (const node of added) {
        if (!(node instanceof Element)) continue;
        queueDoneButtons(node);
        // The editor can be mounted after its footer; retry already discovered buttons.
        if (node.matches(EDITOR_HINT) || node.querySelector(EDITOR_HINT)) {
          editorAdded = true;
        }
      }
    }
    // React can emit many records for one commit; inspect each known edit button once.
    if (!touchedTargets.size) return;
    for (const known of knownDoneButtons) {
      if (!known.isConnected) { knownDoneButtons.delete(known); pendingDoneButtons.delete(known); }
      else if (editorAdded || touchedTargets.has(known.parentElement)) pendingDoneButtons.add(known);
    }
    if (pendingDoneButtons.size) scheduleInject();
  }

  function makeTriggerButton(doneButton) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(TRIGGER_ATTR, 'true');
    button.className = `${doneButton.className || ''} cerc-trigger-btn`.trim();
    button.title = '수정창 텍스트를 보고 클릭으로 치환/삭제';
    button.innerHTML = `
      <span aria-hidden="true" style="font-size:15px;line-height:1;">🧹</span>
      <span class="typo-text-sm_leading-none_medium text-text_secondary">단어 정리</span>
    `;

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const editor = findEditorForButton(doneButton);
      if (!editor) {
        openPanel(null, '수정창을 못 찾았어. 수정창이 열린 상태에서 다시 눌러줘.');
        return;
      }

      openPanel(editor);
    }, true);

    return button;
  }

  function injectButtons() {
    injectScheduled = false;
    ensureStyle();

    const buttons = Array.from(pendingDoneButtons);
    pendingDoneButtons.clear();
    for (const doneButton of buttons) {
      if (!doneButton.isConnected || !findDoneButtons(doneButton).includes(doneButton)) continue;
      const row = doneButton.parentElement;
      if (!row) continue;
      if (row.querySelector(`[${TRIGGER_ATTR}="true"]`)) continue;

      const editor = findEditorForButton(doneButton);
      if (!editor) continue;

      const trigger = makeTriggerButton(doneButton);
      row.insertBefore(trigger, doneButton);
    }
  }

  function scheduleInject() {
    if (injectScheduled) return;
    injectScheduled = true;
    requestAnimationFrame(injectButtons);
  }

  function openPanel(editor, initialStatus = '') {
    ensureStyle();
    activeEditor = editor || activeEditor;
    bindEditorInput(activeEditor);

    state.sourceText = activeEditor ? getEditorText(activeEditor) : '';
    state.candidates = extractCandidates(state.sourceText);
    clearAllExcludedMatches();
    state.filter = '';
    state.status = initialStatus || '후보를 누르면 삭제 대상으로 들어가. 치환하려면 선택 목록에서 모드를 바꾸면 돼.';

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.innerHTML = getPanelHtml();
      document.body.appendChild(panel);
      bindPanelEvents(panel);
    }

    panel.hidden = false;
    renderPanel();
  }

  function resetPanelSession() {
    state.rules = [];
    clearAllExcludedMatches();
    state.filter = '';
    state.status = '';
  }
  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.hidden = true;
    resetPanelSession();
  }

  function getPanelHtml() {
    return `
      <div class="cerc-modal" role="dialog" aria-modal="true" aria-label="단어 정리">
        <div class="cerc-head">
          <div class="cerc-title">
            <strong>🧹 수정창 클릭 정리기</strong>
            <small>자동 후보 클릭 → 삭제/치환 선택 → 미리보기 확인 → 적용</small>
          </div>
          <button type="button" class="cerc-close" aria-label="닫기">×</button>
        </div>
        <div class="cerc-body">
          <section class="cerc-card">
            <div class="cerc-card-head">
              <strong>자동 후보</strong>
              <small data-role="candidate-count"></small>
            </div>
            <div class="cerc-card-body">
              <div class="cerc-row">
                <input class="cerc-input" data-role="filter" placeholder="후보 검색" autocomplete="off">
              </div>
              <div class="cerc-row">
                <input class="cerc-input" data-role="direct" placeholder="직접 찾을 말 입력" autocomplete="off">
                <button type="button" class="cerc-btn" data-action="add-direct">추가</button>
              </div>
              <div class="cerc-row">
                <button type="button" class="cerc-btn cerc-ghost" data-action="add-selection">드래그한 글자 추가</button>
                <button type="button" class="cerc-btn cerc-ghost" data-action="refresh">새로고침</button>
              </div>
              <p class="cerc-muted">반복해서 나온 단어를 자동으로 보여줘. 누르면 선택 목록에 들어감. 삭제는 기본적으로 주변 공백을 자동 정리해.</p>
              <div class="cerc-chip-list" data-role="candidates"></div>
            </div>
          </section>

          <section class="cerc-card">
            <div class="cerc-card-head">
              <strong>선택한 단어</strong>
              <small data-role="rule-count"></small>
            </div>
            <div class="cerc-card-body">
              <div class="cerc-rule-list" data-role="rules"></div>
              <div class="cerc-footer">
                <button type="button" class="cerc-btn cerc-danger" data-action="clear-rules">선택 비우기</button>
                <button type="button" class="cerc-btn" data-action="undo">방금 적용 취소</button>
              </div>
            </div>
          </section>

          <section class="cerc-card">
            <div class="cerc-card-head">
              <strong>실시간 미리보기</strong>
              <div class="cerc-preview-tabs">
                <button type="button" class="cerc-tab" data-preview-tab="mark" data-active="true">위치 보기</button>
                <button type="button" class="cerc-tab" data-preview-tab="after">적용 후</button>
              </div>
            </div>
            <div class="cerc-card-body">
              <div class="cerc-highlight-box" data-role="mark-preview"></div>
              <textarea class="cerc-textarea" data-role="after-preview" readonly hidden></textarea>
              <div class="cerc-preview-note" data-role="preview-note"></div>
              <div class="cerc-footer">
                <div class="cerc-status" data-role="status"></div>
                <button type="button" class="cerc-btn" data-action="copy-after">미리보기 복사</button>
                <button type="button" class="cerc-btn cerc-primary" data-action="apply">수정창에 적용</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;
  }

  function bindPanelEvents(panel) {
    panel.addEventListener('click', (event) => {
      const target = event.target;
      if (target === panel) {
        closePanel();
        return;
      }

      const close = target.closest?.('.cerc-close');
      if (close) {
        closePanel();
        return;
      }

      const chip = target.closest?.('.cerc-chip[data-term]');
      if (chip) {
        toggleRule(chip.dataset.term || '');
        return;
      }

      const previewMark = target.closest?.('.cerc-mark[data-rule-id][data-match-index]');
      if (previewMark) {
        toggleExcludedMatch(previewMark.dataset.ruleId || '', previewMark.dataset.matchIndex || '');
        return;
      }

      const remove = target.closest?.('[data-remove-rule]');
      if (remove) {
        removeRule(remove.dataset.removeRule || '');
        return;
      }

      const previewTab = target.closest?.('[data-preview-tab]');
      if (previewTab) {
        setPreviewTab(previewTab.dataset.previewTab || 'mark');
        return;
      }

      const actionButton = target.closest?.('[data-action]');
      if (!actionButton) return;

      const action = actionButton.dataset.action;
      if (action === 'add-direct') addDirectTerm();
      if (action === 'add-selection') addSelectionTerm();
      if (action === 'refresh') refreshFromEditor('수정창 내용을 다시 읽었어.');
      if (action === 'clear-rules') clearRules();
      if (action === 'undo') undoLastApply();
      if (action === 'apply') applyToActiveEditor();
      if (action === 'copy-after') copyAfterPreview();
    }, true);

    panel.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.matches('[data-role="filter"]')) {
        state.filter = target.value || '';
        renderCandidates();
        return;
      }

      if (target.matches('[data-rule-mode]')) {
        const rule = findRule(target.dataset.ruleMode || '');
        if (rule) {
          rule.mode = target.value === 'replace' ? 'replace' : 'delete';
          if (!rule.spaceMode) rule.spaceMode = rule.mode === 'delete' ? 'smart' : 'exact';
          clearRuleExcludedMatches(rule.id);
          state.status = '작업 방식을 바꿔서 이 단어의 개별 제외 기록을 초기화했어.';
          renderRules();
          renderPreview();
          renderStatus();
        }
        return;
      }

      if (target.matches('[data-rule-space]')) {
        const rule = findRule(target.dataset.ruleSpace || '');
        if (rule) {
          rule.spaceMode = ['exact', 'smart', 'left', 'right', 'both'].includes(target.value) ? target.value : 'exact';
          clearRuleExcludedMatches(rule.id);
          state.status = '공백 처리 범위를 바꿔서 이 단어의 개별 제외 기록을 초기화했어.';
          renderRules();
          renderPreview();
          renderStatus();
        }
        return;
      }

      if (target.matches('[data-rule-replacement]')) {
        const rule = findRule(target.dataset.ruleReplacement || '');
        if (rule) {
          rule.replacement = target.value || '';
          renderPreview();
        }
      }
    }, true);

    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closePanel();
        return;
      }

      if (event.key === 'Enter' && event.target?.matches?.('[data-role="direct"]')) {
        event.preventDefault();
        addDirectTerm();
      }
    }, true);
  }

  function bindEditorInput(editor) {
    if (!(editor instanceof HTMLElement)) return;

    if (boundEditor && editorInputHandler) {
      boundEditor.removeEventListener('input', editorInputHandler, true);
    }

    editorInputHandler = () => scheduleEditorSync();
    boundEditor = editor;
    editor.addEventListener('input', editorInputHandler, true);
  }

  function scheduleEditorSync() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || panel.hidden) return;
    if (syncScheduled) return;

    syncScheduled = true;
    setTimeout(() => {
      syncScheduled = false;
      refreshFromEditor('수정창 변경 감지됨. 미리보기를 갱신했어.');
    }, 120);
  }

  function refreshFromEditor(message) {
    if (activeEditor && document.contains(activeEditor)) {
      const nextSourceText = getEditorText(activeEditor);
      const sourceChanged = nextSourceText !== state.sourceText;
      state.sourceText = nextSourceText;
      state.candidates = extractCandidates(state.sourceText);

      if (sourceChanged && state.excludedMatches.size) {
        clearAllExcludedMatches();
        state.status = `${message || '수정창 내용을 다시 읽었어.'} 원문 위치가 바뀌어서 개별 제외 기록은 초기화했어.`;
      } else {
        state.status = message || state.status;
      }
      renderPanel();
    }
  }
  function addRule(term) {
    const target = String(term || '').trim();
    if (!target) return false;
    if (state.rules.some((rule) => rule.target === target)) return false;

    state.rules.push({
      id: makeId(),
      target,
      mode: 'delete',
      spaceMode: 'smart',
      replacement: '',
    });
    rememberTerm(target);
    state.status = `“${target}” 선택됨. 기본은 삭제, 치환하려면 가운데 옵션을 바꿔줘. 창을 닫으면 선택 목록은 초기화돼.`;
    renderPanel();
    return true;
  }

  function toggleRule(term) {
    const target = String(term || '').trim();
    if (!target) return;
    const found = state.rules.find((rule) => rule.target === target);
    if (found) removeRule(found.id);
    else addRule(target);
  }

  function findRule(id) {
    return state.rules.find((rule) => rule.id === id);
  }

  function removeRule(id) {
    const before = state.rules.length;
    state.rules = state.rules.filter((rule) => rule.id !== id);
    clearRuleExcludedMatches(id);
    if (state.rules.length !== before) state.status = '선택 목록에서 뺐어.';
    renderPanel();
  }
  function clearRules() {
    state.rules = [];
    clearAllExcludedMatches();
    state.status = '선택 목록을 비웠어.';
    renderPanel();
  }
  function addDirectTerm() {
    const panel = document.getElementById(PANEL_ID);
    const input = panel?.querySelector('[data-role="direct"]');
    const value = input?.value || '';

    if (!value.trim()) {
      state.status = '직접 추가할 단어를 입력해줘.';
      renderStatus();
      return;
    }

    addRule(value.trim());
    if (input) input.value = '';
  }

  function addSelectionTerm() {
    const selected = getSelectedPageText();
    if (!selected) {
      state.status = '먼저 수정창이나 페이지에서 글자를 드래그해줘.';
      renderStatus();
      return;
    }

    addRule(selected);
  }

  function undoLastApply() {
    if (!lastEditor || lastBeforeText === null || !document.contains(lastEditor)) {
      state.status = '되돌릴 적용 기록이 없어.';
      renderStatus();
      return;
    }

    setEditorText(lastEditor, lastBeforeText);
    activeEditor = lastEditor;
    refreshFromEditor('방금 적용 전 텍스트로 되돌렸어.');
  }

  function applyToActiveEditor() {
    if (!(activeEditor instanceof HTMLElement) || !document.contains(activeEditor)) {
      state.status = '수정창을 찾지 못했어. 창을 닫고 다시 “단어 정리”를 눌러줘.';
      renderStatus();
      return;
    }

    if (!state.rules.length) {
      state.status = '선택한 단어가 없어. 왼쪽 후보를 먼저 눌러줘.';
      renderStatus();
      return;
    }

    const before = getEditorText(activeEditor);
    const result = applyRulesToText(before, state.rules);

    if (!result.total || result.text === before) {
      state.status = '바뀐 내용이 없어. 선택 단어가 현재 수정창에 있는지 확인해줘.';
      renderStatus();
      return;
    }

    lastEditor = activeEditor;
    lastBeforeText = before;

    const ok = setEditorText(activeEditor, result.text);
    if (!ok) {
      state.status = '적용 실패. 수정창을 다시 열고 시도해줘.';
      renderStatus();
      return;
    }

    state.status = `${result.total}개 적용 완료. 저장하려면 크랙의 “수정 완료”를 눌러줘.`;
    refreshFromEditor(state.status);
  }

  function copyAfterPreview() {
    const result = applyRulesToText(state.sourceText, state.rules);
    const text = result.text;

    const fallback = () => {
      const panel = document.getElementById(PANEL_ID);
      const textarea = panel?.querySelector('[data-role="after-preview"]');
      if (textarea) {
        textarea.hidden = false;
        textarea.focus();
        textarea.select();
      }
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        state.status = '적용 후 미리보기를 복사했어.';
        renderStatus();
      }).catch(() => {
        state.status = '복사 권한이 막혀서 미리보기 칸을 선택해뒀어.';
        renderStatus();
        fallback();
      });
    } else {
      state.status = '복사 기능을 못 써서 미리보기 칸을 선택해뒀어.';
      renderStatus();
      fallback();
    }
  }

  function setPreviewTab(tab) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const normalized = tab === 'after' ? 'after' : 'mark';
    state.previewTab = normalized;
    savePreviewTab(normalized);

    const useAfter = normalized === 'after';
    panel.querySelectorAll('[data-preview-tab]').forEach((button) => {
      button.dataset.active = button.dataset.previewTab === normalized ? 'true' : 'false';
    });

    const mark = panel.querySelector('[data-role="mark-preview"]');
    const after = panel.querySelector('[data-role="after-preview"]');
    if (mark) mark.hidden = useAfter;
    if (after) after.hidden = !useAfter;
  }

  function renderPanel() {
    renderHeaderCounts();
    renderCandidates();
    renderRules();
    renderPreview();
    renderStatus();
    setPreviewTab(state.previewTab || 'mark');

    const panel = document.getElementById(PANEL_ID);
    const filter = panel?.querySelector('[data-role="filter"]');
    if (filter && filter.value !== state.filter) filter.value = state.filter;
  }

  function renderHeaderCounts() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const candidateCount = panel.querySelector('[data-role="candidate-count"]');
    const ruleCount = panel.querySelector('[data-role="rule-count"]');
    if (candidateCount) candidateCount.textContent = `${state.candidates.length}개`;
    if (ruleCount) ruleCount.textContent = `${state.rules.length}개 선택`;
  }

  function renderCandidates() {
    const panel = document.getElementById(PANEL_ID);
    const box = panel?.querySelector('[data-role="candidates"]');
    if (!box) return;

    const filter = String(state.filter || '').trim().toLowerCase();
    const selected = new Set(state.rules.map((rule) => rule.target));
    const shown = state.candidates
      .filter((item) => !filter || item.text.toLowerCase().includes(filter))
      .slice(0, MAX_CANDIDATES);

    if (!shown.length) {
      box.innerHTML = `<div class="cerc-empty">후보가 없어. 직접 찾을 말을 추가해줘.</div>`;
      return;
    }

    box.innerHTML = shown.map((item) => `
      <button type="button" class="cerc-chip" data-term="${escapeAttr(item.text)}" data-selected="${selected.has(item.text) ? 'true' : 'false'}" title="${escapeAttr(item.text)}">
        <span class="cerc-chip-text">${escapeHtml(item.text)}</span>
        <span class="cerc-chip-count">${item.count}</span>
      </button>
    `).join('');
  }

  function renderRules() {
    const panel = document.getElementById(PANEL_ID);
    const box = panel?.querySelector('[data-role="rules"]');
    if (!box) return;

    if (!state.rules.length) {
      box.innerHTML = `<div class="cerc-empty">왼쪽 후보를 누르면 여기에 들어와.<br>기본은 삭제, 필요하면 치환으로 변경.</div>`;
      return;
    }

    box.innerHTML = state.rules.map((rule) => {
      const stats = getRuleMatchStats(state.sourceText, rule);
      const countText = stats.excluded
        ? `적용 ${stats.included}개 · 제외 ${stats.excluded}개`
        : `현재 ${stats.total}개`;
      const disabled = rule.mode === 'delete' ? 'disabled' : '';
      return `
        <div class="cerc-rule" data-rule-id="${escapeAttr(rule.id)}">
          <div class="cerc-rule-top">
            <div class="cerc-target" title="${escapeAttr(rule.target)}">${escapeHtml(rule.target)}</div>
            <div class="cerc-count">${countText}</div>
          </div>
          <div class="cerc-rule-grid">
            <select class="cerc-select" data-rule-mode="${escapeAttr(rule.id)}" title="작업">
              <option value="delete" ${rule.mode === 'delete' ? 'selected' : ''}>삭제</option>
              <option value="replace" ${rule.mode === 'replace' ? 'selected' : ''}>치환</option>
            </select>
            <select class="cerc-select" data-rule-space="${escapeAttr(rule.id)}" title="공백 처리">
              <option value="smart" ${getRuleSpaceMode(rule) === 'smart' ? 'selected' : ''}>공백 자동</option>
              <option value="exact" ${getRuleSpaceMode(rule) === 'exact' ? 'selected' : ''}>단어만</option>
              <option value="left" ${getRuleSpaceMode(rule) === 'left' ? 'selected' : ''}>앞공백</option>
              <option value="right" ${getRuleSpaceMode(rule) === 'right' ? 'selected' : ''}>뒤공백</option>
              <option value="both" ${getRuleSpaceMode(rule) === 'both' ? 'selected' : ''}>양쪽공백</option>
            </select>
            <input class="cerc-input" data-rule-replacement="${escapeAttr(rule.id)}" value="${escapeAttr(rule.replacement || '')}" placeholder="바꿀 말" ${disabled}>
            <button type="button" class="cerc-mini-btn" data-remove-rule="${escapeAttr(rule.id)}" title="빼기">×</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderPreview() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const markPreview = panel.querySelector('[data-role="mark-preview"]');
    const afterPreview = panel.querySelector('[data-role="after-preview"]');
    const note = panel.querySelector('[data-role="preview-note"]');

    const result = applyRulesToText(state.sourceText, state.rules);
    const excludedCount = getExcludedMatchCount(state.sourceText, state.rules);
    const clippedSource = clipText(state.sourceText, MAX_PREVIEW_CHARS);
    const clippedAfter = clipText(result.text, MAX_PREVIEW_CHARS);

    if (markPreview) markPreview.innerHTML = renderHighlighted(clippedSource.text, state.rules) + (clippedSource.clipped ? '\n\n…미리보기 길이 때문에 일부 생략됨' : '');
    if (afterPreview) afterPreview.value = clippedAfter.text + (clippedAfter.clipped ? '\n\n…미리보기 길이 때문에 일부 생략됨' : '');

    if (note) {
      if (!state.rules.length) note.textContent = '선택한 단어가 없어서 원문 그대로 보여줘.';
      else if (excludedCount) note.textContent = `예상 변경 ${result.total}개 · 개별 제외 ${excludedCount}개 · 적용 후 글자수 ${result.text.length.toLocaleString()}자`;
      else note.textContent = `노란 표시를 누르면 그 위치만 제외 · 예상 변경 ${result.total}개 · 적용 후 글자수 ${result.text.length.toLocaleString()}자`;
    }
  }
  function renderStatus() {
    const panel = document.getElementById(PANEL_ID);
    const status = panel?.querySelector('[data-role="status"]');
    if (status) status.textContent = state.status || '';
  }

  function clipText(text, max) {
    const value = String(text || '');
    if (value.length <= max) return { text: value, clipped: false };
    return { text: value.slice(0, max), clipped: true };
  }

  function renderHighlighted(text, rules) {
    const value = String(text || '');
    const ranges = [];

    uniqRules(rules).forEach((rule, ruleOrder) => {
      const re = makeRuleRegExp(rule);
      if (!re) return;

      let match;
      let matchIndex = 0;
      while ((match = re.exec(value))) {
        if (!match[0]) {
          re.lastIndex += 1;
          continue;
        }

        ranges.push({
          start: match.index,
          end: match.index + match[0].length,
          ruleId: rule.id,
          ruleOrder,
          matchIndex,
          excluded: isMatchExcluded(rule.id, matchIndex),
        });
        matchIndex += 1;
      }
    });

    if (!ranges.length) return escapeHtml(value);

    ranges.sort((a, b) => a.start - b.start || a.ruleOrder - b.ruleOrder || b.end - a.end);

    // 서로 겹치는 규칙은 HTML에서 동시에 표시할 수 없으므로,
    // 먼저 선택된 규칙의 개별 표시를 우선한다. 기존처럼 범위를 합치지는 않는다.
    const visibleRanges = [];
    let occupiedUntil = -1;
    for (const range of ranges) {
      if (range.start < occupiedUntil) continue;
      visibleRanges.push(range);
      occupiedUntil = range.end;
    }

    let html = '';
    let cursor = 0;
    for (const range of visibleRanges) {
      html += escapeHtml(value.slice(cursor, range.start));
      const excluded = range.excluded ? 'true' : 'false';
      const title = range.excluded
        ? '개별 제외됨 · 클릭하면 다시 적용'
        : '클릭하면 이 위치만 적용에서 제외';
      html += `<mark class="cerc-mark" data-rule-id="${escapeAttr(range.ruleId)}" data-match-index="${range.matchIndex}" data-excluded="${excluded}" title="${title}">${escapeHtml(value.slice(range.start, range.end))}</mark>`;
      cursor = range.end;
    }
    html += escapeHtml(value.slice(cursor));
    return html;
  }
  function boot() {
    purgeLegacyRecentTerms();
    ensureStyle();
    queueDoneButtons(document);

    const observer = new MutationObserver(handleCleanerMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    document.addEventListener('focusin', event => {
      const editor = event.target?.closest?.(EDITOR_HINT);
      if (!editor) return;
      queueDoneButtons(editor.closest('[data-message-group-id], [role="dialog"]') || editor.parentElement);
      for (const known of knownDoneButtons) if (known.isConnected) pendingDoneButtons.add(known);
      if (pendingDoneButtons.size) scheduleInject();
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
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
    // 실패한 요청과 같은 메시지를 위한 반복 새로고침은 간격을 두 배씩 늘립니다.
    const API_RETRY_MAX_INTERVAL = 60000;

    let lastUrlKey = getUrlKey();
    let scanTimer = null;
    let apiCache = null;
    let apiPromise = null;
    let forcedApiRefreshPromise = null;
    let lastForcedApiRefreshAt = 0;
    let apiRetryAt = 0;
    let apiRetryDelay = API_FORCE_REFRESH_MIN_INTERVAL;
    const resultCache = new Map();
    const refreshBackoff = new Map();
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
        apiRetryAt = 0;
        apiRetryDelay = API_FORCE_REFRESH_MIN_INTERVAL;
        resultCache.clear();
        refreshBackoff.clear();
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
        refreshBackoff.clear();

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
        if (Date.now() < apiRetryAt) throw new Error('messages fetch backoff');

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
                apiRetryAt = 0;
                apiRetryDelay = API_FORCE_REFRESH_MIN_INTERVAL;
                return apiCache;
            })
            .catch(err => {
                console.warn(`${LOG_PREFIX} API resolve failed:`, err);
                apiCache = null;
                apiRetryAt = Date.now() + apiRetryDelay;
                apiRetryDelay = Math.min(API_RETRY_MAX_INTERVAL, apiRetryDelay * 2);
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
        let oldestTime = Infinity;

        messages.forEach((msg, index) => {
            const id = messageIdOf(msg);
            if (!id) return;
            idMap.set(id, msg);
            apiIndexMap.set(id, index);
            const time = objectIdToDate(id)?.getTime();
            if (time < oldestTime) oldestTime = time;
        });

        return { messages, idMap, apiIndexMap, oldestTime };
    }

    // 강제 새로고침은 같은 최신 MESSAGE_LIMIT개를 다시 받습니다. 스크롤로 불러온
    // 그보다 오래된 메시지나 ObjectId가 없는 그룹은 몇 번을 받아도 나오지 않습니다.
    function refreshCanReach(group) {
        const date = objectIdToDate(getGroupMessageId(group));
        if (!date) return false;
        if (!apiCache || apiCache.messages.length < MESSAGE_LIMIT) return true;
        return date.getTime() >= apiCache.oldestTime;
    }

    function takeRefreshTurn(key) {
        const now = Date.now();
        const turn = refreshBackoff.get(key) || { nextAt: 0, delay: API_FORCE_REFRESH_MIN_INTERVAL };
        if (now < turn.nextAt) return false;
        turn.nextAt = now + turn.delay;
        turn.delay = Math.min(API_RETRY_MAX_INTERVAL, turn.delay * 2);
        refreshBackoff.set(key, turn);
        return true;
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
                    // 방금 만든 리롤이 아직 캐시에 없으면 첫 답변 정보로 임시 표시만 하고
                    // 캐시하지 않아, 새로고침 뒤 현재 답변 기준으로 다시 계산합니다.
                    return {
                        ...enrichResolvedWithMessage(fallback, idMap.get(fallback.messageId), 'api-message'),
                        provisional: true
                    };
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
        if (resolved?.provisional) return;
        if (!getSetting('showChars') || hasResolvedChars(resolved)) {
            resultCache.set(key, resolved);
            refreshBackoff.delete(key);
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
            const needsRefresh = resolved.provisional ||
                (getSetting('showChars') && !hasResolvedChars(resolved));

            cacheResolvedIfReady(key, resolved);
            setBadge(group, resolved);

            // 새 답변은 기존 messages API 캐시에 아직 없을 수 있습니다.
            // 글자수가 필요하지만 못 구한 경우에만 API 캐시를 새로고침한 뒤 재확인합니다.
            if (needsRefresh && group.isConnected) {
                if (!refreshCanReach(group)) {
                    // 받을 수 있는 창 밖의 메시지는 시간만 표시하고 재시도하지 않습니다.
                    retryGroups.delete(group);
                    return;
                }
                if (!takeRefreshTurn(key)) return;
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
                        if (Date.now() < apiRetryAt) return;
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
    const btn = container?.querySelector?.(`button:not(#${TOOLBAR_BUTTON_ID})`);
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

    // This runs every 1.5s; rewriting an unchanged class still emits mutations.
    const nextClass = `${nativeButtonClass(container)} ciw-native-toolbar-btn`;
    if (btn.className !== nextClass) btn.className = nextClass;

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

// Bubble menu / double-click edit: adapted from the enabled ZIP script
// "간단 리롤 & 메시지 우클릭 캡처 메뉴" v1.1.4. Capture controls are omitted.
// Bubble wrapping follows the enabled Crack UI Plus implementation rather
// than the disabled, broad "줄바꿈 최적화" script's Markdown-root pre-wrap.
(() => {
  'use strict';

  const STYLE_ID = 'ccb-bubble-menu-and-wrap-style';
  const LINE_BREAK_CLASS = 'crack-ui-line-break-optimize';
  const LINE_BREAK_KEY = 'crack_ui_line_break_optimize';
  const COPY_CLASS = 'ccb-context-copy-item';
  const MENU_ITEM_CLASS = [
    'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
    'focus:bg-accent focus:text-accent-foreground',
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'
  ].join(' ');
  let menuBusy = false;
  let editBusy = false;

  function installBubbleStyle() {
    const html = document.documentElement;
    if (!html) return;
    try {
      const saved = localStorage.getItem(LINE_BREAK_KEY);
      if (saved == null || saved === '1') html.classList.add(LINE_BREAK_CLASS);
    } catch (_) {
      html.classList.add(LINE_BREAK_CLASS);
    }

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html.${LINE_BREAK_CLASS} [data-message-group-id] div.break-all { word-break: keep-all !important; }
      html.${LINE_BREAK_CLASS} [data-message-group-id] .wrtn-markdown,
      html.${LINE_BREAK_CLASS} [data-message-group-id] .wrtn-markdown * {
        max-width: 100% !important;
        text-align: left !important;
        word-break: keep-all !important;
        overflow-wrap: break-word !important;
      }
      html.${LINE_BREAK_CLASS} [data-message-group-id] .wrtn-markdown,
      html.${LINE_BREAK_CLASS} [data-message-group-id] .wrtn-markdown ul,
      html.${LINE_BREAK_CLASS} [data-message-group-id] .wrtn-markdown ol,
      html.${LINE_BREAK_CLASS} [data-message-group-id] .wrtn-markdown li,
      html.${LINE_BREAK_CLASS} [data-message-group-id] .wrtn-markdown blockquote {
        white-space: normal !important;
      }
      html.${LINE_BREAK_CLASS} [data-message-group-id] .wrtn-markdown p,
      html.${LINE_BREAK_CLASS} [data-message-group-id] .wrtn-markdown em,
      html.${LINE_BREAK_CLASS} [data-message-group-id] .wrtn-markdown strong,
      html.${LINE_BREAK_CLASS} [data-message-group-id] .wrtn-markdown span,
      html.${LINE_BREAK_CLASS} [data-message-group-id] .wrtn-markdown a {
        white-space: pre-wrap !important;
      }
      body[data-ccb-opening-message-menu="1"] [data-radix-popper-content-wrapper],
      body[data-ccb-doubleclick-edit="1"] [data-radix-popper-content-wrapper] {
        opacity: 0 !important;
        pointer-events: none !important;
        transition: none !important;
        animation: none !important;
      }
      body[data-ccb-opening-message-menu="1"] [data-radix-popper-content-wrapper] {
        transform: translate(-9999px, -9999px) !important;
      }
      /* The menu content animates itself; Radix would keep the hidden menu
         mounted for its exit animation, so it could flash after the flag. */
      body[data-ccb-opening-message-menu="1"] [data-radix-popper-content-wrapper] *,
      body[data-ccb-doubleclick-edit="1"] [data-radix-popper-content-wrapper] * {
        transition: none !important;
        animation: none !important;
      }
      .${COPY_CLASS} { cursor: pointer !important; }
      .${COPY_CLASS}:hover { background: rgba(127,127,127,.16) !important; }
      .${COPY_CLASS} svg {
        width: 18px !important;
        height: 18px !important;
        flex: 0 0 auto !important;
        fill: var(--icon_primary) !important;
      }
      .${COPY_CLASS}.ccb-copied { opacity: .72; }
    `;
    html.appendChild(style);
  }
  }
  if (document.documentElement) installBubbleStyle();
  else document.addEventListener('DOMContentLoaded', installBubbleStyle, { once: true });

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const cleanText = text => String(text || '').replace(/\s+/g, ' ').trim();
  function findEditMenuItem(menu) {
    const items = Array.from(menu?.querySelectorAll('[role="menuitem"]') || []);
    return items.find(node => cleanText(node.textContent) === '수정') ||
      items.find(node => cleanText(node.textContent).includes('수정')) || null;
  }
  function isVisible(el) {
    if (!el?.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function getReactProps(el) {
    const key = Object.keys(el || {}).find(name =>
      name.startsWith('__reactProps$') || name.startsWith('__reactEventHandlers$') || name.startsWith('__reactProps')
    );
    return key ? el[key] : null;
  }

  function fakeEvent(el, type) {
    let defaultPrevented = false;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const event = {
      type, target: el, currentTarget: el, button: 0,
      buttons: type.toLowerCase().includes('down') ? 1 : 0,
      clientX: x, clientY: y, screenX: x, screenY: y,
      pointerType: 'mouse', isPrimary: true,
      ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
      detail: 1, defaultPrevented: false, nativeEvent: null,
      preventDefault() { defaultPrevented = true; this.defaultPrevented = true; },
      stopPropagation() {}, stopImmediatePropagation() {},
      isDefaultPrevented() { return defaultPrevented; },
      isPropagationStopped() { return false; }, persist() {}
    };
    event.nativeEvent = event;
    return event;
  }

  function callReactPointerDown(el) {
    const handler = getReactProps(el)?.onPointerDown;
    if (typeof handler !== 'function') return false;
    try { handler(fakeEvent(el, 'pointerdown')); return true; } catch (_) { return false; }
  }

  function callReactKeyDown(el, key) {
    const handler = getReactProps(el)?.onKeyDown;
    if (typeof handler !== 'function') return false;
    const event = fakeEvent(el, 'keydown');
    event.key = event.code = key;
    try { handler(event); return true; } catch (_) { return false; }
  }

  function dispatchPointerPress(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    // No `view`: Tampermonkey passes @grant scripts a Proxy as `window`, and
    // the MouseEvent/PointerEvent constructors reject it with a TypeError.
    const base = {
      bubbles: true, cancelable: true, composed: true,
      button: 0, buttons: 1, clientX: x, clientY: y, screenX: x, screenY: y,
      ctrlKey: false, shiftKey: false, altKey: false, metaKey: false
    };
    const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    try {
      el.dispatchEvent(new PointerEvent('pointerover', pointer));
      el.dispatchEvent(new PointerEvent('pointerenter', pointer));
      el.dispatchEvent(new PointerEvent('pointerdown', pointer));
    } catch (_) {}
    el.dispatchEvent(new MouseEvent('mouseover', base));
    el.dispatchEvent(new MouseEvent('mouseenter', base));
    el.dispatchEvent(new MouseEvent('mousedown', base));
    try { el.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 })); } catch (_) {}
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
  }

  function messageRoot(target) {
    const markdown = target?.closest?.('.wrtn-markdown');
    return markdown?.closest('[data-message-group-id]') || null;
  }

  function optionTrigger(root) {
    if (!root) return null;
    // Crack's message trigger is a Radix div.dropdown-button with an inner
    // button. Older snapshots lack its aria-label, so fall back to the source
    // script's "…" icon path before the structural guesses.
    const triggers = Array.from(root.querySelectorAll('[aria-haspopup="menu"]'))
      .filter(el => isVisible(el) && el.getAttribute('aria-disabled') !== 'true');
    const labelled = '[aria-label="메시지 옵션"]';
    const moreIcon = 'path[d^="M7.04 10.73H4.5v2.54"]';
    return triggers.find(el => el.matches(labelled) || el.querySelector(labelled)) ||
      triggers.find(el => el.querySelector(moreIcon)) ||
      triggers.find(el => el.classList.contains('dropdown-button') && el.querySelector('button')) ||
      triggers.find(el => el.querySelector('button')) ||
      null;
  }

  function openOptionMenu(trigger) {
    if (!trigger?.id) return null;
    return Array.from(document.querySelectorAll('[role="menu"]')).find(menu =>
      isVisible(menu) && menu.getAttribute('aria-labelledby') === trigger.id &&
      /분기|수정|삭제/.test(cleanText(menu.textContent))
    ) || null;
  }

  async function waitForMenu(trigger) {
    for (let attempt = 0; attempt < 18; attempt++) {
      const menu = openOptionMenu(trigger);
      if (menu) return menu;
      await sleep(45);
    }
    return null;
  }

  const triggerOpen = trigger => trigger.getAttribute('aria-expanded') === 'true' ||
    trigger.getAttribute('data-state') === 'open';

  async function showOptionMenu(trigger) {
    let menu = openOptionMenu(trigger);
    if (menu) return menu;
    // Radix toggles its trigger on pointerdown (button 0, ctrlKey false) or
    // Enter, never on click. Try each route once, and skip a press while the
    // trigger already reports open: a second toggle would close the menu.
    const button = trigger.querySelector?.('button') || trigger;
    const attempts = [
      () => callReactPointerDown(trigger),
      () => { dispatchPointerPress(button); return true; },
      // Call the Enter handler directly: a dispatched Enter would also hit
      // Crack's `enter` hotkey (focus chat input) and stay held (see below).
      () => callReactKeyDown(trigger, 'Enter')
    ];
    for (const attempt of attempts) {
      if (!triggerOpen(trigger) && !attempt()) continue;
      menu = await waitForMenu(trigger);
      if (menu) return menu;
    }
    return null;
  }

  function placeMenuAtCursor(menu, clientX, clientY) {
    const wrapper = menu.closest('[data-radix-popper-content-wrapper]');
    if (!wrapper) return;
    wrapper.style.setProperty('position', 'fixed', 'important');
    wrapper.style.setProperty('left', '0px', 'important');
    wrapper.style.setProperty('top', '0px', 'important');
    wrapper.style.setProperty('right', 'auto', 'important');
    wrapper.style.setProperty('bottom', 'auto', 'important');
    wrapper.style.setProperty('will-change', 'auto', 'important');
    const rect = wrapper.getBoundingClientRect();
    const x = Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8));
    const y = Math.max(8, Math.min(clientY, window.innerHeight - rect.height - 8));
    wrapper.style.setProperty('transform', `translate(${x}px, ${y}px)`, 'important');
    wrapper.dataset.ccbCursorMenu = '1';
  }

  // Close through the menu's own trigger. A dispatched Escape keydown has no
  // keyup, so Crack's hotkey tracker keeps Escape held until the window blurs,
  // and each later Ctrl/Shift press matches its `esc` bindings (요약 메모리
  // toggle, chat input blur). Radix toggles the trigger on pointerdown.
  function closeOptionMenu(trigger) {
    if (!trigger?.isConnected || !triggerOpen(trigger)) return;
    if (!callReactPointerDown(trigger)) dispatchPointerPress(trigger.querySelector('button') || trigger);
  }

  async function messageTextToCopy(root) {
    // Keep the source script's raw-message behavior when a compatible shared
    // core is already present. Do not load a new external library just to copy.
    const roomId = location.pathname.match(/\/(?:episodes|chats?|c)\/([^/?#]+)/)?.[1] || '';
    const messageId = root?.getAttribute('data-message-group-id') || '';
    const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    const core = pageWindow?.CrackUtil || window.CrackUtil;
    if (core?.chatRoom && roomId && messageId) {
      try {
        const message = await core.chatRoom().getMessage(roomId, messageId);
        if (!(message instanceof Error) && typeof message?.content === 'string' && message.content) {
          return message.content;
        }
      } catch (_) {}
    }
    const markdown = root?.querySelector('.wrtn-markdown');
    return (markdown?.innerText || markdown?.textContent || '').trim();
  }

  function addCopyItem(menu, root, trigger) {
    menu.__ccbCopyRoot = root;
    menu.__ccbCopyTrigger = trigger;
    let item = menu.querySelector(`:scope > .${COPY_CLASS}`);
    if (!item) {
      item = document.createElement('div');
      item.className = `${MENU_ITEM_CLASS} ${COPY_CLASS}`;
      item.setAttribute('role', 'menuitem');
      item.setAttribute('tabindex', '-1');
      item.setAttribute('data-orientation', 'vertical');
      item.setAttribute('data-radix-collection-item', '');
      item.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M8 3.2h9.2c.88 0 1.6.72 1.6 1.6V14c0 .88-.72 1.6-1.6 1.6H8c-.88 0-1.6-.72-1.6-1.6V4.8c0-.88.72-1.6 1.6-1.6m0 1.6V14h9.2V4.8z" clip-rule="evenodd"></path><path d="M4.8 8H3.2v11.2c0 .88.72 1.6 1.6 1.6H16V19.2H4.8z"></path></svg><span>복사</span>';
      item.addEventListener('mousedown', event => {
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      }, true);
      item.addEventListener('click', async event => {
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
        const label = item.querySelector('span');
        try {
          const text = await messageTextToCopy(menu.__ccbCopyRoot);
          if (!text) throw new Error('empty message');
          await navigator.clipboard.writeText(text);
          if (label) label.textContent = '복사됨';
          item.classList.add('ccb-copied');
          setTimeout(() => closeOptionMenu(menu.__ccbCopyTrigger), 230);
        } catch (_) {
          if (label) label.textContent = '복사 실패';
          setTimeout(() => {
            if (label) label.textContent = '복사';
            item.classList.remove('ccb-copied');
          }, 900);
        }
      }, true);
      menu.prepend(item);
    }
    item.classList.remove('ccb-copied');
    item.querySelector('span').textContent = '복사';
  }

  function ignoreMenuTarget(target) {
    return !!target?.closest?.('input, textarea, select, [contenteditable="true"], [data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], .rr-side-nav, .rr-message-hold-overlay');
  }

  document.addEventListener('contextmenu', event => {
    if (ignoreMenuTarget(event.target)) return;
    if (Date.now() < Number(document.body?.dataset.rrSuppressBubbleMenuUntil || 0)) return;
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    const root = messageRoot(event.target);
    const trigger = optionTrigger(root);
    if (!trigger || menuBusy) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    menuBusy = true;
    document.body.dataset.ccbOpeningMessageMenu = '1';
    (async () => {
      try {
        const menu = await showOptionMenu(trigger);
        if (!menu) {
          closeOptionMenu(trigger);
          return;
        }
        addCopyItem(menu, root, trigger);
        placeMenuAtCursor(menu, event.clientX, event.clientY);
        requestAnimationFrame(() => {
          placeMenuAtCursor(menu, event.clientX, event.clientY);
          requestAnimationFrame(() => { delete document.body.dataset.ccbOpeningMessageMenu; });
        });
        setTimeout(() => placeMenuAtCursor(menu, event.clientX, event.clientY), 80);
      } catch (_) {
        closeOptionMenu(trigger);
      } finally {
        setTimeout(() => {
          delete document.body.dataset.ccbOpeningMessageMenu;
          menuBusy = false;
        }, 180);
      }
    })();
  }, true);

  function ignoreEditTarget(target) {
    return !!target?.closest?.('input, textarea, select, [contenteditable="true"], button, a, [role="button"], [role="menuitem"], [data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], .rr-side-nav, .rr-message-hold-overlay, pre, code');
  }

  document.addEventListener('dblclick', event => {
    if (Date.now() < Number(document.body?.dataset.rrSuppressBubbleClickUntil || 0)) return;
    if (ignoreEditTarget(event.target) || editBusy) return;
    const root = messageRoot(event.target);
    const trigger = optionTrigger(root);
    if (!trigger) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    try { window.getSelection()?.removeAllRanges(); } catch (_) {}
    editBusy = true;
    document.body.dataset.ccbDoubleclickEdit = '1';
    (async () => {
      let success = false;
      try {
        const menu = await showOptionMenu(trigger);
        if (!menu) return;
        const started = Date.now();
        let item = findEditMenuItem(menu);
        while (!item && Date.now() - started < 1500) {
          await sleep(40);
          item = findEditMenuItem(menu);
        }
        if (!item) return;
        // Crack runs 수정 from the Radix item's onClick. A plain DOM click
        // reaches it in the page and in an isolated world alike.
        item.click();
        success = true;
      } catch (_) {
        // A rerender may remove the native trigger or menu during this gesture.
      } finally {
        if (!success) closeOptionMenu(trigger);
        setTimeout(() => {
          delete document.body.dataset.ccbDoubleclickEdit;
          editBusy = false;
        }, 200);
      }
    })();
  }, true);
})();
  }
})();
