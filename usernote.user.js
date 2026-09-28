// ==UserScript==
// @name         Crack Usernote Preset (크랙 유저노트 프리셋) 🗂️
// @namespace    crack-usernote-preset-maker
// @version      1.2.0
// @description  크랙 유저노트 창에 프리셋·방별 임시저장·AI 정리/압축/검토를 한곳에 붙임 (PC=왼쪽 탭 패널, 모바일=노트 아래 인라인)
// @author       뤼붕이 (프리셋) · mynameislovesong (AI 압축기)
// @match        https://crack.wrtn.ai/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @connect      firebasevertexai.googleapis.com
// ==/UserScript==

// 1.2.0: 「크랙 유저노트 프리셋 1.1.4」와 「Crack 유저노트 AI 정리·압축기 0.9.1」 합본.
// - 프리셋·임시저장 데이터는 1.1.4와 같은 저장 키를 그대로 쓴다(이 항목에 덮어 설치하면 그대로 남음).
// - AI 설정은 압축기와 같은 모양(crackUserNoteAISettingsV1)으로 저장한다. 압축기는 다른 항목이라 API 키는 한 번 다시 넣어야 한다.
// - 압축기는 크랙 유저노트 창 안에만 붙는다(예전처럼 '유저노트' 글자가 보이는 아무 패널에나 붙지 않음).

(function () {
  'use strict';

  /* =========================================================
   * 0. 상수
   * ======================================================= */
  const PROCESSED = 'data-cunpm-processed';
  const PANEL_W = 320;            // PC 패널 폭(px)
  const GAP = 14;                 // 패널-모달 간격(px)
  const PANEL_EXPAND_MS = 240;
  const PANEL_CLOSE_MS = 150;
  const MOBILE_TOP_SAFE = 12;     // 모바일 패널 상단 최소 여백(px)
  const MOBILE_PANEL_MAX_PX = 360;
  const MOBILE_PANEL_MIN_PX = 140;

  const KEY_PRESETS = 'cunpm:presets';
  const KEY_APPLIED = 'cunpm:applied:'; // + roomId
  const KEY_DRAFTS = 'cunpm:drafts:';   // + roomId
  const KEY_UI = 'cunpm:ui';            // 마지막 탭
  const KEY_AI = 'crackUserNoteAISettingsV1';

  // 자동저장은 input 이벤트가 들어왔을 때만 예약한다. 별도 주기 감시/DOM 스캔 없음.
  const AUTO_DRAFT_MAX = 3;
  const BACKUP_DRAFT_MAX = 3;          // AI 결과를 넣기 전 노트(적용 전) 보관 개수
  const AUTO_SAVE_DEBOUNCE_MS = 2000;
  const AUTO_SNAPSHOT_MS = 3 * 60 * 1000;
  const AUTO_SNAPSHOT_CHAR_DELTA = 200;

  /* =========================================================
   * 1. 저장소 (GM 우선, localStorage 폴백)
   * ======================================================= */
  function gmGet(key, def) {
    try {
      if (typeof GM_getValue === 'function') {
        const v = GM_getValue(key, undefined);
        if (v !== undefined) return v;
      }
    } catch (e) {}
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw);
    } catch (e) {}
    return def;
  }
  function gmSet(key, val) {
    try {
      if (typeof GM_setValue === 'function') { GM_setValue(key, val); return; }
    } catch (e) {}
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function gmDelete(key) {
    try {
      if (typeof GM_deleteValue === 'function') { GM_deleteValue(key); return; }
    } catch (e) {}
    try { localStorage.removeItem(key); } catch (e) {}
  }

  /* =========================================================
   * 2. 상태
   * ======================================================= */
  let presets = gmGet(KEY_PRESETS, []);
  if (!Array.isArray(presets)) presets = [];
  const ui = { panelOpen: false, tab: 'presets' };
  {
    const saved = gmGet(KEY_UI, null);
    if (saved && ['presets', 'drafts', 'ai'].includes(saved.tab)) ui.tab = saved.tab;
  }
  const activePresetIds = new Set();
  let searchQuery = '';
  let editingId = null;

  // 현재 열린 유저노트 모달과 우리 UI 참조
  let activeDialog = null;
  let mobileMode = false;
  let panelEl = null;
  let chipEl = null;
  let footerBtnEl = null;
  let inlineEl = null;
  let badgeEl = null;
  let overlayEl = null;
  let overlayClose = null;

  let activeDraftId = null;
  let autoSaveTimer = null;
  let suppressAutoSaveUntil = 0;       // setReactValue로 생긴 내부 input은 자동저장하지 않음

  // AI 상태(창을 열 때마다 새로)
  const ai = { source: 'note', custom: '', result: '', resultSource: 0, review: '', busy: '', status: '', statusType: '' };

  function resetVolatileState() {
    activePresetIds.clear();
    ui.panelOpen = false;
    searchQuery = '';
    editingId = null;
    activeDraftId = null;
    suppressAutoSaveUntil = 0;
    clearAutoSaveTimer();
    Object.assign(ai, { source: 'note', custom: '', result: '', resultSource: 0, review: '', busy: '', status: '', statusType: '' });
  }

  /* =========================================================
   * 3. 유틸
   * ======================================================= */
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function uid() {
    return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  }
  function getRoomId() {
    const p = location.pathname;
    const m =
      p.match(/\/c(?:hat)?\/([A-Za-z0-9_-]{6,})/) ||
      p.match(/([0-9a-fA-F]{8}-[0-9a-fA-F-]{4,})/) ||
      p.match(/\/([A-Za-z0-9_-]{12,})(?:[/?#]|$)/);
    return m ? m[1] : '__default__';
  }
  function titleLine(name) {
    const t = (name || '').replace(/\s+$/, '');
    return t.startsWith('#') ? t : '# ' + t;
  }
  function presetText(p) {
    return titleLine(p && p.name) + '\n' + ((p && p.content) || '');
  }
  function presetDisplayCount(p) {
    return presetText(p).length;
  }
  function num(n) { return Number(n || 0).toLocaleString(); }
  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  /* =========================================================
   * 4. 프리셋 CRUD
   * ======================================================= */
  function savePresets() { gmSet(KEY_PRESETS, presets); }
  function isPresetActive(id) { return activePresetIds.has(id); }
  function setPresetActive(id, active) {
    if (!id) return;
    if (active) activePresetIds.add(id);
    else activePresetIds.delete(id);
  }
  // 선택 프리셋 → order 순 → "# 제목\n내용" 블록. (선두 구분 빈 줄 없음)
  function buildBlock() {
    const selected = presets
      .filter((p) => isPresetActive(p.id))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!selected.length) return '';
    return selected.map((p) => presetText(p)).join('\n\n');
  }
  function addPreset({ name, content }) {
    const maxOrder = presets.reduce((m, p) => Math.max(m, p.order || 0), 0);
    const now = Date.now();
    const id = uid();
    presets.push({ id, name: name || '', content: content || '', order: maxOrder + 10, createdAt: now, updatedAt: now });
    savePresets();
    return id;
  }
  function updatePreset(id, patch) {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    Object.assign(p, { name: patch.name, content: patch.content, updatedAt: Date.now() });
    savePresets();
  }
  function deletePreset(id) {
    presets = presets.filter((x) => x.id !== id);
    savePresets();
  }
  function reorderByIds(ids) {
    ids.forEach((id, i) => {
      const p = presets.find((x) => x.id === id);
      if (p) p.order = (i + 1) * 10;
    });
    presets.sort((a, b) => (a.order || 0) - (b.order || 0));
    savePresets();
  }

  /* =========================================================
   * 5. React 제어 textarea 안전 주입 (유저노트 textarea 전용)
   * ======================================================= */
  function setReactValue(el, value) {
    if (!el) return;
    if (el.getAttribute('maxlength') !== '99999') {
      el.removeAttribute('maxlength');
      el.setAttribute('maxlength', '99999');
    }
    if (el._valueTracker) el._valueTracker.setValue('');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* =========================================================
   * 6. 모달 / 요소 탐색
   * ======================================================= */
  function isOurs(el) { return !!(el && el.closest && el.closest('[data-cunpm-ui]')); }
  function findDialog() {
    const list = document.querySelectorAll('[role="dialog"]');
    for (const d of list) {
      if (d.getAttribute('data-state') === 'closed') continue;
      if (isOurs(d)) continue;
      const ta = getTextarea(d);
      if (ta && /유저노트/.test(d.textContent)) return d;
    }
    return null;
  }
  function getTextarea(dialog) {
    if (!dialog) return null;
    for (const ta of dialog.querySelectorAll('textarea')) if (!isOurs(ta)) return ta;
    return null;
  }
  // 바텀시트(모바일) 판별: 화면 폭 가득 + 하단에 붙어있음
  function isBottomSheet(dialog) {
    if (!dialog) return false;
    const r = dialog.getBoundingClientRect();
    const fullWidth = r.width >= window.innerWidth - 6;
    const bottomAnchored = (window.innerHeight - r.bottom) <= 6;
    return fullWidth && bottomAnchored;
  }
  function findUsernoteTitleElement(dialog) {
    if (!dialog) return null;
    const nodes = Array.from(dialog.querySelectorAll('h1,h2,h3,div,span,p'));
    for (const el of nodes) {
      if (isOurs(el)) continue;
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent || '')
        .join('').trim();
      if (ownText === '유저노트') return el;
    }
    return null;
  }
  // 창 아래 [등록]/[수정] 버튼
  function findSubmitButton(dialog) {
    for (const b of dialog.querySelectorAll('button')) {
      if (isOurs(b)) continue;
      if (/^(등록|수정)$/.test((b.textContent || '').trim())) return b;
    }
    return null;
  }
  function findNativeCounter(dialog) {
    for (const sp of dialog.querySelectorAll('span')) {
      if (isOurs(sp)) continue;
      if (/^\s*[\d,]+\s*\/\s*[\d,]+\s*$/.test(sp.textContent || '')) return sp;
    }
    return null;
  }
  function getSolidBg(el) {
    let n = el;
    while (n && n.nodeType === 1) {
      const m = (window.getComputedStyle(n).backgroundColor || '').match(/rgba?\(([^)]+)\)/i);
      if (m) {
        const p = m[1].split(',').map((v) => parseFloat(v.trim()));
        const a = p.length >= 4 && Number.isFinite(p[3]) ? p[3] : 1;
        if (a >= 0.5 && p.length >= 3) return `rgb(${p[0]},${p[1]},${p[2]})`;
      }
      n = n.parentElement;
    }
    return null;
  }
  function ensureDialogPositioning(dialog) {
    if (!dialog) return;
    const pos = window.getComputedStyle(dialog).position;
    if (!pos || pos === 'static') dialog.style.position = 'relative';
  }

  /* =========================================================
   * 7. 적용 알고리즘 (마커리스 / 끝-suffix 전용, 선두 공백 없음)
   * ======================================================= */
  // 우리 블록이 노트 "끝"에 깔끔히 붙어있을 때만 base를 복원한다.
  // 끝에 없으면(=사용자가 블록 뒤를 직접 편집) ok:false → 호출부에서 손대지 않음.
  function stripApplied(cur, applied) {
    if (!applied) return { base: cur, ok: true };
    if (cur.endsWith(applied)) return { base: cur.slice(0, cur.length - applied.length), ok: true };
    return { base: cur, ok: false };
  }

  const applyToTextarea = debounce(function () {
    const dialog = activeDialog;
    const ta = getTextarea(dialog);
    if (!ta) return;

    const room = getRoomId();
    const applied = gmGet(KEY_APPLIED + room, '') || '';
    const cur = ta.value;

    const r = stripApplied(cur, applied);
    // 블록이 더 이상 노트 끝에 없음 = 사용자가 블록 뒤를 직접 편집함. 텍스트 손실 방지를 위해 자동 재작성을 멈춘다.
    if (applied && !r.ok) {
      refreshCounts();
      return;
    }
    const base = r.base;

    // 본문이 있고 줄바꿈으로 끝나지 않을 때만 줄바꿈 1개로 구분 (빈 줄 X)
    const block = buildBlock();
    let next = '';
    if (block) {
      const sep = (!base || base.endsWith('\n')) ? '' : '\n';
      next = sep + block;
    }
    const newValue = base + next;

    if (newValue !== cur) {
      suppressAutoSaveUntil = Date.now() + 350;
      setReactValue(ta, newValue);
    }
    gmSet(KEY_APPLIED + room, next);
    refreshCounts();
  }, 120);

  // 현재 노트에서 프리셋 블록을 뺀 순수 본문(base)만 추출한다.
  function getCurrentBase() {
    const ta = getTextarea(activeDialog);
    if (!ta) return '';
    const applied = gmGet(KEY_APPLIED + getRoomId(), '') || '';
    const r = stripApplied(ta.value, applied);
    return r.ok ? r.base : ta.value;
  }
  function appliedLength() {
    const ta = getTextarea(activeDialog);
    if (!ta) return 0;
    const applied = gmGet(KEY_APPLIED + getRoomId(), '') || '';
    return applied && ta.value.endsWith(applied) ? applied.length : 0;
  }
  // 본문(base)만 바꾸고, 켜 둔 프리셋은 다시 끝에 붙인다.
  function setNoteBase(base) {
    const ta = getTextarea(activeDialog);
    if (!ta) return false;
    suppressAutoSaveUntil = Date.now() + 350;
    gmSet(KEY_APPLIED + getRoomId(), '');
    setReactValue(ta, base);
    applyToTextarea();
    return true;
  }

  /* =========================================================
   * 8. 유저노트 임시저장 (방별 자동저장 3개 + 수동 저장본 + AI 적용 전)
   * ======================================================= */
  function getDrafts(room) {
    const v = gmGet(KEY_DRAFTS + room, []);
    return Array.isArray(v) ? v.filter((d) => d && d.id) : [];
  }
  function saveDrafts(room, arr) { gmSet(KEY_DRAFTS + room, Array.isArray(arr) ? arr : []); }
  function draftType(d) { return d && (d.type === 'manual' || d.type === 'backup') ? d.type : 'auto'; }
  function isAutoDraft(d) { return draftType(d) === 'auto'; }
  function newDraftId(prefix) { return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6); }
  function clearAutoSaveTimer() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  function fmtTime(ts) {
    const d = new Date(ts || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function compactDrafts(arr) {
    const newest = (type, max) => new Set(arr
      .filter((d) => draftType(d) === type)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, max).map((d) => d.id));
    const keepAuto = newest('auto', AUTO_DRAFT_MAX);
    const keepBackup = newest('backup', BACKUP_DRAFT_MAX);
    return arr.filter((d) => draftType(d) === 'manual' || keepAuto.has(d.id) || keepBackup.has(d.id));
  }
  function shouldRotateAutoDraft(latest, content, now) {
    if (!latest) return true;
    const old = latest.content || '';
    if (!old) return false;
    if ((now - (latest.createdAt || latest.updatedAt || 0)) < AUTO_SNAPSHOT_MS) return false;
    if (Math.abs(content.length - old.length) >= AUTO_SNAPSHOT_CHAR_DELTA) return true;
    // 글자수 변화가 작아도 오래 지난 글은 가끔 이전본을 남긴다. edit distance 계산은 일부러 안 함.
    return old !== content && content.length >= 300 && (now - (latest.createdAt || 0)) >= AUTO_SNAPSHOT_MS * 2;
  }
  function saveAutoDraftNow() {
    if (!getTextarea(activeDialog)) return;
    const room = getRoomId();
    const content = getCurrentBase();
    if (!content.trim()) return; // 빈 노트로 최신 저장본을 덮어쓰지 않음

    const arr = getDrafts(room);
    const now = Date.now();
    const autos = arr.filter(isAutoDraft).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const latest = autos[0] || null;

    if (latest && (latest.content || '') === content) {
      activeDraftId = latest.id;
      renderDrafts();
      return;
    }
    if (!latest || shouldRotateAutoDraft(latest, content, now)) {
      const d = { id: newDraftId('a'), type: 'auto', content, createdAt: now, updatedAt: now };
      arr.unshift(d);
      activeDraftId = d.id;
    } else {
      latest.content = content;
      latest.updatedAt = now;
      activeDraftId = latest.id;
    }
    saveDrafts(room, compactDrafts(arr));
    renderDrafts();
  }
  function scheduleAutoSaveDraft() {
    clearAutoSaveTimer();
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      saveAutoDraftNow();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }
  function flushAutoSaveDraft() {
    if (!autoSaveTimer) return;
    clearAutoSaveTimer();
    saveAutoDraftNow();
  }
  // AI 결과로 노트를 바꾸기 전 본문을 따로 남긴다(자동 저장본처럼 덮어쓰이지 않게 종류를 나눔).
  function saveBackupDraft(content) {
    if (!String(content || '').trim()) return;
    const room = getRoomId();
    const arr = getDrafts(room);
    if (arr.some((d) => draftType(d) === 'backup' && d.content === content)) return;
    const now = Date.now();
    arr.unshift({ id: newDraftId('b'), type: 'backup', content, createdAt: now, updatedAt: now });
    saveDrafts(room, compactDrafts(arr));
    renderDrafts();
  }
  async function createManualDraft() {
    flushAutoSaveDraft();
    const room = getRoomId();
    const content = getCurrentBase();
    if (!content.trim()) {
      await askInDialog({ message: '저장할 본문이 없어요.', notice: true });
      return;
    }
    const arr = getDrafts(room);
    const now = Date.now();
    const d = { id: newDraftId('m'), type: 'manual', content, createdAt: now, updatedAt: now };
    arr.unshift(d);
    saveDrafts(room, compactDrafts(arr));
    activeDraftId = d.id;
    renderDrafts();
  }
  async function loadDraft(id) {
    flushAutoSaveDraft();
    const room = getRoomId();
    const d = getDrafts(room).find((x) => x.id === id);
    if (!d || !getTextarea(activeDialog)) return;
    const curBase = getCurrentBase();
    if (curBase.trim() && curBase !== d.content) {
      const ok = await askInDialog({ title: '임시저장 불러오기', message: '지금 노트 본문을 이 임시저장으로 바꿀까요?\n켜 둔 프리셋은 그대로 붙어 있어요.', okText: '불러오기' });
      if (!ok) return;
    }
    // base만 d.content로 교체. 적용 프리셋은 applyToTextarea가 다시 끝에 붙인다.
    setNoteBase(d.content || '');
    activeDraftId = id;
    renderDrafts();
  }
  async function deleteDraft(id) {
    const ok = await askInDialog({ message: '이 임시저장을 삭제할까요?', okText: '삭제', danger: true });
    if (!ok) return;
    flushAutoSaveDraft();
    const room = getRoomId();
    saveDrafts(room, compactDrafts(getDrafts(room).filter((x) => x.id !== id)));
    if (activeDraftId === id) activeDraftId = null;
    renderDrafts();
  }
  function handleUsernoteInput() {
    refreshCountsDebounced();
    if (ai.source === 'note') refreshAiSourceInfo();
    if (Date.now() < suppressAutoSaveUntil) return;
    // 입력 이벤트가 있을 때만 예약. 실제 저장/렌더는 2초 뒤 1회만.
    scheduleAutoSaveDraft();
  }

  /* =========================================================
   * 9. AI 정리·압축·검토 (압축기 0.9.1의 지침과 호출 방식 그대로)
   * ======================================================= */
  const GEMINI_MODELS = [
    { id: 'gemini-3.7-flash', label: '3.7 Flash' },
    { id: 'gemini-3.6-flash', label: '3.6 Flash' },
    { id: 'gemini-3.5-flash', label: '3.5 Flash' },
    { id: 'gemini-3.1-pro-preview', label: '3.1 Pro' },
    { id: 'gemini-2.5-pro', label: '2.5 Pro' },
  ];
  const GEMINI_MODEL_IDS = new Set(GEMINI_MODELS.map((m) => m.id));
  const DEFAULT_WRITING_MODEL = 'gemini-3.7-flash';
  const DEFAULT_REVIEW_MODEL = 'gemini-3.1-pro-preview';
  const LEVELS = [
    { id: 'low', label: '하', desc: '표현만 다듬고 뉘앙스·세부는 그대로' },
    { id: 'medium', label: '중', desc: '뜻과 제한은 지키고 중복을 걷어 목록형으로' },
    { id: 'high', label: '상', desc: '글자 수 우선, 약어·한자·기호까지 적극 사용' },
    { id: 'maximum', label: '최상', desc: '압축 4대 원칙으로 가장 짧게' },
  ];
  const levelOf = (id) => LEVELS.find((l) => l.id === id) || LEVELS[0];

  const COMMON_COMPRESSION_PROMPT = `[프롬프트: AI 프롬프트 압축 전문가]
  # 1. AI 역할 및 목표 정의
  * 역할: 너는 AI 롤플레잉 프롬프트를 극한까지 압축하고 최적화하는 **'프롬프트 압축 전문가(Prompt Compressor)'**다.
  * 목표: 너의 유일한 목표는, 아래의 **'압축 4대 원칙'**에 따라 주어진 프롬프트의 모든 지침을 단 하나도 누락 없이, 더 강력하게, 그리고 공백 포함 글자 수가 가장 적은 형태로 재탄생시키는 것이다.
  # 2. 프롬프트 압축 4대 원칙 (절대 규칙)
  * AI 학습 명확성 (Clarity): 생성된 규칙은 Gemini AI가 오해의 소지 없이 해석하고 RP에 즉시 반영할 수 있도록, 구조화된 키워드, 기호, 연산자 중심으로 구성해야 한다.
  * 글자 수 최소화 (Conciseness): 모든 수단을 동원해 글자 수를 극한까지 줄여야 한다.
  * 허용 기법: 한자(漢字), 라틴어 약어(e.g., OOC), 특수기호(#, [], *), 수학/논리 연산자(→, ≠, ↑, |, ✅, ❌), 불필요한 조사/공백/줄바꿈의 완전한 제거.
  * 의도 표현 정확성 (Accuracy): 원본 프롬프트의 모든 지침과 의도는 100% 보존되거나, 더 함축적이고 강력한 표현으로 강화되어야 한다. 규칙의 의미가 약화되어서는 안 된다.
  * 절대적 효율성 (Efficiency): 인간의 가독성, 문장의 자연스러움, 문법적 완결성 등 위 3가지 원칙과 무관한 모든 요소는 완전히 무시하고 배제해야 한다.
  # 3. 작업 프로세스
  * [입력 프롬프트 분석]: 내가 제공하는 원본 프롬프트의 모든 지침과 핵심 의도를 완벽하게 파악한다.
  * [핵심 키워드 추출]: 각 지침을 대표하는 가장 짧고 강력한 핵심 단어(명사, 동사, 형용사)를 추출한다.
  * [기호화 및 압축]: 추출된 키워드를 **'압축 4대 원칙'**에 따라 기호, 한자, 연산자 등과 조합하여 최종 압축 프롬프트를 생성한다.
  # 4. 실행 예시 (Few-Shot Learning)
  * [입력 프롬프트 (Before)]
  > AI는 절대로 사용자의 행동을 대신 서술해서는 안 됩니다. 사용자의 행동은 사용자가 직접 입력하는 것으로만 결정됩니다. 그리고 AI는 사용자의 생각을 읽을 수 없는 존재입니다.
  >
  * [생성 결과물 (After)]
  > User(행동/생각)=사용자영역. AI 代筆/讀心=絶對禁止.`;

  const CONTROLLED_COMPRESSION_PROMPT = `# 압축 강도
  - 하: 원문 뉘앙스를 최대한 유지하고 표현만 정리
  - 중: 의미 보존 + 중복 제거 + 규칙형 문장화
  - 상: 글자수 절약 우선. 약어, 한자, 기호 적극 사용

  # 허용 한자 치환표
  可=가능
  含=포함
  或=또는
  若=만약
  擬=처럼/모방
  擇=선택
  必=반드시
  禁=금지/불가
  唯=오직
  限=한정
  即=즉시
  已=이미
  且=그리고
  亦=또한
  ∵=때문에
  ∴=따라서
  漸=점점
  尙=여전히/아직
  尤=특히
  常=늘
  對=대해/vs
  詳=상세히
  略=간략히
  〃=위와 동일

  # 논리기호
  - ¬ = 배제/not
  - ∀ = 모든
  - ∄ = 존재하지 않음
  - ∴ = 따라서
  - ∵ = 때문에

  기호는 목록형, 규칙형 프롬프트에서만 적극 사용한다.
  자연어 문장 안에 억지로 섞어 의미가 흐려질 경우 자연어를 우선한다.

  # 한자 치환 효율 원칙
  한글을 한자/기호로 바꿀 때는 실제 글자수 절감이 있을 때만 치환한다.

  기준:
  - 원문보다 치환문이 짧으면 사용 가능
  - 글자수가 같으면 한글 유지
  - 글자수가 늘어나면 치환 금지
  - 고유명사, 지명, 캐릭터명, 설정명은 글자수 절감이 없으면 원문 유지
  - 한글+한자가 어색하게 섞여 가독성을 해치면, 글자수 절감이 있어도 자연어를 우선할 수 있음

  예시:
  - 위치→位: 2자→1자이므로 가능
  - 해망→海望: 2자→2자이므로 금지, 해망 유지
  - 2층 목조→2層木조: 글자수 절감 없음/가독성 저하이므로 금지
  - 반드시→必: 3자→1자이므로 가능
  - 금지→禁: 2자→1자이므로 가능`;

  const REVIEW_PROMPT = `[프롬프트 구조 분석 AI]
  # 1. AI 역할 및 목표
  * 역할: 너는 고도로 압축되고 복잡한 AI 프롬프트의 숨겨진 지시사항을 분석하고, 그 구조와 작동 방식을 해독하는 **'프롬프트 디컨스트럭터(Prompt Deconstructor)'**다.
  * 목표: 너의 임무는 내가 입력하는 프롬프트의 모든 지침을 정확히 파악하고, 아래에 명시된 세 가지 분석 양식에 따라 체계적인 분석 보고서를 출력하는 것이다.
  # 2. 분석 프레임워크 및 원칙
  너는 다음 세 가지 원칙에 따라 프롬프트를 분석하고 결과를 도출해야 한다.
  * 1단계: 지시사항 번역 (Korean Translation)
  * 원칙: 모든 압축된 키워드, 기호, 한자, 연산자를 누락 없이 명확하고 자연스러운 한국어 문장으로 번역한다.
  * 실행: 각 지시사항을 번호로 구분하여 순서대로 나열한다.
  * 2단계: 우선순위 분석 (Priority Analysis)
  * 원칙: 프롬프트 내에서 규칙들의 위계(Hierarchy)를 분석한다.
  * 실행: 지침들을 **'최상위 규칙(Meta-Rules)', '핵심 규칙(Core Rules)', '보조 규칙(Sub-Rules)'**으로 등급을 나누고, 왜 그렇게 판단했는지 근거를 제시한다.
  * 판단 기준: 명시적 키워드(e.g., '최상위', 'TopPriority', '절대', '반드시'), 프롬프트 내 배치 순서(보통 앞에 있을수록 중요), 지침의 포괄성(다른 규칙에 영향을 미치는지 여부).
  * 3단계: 반영 방식 예측 (Reflection Prediction)
  * 원칙 (갈등 분석): 먼저, 프롬프트 내 지침들 간에 잠재적인 충돌이나 모순이 있는지 분석한다. (예: '자유로운 서술' vs '엄격한 금지 조항', '제한 해제' vs '특정 행동 금지').
  * 원칙 (적용 시뮬레이션): 충돌이 발생할 경우, Gemini AI가 '우선순위 분석' 결과에 따라 어떤 지침을 더 중요하게 따를 것인지, 또는 두 지침을 어떻게 절충하여 적용할 것인지 구체적인 예시를 들어 예측하고 서술한다. 충돌이 없다면, 각 지침이 어떻게 상호작용하여 시너지를 내는지 설명한다.
  # 3. 출력 양식 (Output Format)
  너는 반드시 아래의 양식을 엄격히 준수하여 분석 결과를 출력해야 한다.
  1. 프롬프트 지시사항 한글화
  (분석 결과를 여기에 번호로 나열)
  2. 프롬프트 지시사항의 우선순위
  (최상위/핵심/보조 규칙으로 나누어 분석 결과를 여기에 서술)
  3. 제미나이의 프롬프트 지시사항 반영 예상
  (충돌 분석 및 적용 시뮬레이션 결과를 여기에 서술)`;

  function normalizeReasoning(value) {
    return ['low', 'medium', 'high'].includes(value) ? value : 'medium';
  }
  function normalizeModelSelection(value, fallback) {
    return GEMINI_MODEL_IDS.has(value) ? value : fallback;
  }
  function sanitizeSettings(raw = {}) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const provider = raw.provider === 'firebase' ? 'firebase' : 'gemini';
    return {
      provider,
      compressionLevel: ['low', 'medium', 'high', 'maximum'].includes(raw.compressionLevel)
        ? raw.compressionLevel
        : raw.compressionEnabled === true ? 'maximum' : 'low',
      additionalCompressionPrompt: raw.additionalCompressionPrompt || raw.compressionPrompt || '',
      geminiApiKey: raw.geminiApiKey || '',
      geminiModel: normalizeModelSelection(raw.geminiModel, DEFAULT_WRITING_MODEL),
      geminiReviewModel: normalizeModelSelection(raw.geminiReviewModel, DEFAULT_REVIEW_MODEL),
      geminiReasoningLevel: normalizeReasoning(raw.geminiReasoningLevel),
      geminiReviewReasoningLevel: normalizeReasoning(raw.geminiReviewReasoningLevel),
      firebaseConfig: raw.firebaseConfig || '',
      firebaseBackend: raw.firebaseBackend === 'googleAI' ? 'googleAI' : 'vertexAI',
      firebaseLocation: raw.firebaseLocation || 'global',
      firebaseModel: normalizeModelSelection(raw.firebaseModel, DEFAULT_WRITING_MODEL),
      firebaseReviewModel: normalizeModelSelection(raw.firebaseReviewModel, DEFAULT_REVIEW_MODEL),
      firebaseReasoningLevel: normalizeReasoning(raw.firebaseReasoningLevel),
      firebaseReviewReasoningLevel: normalizeReasoning(raw.firebaseReviewReasoningLevel),
    };
  }
  function loadAiSettings() { return sanitizeSettings(gmGet(KEY_AI, {})); }
  function saveAiSettings(next) {
    const s = sanitizeSettings(next);
    gmSet(KEY_AI, s);
    return s;
  }
  function aiReady(s) {
    return s.provider === 'gemini' ? !!s.geminiApiKey.trim() : !!String(s.firebaseConfig || '').trim();
  }
  function providerConfig(provider, settings, purpose = 'generate') {
    if (provider === 'gemini') {
      return {
        apiKey: settings.geminiApiKey,
        model: purpose === 'review' ? settings.geminiReviewModel : settings.geminiModel,
        reasoningLevel: purpose === 'review' ? settings.geminiReviewReasoningLevel : settings.geminiReasoningLevel,
      };
    }
    return {
      firebaseConfig: settings.firebaseConfig,
      backend: settings.firebaseBackend,
      location: settings.firebaseLocation,
      model: purpose === 'review' ? settings.firebaseReviewModel || settings.firebaseModel : settings.firebaseModel,
      reasoningLevel: purpose === 'review' ? settings.firebaseReviewReasoningLevel : settings.firebaseReasoningLevel,
    };
  }
  function modelLabel(s) {
    const id = s.provider === 'gemini' ? s.geminiModel : s.firebaseModel;
    const label = (GEMINI_MODELS.find((m) => m.id === id) || {}).label || id;
    return s.provider === 'gemini' ? `Gemini ${label}` : `Firebase · ${label}`;
  }
  function buildPrompt(source, additionalPrompt, compressionLevel) {
    const extra = additionalPrompt.trim() ? `\n\n[사용자 추가 지침]\n${additionalPrompt.trim()}` : '';
    if (compressionLevel === 'maximum') {
      return `${COMMON_COMPRESSION_PROMPT}${extra}\n\n[현재 작업]\n아래 원본 프롬프트를 위 절대 규칙대로 압축하라. 분석/설명/서문 없이 최종 압축 프롬프트만 출력.\n\n[원본 프롬프트]\n${source}`;
    }
    if (['low', 'medium', 'high'].includes(compressionLevel)) {
      const selectedRule = {
        low: '[선택 강도: 하]\n원문 뉘앙스·의도·세부정보를 최대한 유지하고 표현만 정리하라. 중복도 의미 차이가 있으면 보존하라.',
        medium: '[선택 강도: 중]\n모든 의미와 제한을 보존하면서 중복을 제거하고 목록형·규칙형 문장으로 압축하라.',
        high: '[선택 강도: 상]\n글자수 절약을 우선하라. 의미·제한을 보존하면서 중복을 적극 제거하고 약어·한자·기호를 효율 원칙 범위에서 적극 사용하라.',
      }[compressionLevel];
      return `${CONTROLLED_COMPRESSION_PROMPT}\n\n${selectedRule}${extra}\n\n[현재 작업]\n분석/설명/서문 없이 최종 결과만 출력.\n\n[원본 프롬프트]\n${source}`;
    }
    return buildPrompt(source, additionalPrompt, 'low');
  }
  function cleanupOutput(text) {
    return String(text || '').replace(/^```(?:markdown|md|text)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  function gmFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: String(url),
        headers: options.headers || {},
        data: options.body,
        timeout: 120000,
        onload(response) {
          resolve({ ok: response.status >= 200 && response.status < 300, status: response.status, text: async () => response.responseText || '' });
        },
        ontimeout() { reject(new TypeError('AI 요청 시간 초과')); },
        onerror() { reject(new TypeError('AI 네트워크 요청 실패')); },
      });
    });
  }
  async function readJson(response) {
    const raw = await response.text();
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return { raw }; }
  }
  function apiError(name, status, data) {
    const message = data?.error?.message || data?.message || data?.raw || `HTTP ${status}`;
    if (status === 401 || status === 403) return new Error(`${name} 인증 실패: ${message}`);
    if (status === 429) return new Error(`${name} 사용량/요청 한도 초과: ${message}`);
    return new Error(`${name} API 오류 (${status}): ${message}`);
  }
  function normalizeModelName(name) { return String(name || '').trim().replace(/^models\//, ''); }
  function buildGenerationConfig(model, reasoningLevel, firebase) {
    const level = ['low', 'medium', 'high'].includes(reasoningLevel) ? reasoningLevel : 'medium';
    const isGemini3 = /^gemini-3(?:\.|-)/i.test(model);
    const generationConfig = isGemini3 ? {} : { temperature: 0.2 };
    if (/^gemini-2\.5-/i.test(model)) {
      generationConfig.thinkingConfig = { thinkingBudget: { low: 1024, medium: 8192, high: 24576 }[level] };
    } else if (isGemini3) {
      generationConfig.thinkingConfig = { thinkingLevel: firebase ? level.toUpperCase() : level };
    }
    return generationConfig;
  }
  function parseFirebaseConfig(input) {
    if (input && typeof input === 'object') return input;
    let raw = String(input || '').trim();
    if (!raw) throw new Error('Firebase CDN 설정(firebaseConfig)이 비어 있음');
    raw = raw.replace(/^\s*(?:const|let|var)\s+firebaseConfig\s*=\s*/i, '').replace(/;\s*$/, '').trim();
    try {
      return JSON.parse(raw);
    } catch {
      const config = {};
      for (const key of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId']) {
        const match = raw.match(new RegExp(`["']?${key}["']?\\s*:\\s*(["'])(.*?)\\1`, 's'));
        if (match) config[key] = match[2];
      }
      return config;
    }
  }
  async function callGemini(prompt, config) {
    const apiKey = (config.apiKey || '').trim();
    const model = normalizeModelName(config.model || DEFAULT_WRITING_MODEL);
    if (!apiKey) throw new Error('Gemini API 키가 없음');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await gmFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: buildGenerationConfig(model, config.reasoningLevel, false) }),
    });
    const data = await readJson(response);
    if (!response.ok) throw apiError('Gemini', response.status, data);
    const text = data?.candidates?.[0]?.content?.parts?.filter((part) => !part?.thought).map((part) => part?.text || '').join('').trim();
    if (!text) throw new Error('Gemini 응답에서 텍스트를 찾지 못함');
    return text;
  }
  async function callFirebaseAILogic(prompt, config) {
    const firebaseConfig = parseFirebaseConfig(config.firebaseConfig);
    const apiKey = String(firebaseConfig.apiKey || '').trim();
    const projectId = String(firebaseConfig.projectId || '').trim();
    const appId = String(firebaseConfig.appId || '').trim();
    const model = normalizeModelName(config.model || DEFAULT_WRITING_MODEL);
    const backend = config.backend === 'vertexAI' ? 'vertexAI' : 'googleAI';
    const location = String(config.location || 'global').trim() || 'global';
    if (!apiKey || !projectId) throw new Error('Firebase 설정에서 apiKey와 projectId를 찾지 못함');
    const modelPath = backend === 'vertexAI'
      ? `projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}`
      : `projects/${encodeURIComponent(projectId)}/models/${encodeURIComponent(model)}`;
    const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, 'x-goog-api-client': 'gl-js/fire-cuai' };
    if (appId) headers['X-Firebase-Appid'] = appId;
    const response = await gmFetch(`https://firebasevertexai.googleapis.com/v1beta/${modelPath}:generateContent`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: buildGenerationConfig(model, config.reasoningLevel, true) }),
    });
    const data = await readJson(response);
    if (!response.ok) throw apiError('Firebase AI Logic', response.status, data);
    const text = data?.candidates?.[0]?.content?.parts?.filter((part) => !part?.thought).map((part) => part?.text || '').join('').trim();
    if (!text) throw new Error('Firebase AI Logic 응답에서 텍스트를 찾지 못함');
    return text;
  }
  async function callAI(provider, prompt, config) {
    try {
      if (!prompt?.trim()) throw new Error('AI에 보낼 내용이 비어 있음');
      if (provider === 'gemini') return await callGemini(prompt, config || {});
      if (provider === 'firebase') return await callFirebaseAILogic(prompt, config || {});
      throw new Error('지원하지 않는 API 종류임');
    } catch (error) {
      if (error instanceof TypeError && /fetch/i.test(error.message)) throw new Error('네트워크 요청에 실패함. API 주소/인터넷 연결/확장 권한을 확인해주세요.');
      throw error;
    }
  }

  function aiSourceText() {
    return ai.source === 'custom' ? ai.custom : getCurrentBase();
  }
  function setAiStatus(text, type = '') {
    ai.status = text || '';
    ai.statusType = type;
    for (const el of document.querySelectorAll('[data-cunpm-ai-status]')) {
      el.textContent = ai.status;
      el.dataset.type = type;
      el.hidden = !ai.status;
    }
  }
  async function runCompress() {
    if (ai.busy) return;
    const source = aiSourceText().trim();
    if (!source) {
      setAiStatus(ai.source === 'custom' ? '압축할 내용을 먼저 붙여넣어 주세요.' : '노트가 비어 있어요.', 'error');
      return;
    }
    const settings = loadAiSettings();
    if (!aiReady(settings)) {
      setAiStatus('AI 설정에서 API 키를 먼저 넣어 주세요.', 'error');
      openSettings();
      return;
    }
    ai.busy = 'compress';
    renderAi();
    setAiStatus(`AI가 ${levelOf(settings.compressionLevel).label} 단계로 압축하는 중…`, 'loading');
    try {
      const text = await callAI(settings.provider, buildPrompt(source, settings.additionalCompressionPrompt, settings.compressionLevel), providerConfig(settings.provider, settings));
      ai.result = cleanupOutput(text);
      ai.resultSource = source.length;
      ai.resultLevel = settings.compressionLevel;
      setAiStatus('완료. 결과를 확인한 뒤 노트에 적용하세요.', 'success');
    } catch (error) {
      setAiStatus(error?.message || String(error), 'error');
    } finally {
      ai.busy = '';
      renderAi();
    }
  }
  async function runReview() {
    if (ai.busy) return;
    const target = ai.result.trim();
    if (!target) { setAiStatus('먼저 압축 결과를 만들어 주세요.', 'error'); return; }
    const settings = loadAiSettings();
    if (!aiReady(settings)) { setAiStatus('AI 설정에서 API 키를 먼저 넣어 주세요.', 'error'); openSettings(); return; }
    ai.busy = 'review';
    renderAi();
    setAiStatus('검토 모델이 프롬프트 구조를 분석하는 중…', 'loading');
    try {
      const text = await callAI(settings.provider, `${REVIEW_PROMPT}\n\n[분석할 프롬프트]\n${target}`, providerConfig(settings.provider, settings, 'review'));
      ai.review = cleanupOutput(text);
      setAiStatus('검토 완료.', 'success');
      openReview();
    } catch (error) {
      setAiStatus(error?.message || String(error), 'error');
    } finally {
      ai.busy = '';
      renderAi();
    }
  }
  function applyAiResult(mode) {
    const text = ai.result.trim();
    if (!text) { setAiStatus('적용할 결과가 없어요.', 'error'); return; }
    if (!getTextarea(activeDialog)) { setAiStatus('열린 유저노트 입력창을 찾지 못했어요.', 'error'); return; }
    flushAutoSaveDraft();
    const base = getCurrentBase();
    saveBackupDraft(base);
    const next = mode === 'append' ? [base.trimEnd(), text].filter(Boolean).join('\n\n') : text;
    setNoteBase(next);
    setAiStatus(`${mode === 'append' ? '노트 아래에 추가했어요' : '노트를 바꿨어요'}. 저장하려면 [수정]을 누르세요. 바꾸기 전 노트는 임시저장(적용 전)에 있어요.`, 'success');
  }
  async function copyText(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      setAiStatus(okMessage, 'success');
    } catch (e) {
      setAiStatus('복사하지 못했어요. 결과 칸을 길게 눌러 직접 복사해 주세요.', 'error');
    }
  }

  /* =========================================================
   * 10. 스타일 (크랙 색 토큰: body[data-theme]가 바꾸는 변수 사용)
   * ======================================================= */
  const ICON = {
    layers: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.5l8.5 4.5 8.5-4.5"/></svg>',
    spark: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M11 3.5l1.9 5.1 5.1 1.9-5.1 1.9L11 17.5l-1.9-5.1L4 10.5l5.1-1.9z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
    swap: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/></svg>',
    append: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 6h16M4 11h11M17 14v7M13.5 17.5h7"/></svg>',
    review: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8.5 11l1.8 1.8 3.2-3.3"/></svg>',
    note: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z"/><path d="M14 3.5V8h4M9 12h6M9 16h4"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    grip: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" class="cunpm-fill"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    ring: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" class="cunpm-rot"><circle cx="12" cy="12" r="8.5" style="stroke-opacity:.3"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"/></svg>',
  };

  function injectStyle() {
    if (document.getElementById('cunpm-style')) return;
    const s = document.createElement('style');
    s.id = 'cunpm-style';
    s.textContent = `
      [data-cunpm-ui] { box-sizing:border-box; }
      [data-cunpm-ui] *, [data-cunpm-ui] *::before, [data-cunpm-ui] *::after { box-sizing:border-box; }
      [data-cunpm-ui] svg { fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; flex-shrink:0; display:block; }
      [data-cunpm-ui] svg.cunpm-fill { fill:currentColor; stroke:none; }
      .cunpm-rot { animation:cunpmRot .9s linear infinite; }
      @keyframes cunpmRot { to { transform:rotate(360deg); } }
      :where([data-cunpm-ui]) :where(button, input, textarea, select) { font-family:inherit; }
      :where([data-cunpm-ui]) button { cursor:pointer; -webkit-tap-highlight-color:transparent; line-height:1.2; }
      :where([data-cunpm-ui]) button:disabled { cursor:default; opacity:.5; }
      [data-cunpm-ui] button:focus-visible, [data-cunpm-ui] input:focus-visible, [data-cunpm-ui] textarea:focus-visible, [data-cunpm-ui] select:focus-visible {
        outline:2px solid var(--text_primary,#F0EFEB); outline-offset:1px;
      }
      .cunpm-ui-font { font-family:Pretendard,"Apple SD Gothic Neo",system-ui,sans-serif; color:var(--text_primary,#F0EFEB); word-break:keep-all; overflow-wrap:anywhere; }

      /* 제목 옆 칩 */
      .cunpm-chip { height:28px; margin-left:10px; padding:0 10px 0 8px; display:inline-flex; align-items:center; gap:5px; border-radius:999px;
        border:1px solid var(--divider_secondary,#42413D); background:transparent; color:var(--text_primary,#F0EFEB); font-size:12px; font-weight:600; line-height:1; white-space:nowrap; }
      .cunpm-chip:hover { background:var(--state_hover,rgba(255,255,255,.08)); }
      .cunpm-chip[aria-expanded="true"] { border-color:var(--text_tertiary,#85837D); background:var(--surface_tertiary,#2E2D2B); }
      .cunpm-chip-count { color:var(--text_brand,#FF6352); }
      .cunpm-chip-count:empty { display:none; }

      /* 글자수 옆 배지 */
      .cunpm-badge { margin-left:auto; margin-right:6px; font-size:12px; font-weight:600; color:var(--text_brand,#FF6352); white-space:nowrap; }

      /* 창 아래 AI 버튼(PC) */
      .cunpm-footer-ai { margin-right:auto; height:40px; padding:0 14px; display:inline-flex; align-items:center; gap:6px; border-radius:10px;
        border:1px solid var(--divider_secondary,#42413D); background:transparent; color:var(--text_primary,#F0EFEB); font-size:14px; font-weight:600; white-space:nowrap; }
      .cunpm-footer-ai svg { color:var(--text_brand,#FF6352); }
      .cunpm-footer-ai:hover { background:var(--state_hover,rgba(255,255,255,.08)); }
      .cunpm-footer-ai[aria-expanded="true"] { border-color:var(--text_tertiary,#85837D); background:var(--surface_tertiary,#2E2D2B); }

      /* 패널 */
      .cunpm-panel { position:absolute; z-index:60; display:none; flex-direction:column; opacity:0; overflow:hidden; min-height:0; max-height:calc(100vh - 16px);
        background:var(--cunpm-bg,var(--bg_elevated_primary,#242321)); border:1px solid var(--divider_secondary,#42413D); border-radius:16px; box-shadow:0 18px 48px rgba(0,0,0,.34); }
      .cunpm-tabs { flex:0 0 auto; margin:12px 12px 0; display:flex; gap:2px; padding:3px; border-radius:10px; background:var(--surface_tertiary,#2E2D2B); }
      .cunpm-tab { flex:1 1 0; height:32px; display:inline-flex; align-items:center; justify-content:center; gap:5px; border:0; border-radius:8px; background:transparent; color:var(--text_secondary,#A8A69D); font-size:13px; font-weight:600; }
      .cunpm-tab svg { width:14px; height:14px; color:var(--text_brand,#FF6352); }
      .cunpm-tab[aria-selected="true"] { background:var(--surface_primary,#FCFCFA); color:var(--text_ivory,#0D0D0C); }
      .cunpm-tab[hidden] { display:none; }
      .cunpm-tabpanel { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
      .cunpm-tabpanel[hidden] { display:none; }
      .cunpm-head { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:14px 14px 10px; }
      .cunpm-title { font-size:15px; font-weight:700; }
      .cunpm-btn-sm { height:30px; padding:0 10px; display:inline-flex; align-items:center; gap:4px; border-radius:8px; border:1px solid var(--divider_secondary,#42413D);
        background:transparent; color:var(--text_primary,#F0EFEB); font-size:12px; font-weight:600; white-space:nowrap; }
      .cunpm-btn-sm:hover { background:var(--state_hover,rgba(255,255,255,.08)); }
      .cunpm-search { flex:0 0 auto; margin:0 14px 8px; height:36px; display:flex; align-items:center; gap:8px; padding:0 12px; border-radius:8px;
        border:1px solid var(--outline_secondary,#42413D); background:var(--surface_ivory,#141413); color:var(--text_tertiary,#85837D); }
      .cunpm-search input { flex:1; min-width:0; border:0 !important; outline:0 !important; box-shadow:none !important; background:transparent !important; color:var(--text_primary,#F0EFEB) !important; font:inherit; font-size:14px; padding:0 !important; }
      .cunpm-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; padding:0 8px 8px; }
      .cunpm-scroll::-webkit-scrollbar { width:6px; } .cunpm-scroll::-webkit-scrollbar-thumb { background:rgba(128,128,128,.28); border-radius:3px; }
      .cunpm-list { display:flex; flex-direction:column; gap:2px; }
      .cunpm-row { position:relative; min-height:40px; display:flex; align-items:center; gap:2px; padding:0 2px; border-radius:8px; }
      .cunpm-row:hover, .cunpm-row:focus-within { background:var(--state_hover,rgba(255,255,255,.08)); }
      .cunpm-handle { width:20px; flex:0 0 20px; display:inline-flex; justify-content:center; color:var(--text_tertiary,#85837D); opacity:.7; cursor:grab; touch-action:none; user-select:none; }
      .cunpm-list[data-search="1"] .cunpm-handle { opacity:.2; pointer-events:none; }
      .cunpm-row-main { flex:1 1 auto; min-width:0; height:40px; display:flex; align-items:center; gap:10px; padding:0 4px; border:0; background:transparent; text-align:left;
        color:var(--text_secondary,#A8A69D); font-size:14px; font-weight:500; }
      .cunpm-row[data-active="1"] .cunpm-row-main { color:var(--text_primary,#F0EFEB); font-weight:600; }
      .cunpm-check { width:18px; height:18px; flex:0 0 18px; border-radius:50%; border:1.5px solid var(--text_tertiary,#85837D); display:inline-flex; align-items:center; justify-content:center; color:#fff; }
      .cunpm-check svg { opacity:0; stroke-width:2.8; }
      .cunpm-row[data-active="1"] .cunpm-check { background:var(--surface_brand_primary,#FF4432); border-color:var(--surface_brand_primary,#FF4432); }
      .cunpm-row[data-active="1"] .cunpm-check svg { opacity:1; }
      .cunpm-name { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
      .cunpm-count { flex:0 0 auto; padding-right:8px; font-size:12px; color:var(--text_tertiary,#85837D); }
      .cunpm-icon { width:28px; height:28px; flex:0 0 28px; display:none; align-items:center; justify-content:center; border:0; border-radius:7px; background:transparent; color:var(--text_primary,#F0EFEB); padding:0; }
      .cunpm-icon:hover { background:var(--state_hover,rgba(255,255,255,.08)); }
      .cunpm-row:hover .cunpm-icon, .cunpm-row:focus-within .cunpm-icon { display:inline-flex; }
      .cunpm-row:hover .cunpm-count, .cunpm-row:focus-within .cunpm-count { display:none; }
      @media (hover:none) { .cunpm-icon { display:inline-flex; } .cunpm-count { display:none; } }
      .cunpm-row.cunpm-dragging { opacity:.96; box-shadow:0 10px 24px rgba(0,0,0,.28); background:var(--cunpm-bg,#242321) !important; }
      .cunpm-drag-placeholder { min-height:40px; border-radius:8px; border:1px dashed var(--divider_primary,#61605A); flex:0 0 auto; }
      .cunpm-empty { font-size:12px; color:var(--text_tertiary,#85837D); text-align:center; padding:18px 12px; line-height:1.5; }
      .cunpm-note { font-size:11px; color:var(--text_tertiary,#85837D); padding:2px 8px 6px; }
      .cunpm-foot { flex:0 0 auto; height:40px; padding:0 16px; display:flex; align-items:center; justify-content:space-between; gap:8px; border-top:1px solid var(--divider_secondary,#42413D); font-size:12px; color:var(--text_secondary,#A8A69D); }
      .cunpm-foot b { color:var(--text_brand,#FF6352); font-weight:600; }

      /* 임시저장 */
      .cunpm-draft { display:flex; align-items:center; gap:2px; border-radius:8px; }
      .cunpm-draft:hover, .cunpm-draft:focus-within, .cunpm-draft[data-active="1"] { background:var(--state_hover,rgba(255,255,255,.08)); }
      .cunpm-draft-main { flex:1 1 auto; min-width:0; min-height:46px; display:flex; align-items:center; gap:10px; padding:6px 8px; border:0; background:transparent; text-align:left; color:var(--text_primary,#F0EFEB); }
      .cunpm-tag { flex:0 0 auto; height:20px; padding:0 6px; display:inline-flex; align-items:center; border-radius:5px; font-size:11px; font-weight:700; background:var(--surface_tertiary,#2E2D2B); color:var(--text_secondary,#A8A69D); }
      .cunpm-tag[data-type="manual"] { background:var(--surface_brand_secondary,rgba(255,99,82,.16)); color:var(--text_brand,#FF6352); }
      .cunpm-tag[data-type="backup"] { color:var(--text_action_blue_secondary,#64B0F7); }
      .cunpm-draft-text { min-width:0; display:flex; flex-direction:column; gap:2px; }
      .cunpm-draft-first { font-size:13px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cunpm-draft-meta { font-size:11px; color:var(--text_tertiary,#85837D); }
      .cunpm-draft .cunpm-icon { display:inline-flex; color:var(--text_tertiary,#85837D); }

      /* AI */
      .cunpm-ai { display:flex; flex-direction:column; gap:14px; padding:14px 16px 14px; }
      .cunpm-ai-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .cunpm-label { font-size:13px; font-weight:600; color:var(--text_secondary,#A8A69D); }
      .cunpm-mini { display:inline-flex; padding:2px; border-radius:8px; background:var(--surface_tertiary,#2E2D2B); }
      .cunpm-mini button { height:26px; padding:0 9px; border:0; border-radius:6px; background:transparent; color:var(--text_secondary,#A8A69D); font-size:12px; font-weight:600; white-space:nowrap; }
      .cunpm-mini button[aria-pressed="true"] { background:var(--cunpm-bg,var(--bg_screen,#141413)); color:var(--text_primary,#F0EFEB); }
      .cunpm-src { min-height:40px; display:flex; align-items:center; gap:8px; padding:8px 12px; border-radius:10px; background:var(--surface_tertiary,#2E2D2B); font-size:13px; }
      .cunpm-src span:first-of-type { flex:1; }
      .cunpm-src svg { color:var(--text_secondary,#A8A69D); }
      .cunpm-src-n { color:var(--text_secondary,#A8A69D); }
      .cunpm-hint { margin-top:-8px; font-size:11px; color:var(--text_tertiary,#85837D); }
      .cunpm-field { width:100%; display:block; padding:10px 12px; border-radius:8px; border:1px solid var(--outline_secondary,#42413D) !important; background:var(--surface_ivory,#141413) !important;
        color:var(--text_primary,#F0EFEB) !important; font:inherit; font-size:13px; line-height:1.6; resize:vertical; outline:none; }
      .cunpm-field::placeholder { color:var(--text_disabled,#61605A); }
      textarea.cunpm-field { min-height:84px; }
      .cunpm-levels { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; }
      .cunpm-levels button { height:34px; border-radius:8px; border:1px solid var(--divider_secondary,#42413D); background:transparent; color:var(--text_secondary,#A8A69D); font-size:13px; font-weight:500; }
      .cunpm-levels button[aria-checked="true"] { border-color:var(--text_primary,#F0EFEB); background:var(--surface_tertiary,#2E2D2B); color:var(--text_primary,#F0EFEB); font-weight:700; }
      .cunpm-level-desc { margin-top:-6px; font-size:12px; line-height:1.5; color:var(--text_secondary,#A8A69D); }
      .cunpm-primary { height:40px; padding:0 16px; display:inline-flex; align-items:center; justify-content:center; gap:6px; border:0; border-radius:10px;
        background:var(--surface_primary,#FCFCFA); color:var(--text_ivory,#0D0D0C); font-size:14px; font-weight:700; white-space:nowrap; }
      .cunpm-stats { font-size:12px; color:var(--text_secondary,#A8A69D); white-space:nowrap; }
      .cunpm-stats b { color:var(--text_brand,#FF6352); font-weight:700; }
      .cunpm-result { min-height:120px; }
      .cunpm-grid3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; }
      .cunpm-sec { height:36px; padding:0 6px; display:inline-flex; align-items:center; justify-content:center; gap:4px; border-radius:8px; border:1px solid var(--divider_secondary,#42413D);
        background:transparent; color:var(--text_primary,#F0EFEB); font-size:12px; font-weight:600; white-space:nowrap; }
      .cunpm-sec:hover:not(:disabled) { background:var(--state_hover,rgba(255,255,255,.08)); }
      .cunpm-ai-foot { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text_secondary,#A8A69D); }
      .cunpm-link { height:28px; padding:0; display:inline-flex; align-items:center; gap:5px; border:0; background:transparent; color:var(--text_primary,#F0EFEB); font-size:12px; font-weight:600; }
      .cunpm-gear { margin-left:auto; width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:8px; background:transparent; color:var(--text_secondary,#A8A69D); padding:0; }
      .cunpm-gear:hover { background:var(--state_hover,rgba(255,255,255,.08)); }
      .cunpm-status { padding:8px 10px; border-radius:8px; background:var(--surface_tertiary,#2E2D2B); font-size:12px; line-height:1.5; color:var(--text_secondary,#A8A69D); }
      .cunpm-status[hidden] { display:none; }
      .cunpm-status[data-type="success"] { color:var(--alert_success,#2CAA00); }
      .cunpm-status[data-type="error"] { color:var(--text_brand,#FF6352); }

      /* 모바일: 노트 아래 인라인 */
      .cunpm-inline { display:flex; flex-direction:column; gap:10px; padding:16px 20px 4px; border-top:1px solid var(--divider_secondary,#42413D); }
      .cunpm-inline-top { display:flex; align-items:center; gap:6px; }
      .cunpm-inline-title { display:inline-flex; align-items:center; gap:6px; font-size:14px; font-weight:700; }
      .cunpm-inline-title svg { color:var(--text_brand,#FF6352); }
      .cunpm-inline-top .cunpm-mini { margin-left:auto; }
      .cunpm-inline-top .cunpm-gear { margin-left:0; }
      .cunpm-inline-run { display:flex; gap:8px; }
      .cunpm-seg4 { flex:1; display:flex; padding:2px; border-radius:8px; background:var(--surface_tertiary,#2E2D2B); }
      .cunpm-seg4 button { flex:1 1 0; height:34px; border:0; border-radius:6px; background:transparent; color:var(--text_secondary,#A8A69D); font-size:12px; font-weight:700; }
      .cunpm-seg4 button[aria-checked="true"] { background:var(--surface_primary,#FCFCFA); color:var(--text_ivory,#0D0D0C); }
      .cunpm-inline-run .cunpm-primary { height:38px; border-radius:8px; font-size:13px; }
      .cunpm-card { border:1px solid var(--divider_secondary,#42413D); border-radius:12px; background:var(--surface_ivory,#141413); overflow:hidden; }
      .cunpm-card-head { min-height:44px; display:flex; align-items:center; gap:8px; padding:0 6px 0 12px; border-bottom:1px solid var(--divider_secondary,#42413D); }
      .cunpm-card-title { font-size:13px; font-weight:700; white-space:nowrap; }
      .cunpm-card-tools { margin-left:auto; display:flex; gap:2px; }
      .cunpm-card-tools button { width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:8px; background:transparent; color:var(--text_secondary,#A8A69D); padding:0; }
      .cunpm-card textarea { width:100%; min-height:110px; display:block; padding:10px 12px; border:0 !important; outline:none; background:transparent !important; color:var(--text_primary,#F0EFEB) !important; font:inherit; font-size:14px; line-height:1.6; resize:vertical; }
      .cunpm-card-actions { display:flex; gap:8px; padding:10px 12px; border-top:1px solid var(--divider_secondary,#42413D); }
      .cunpm-card-actions .cunpm-sec { flex:1 1 0; height:40px; font-size:13px; }

      /* 창 안 오버레이(프리셋 편집·AI 설정·검토 결과·확인) */
      .cunpm-ov { position:absolute; z-index:90; inset:0; display:flex; align-items:center; justify-content:center; padding:18px; background:rgba(0,0,0,.42); }
      .cunpm-ov-card { width:min(440px,100%); max-height:min(86vh,640px); display:flex; flex-direction:column; border:1px solid var(--divider_secondary,#42413D); border-radius:16px;
        background:var(--cunpm-bg,var(--bg_elevated_primary,#242321)); box-shadow:0 18px 52px rgba(0,0,0,.45); overflow:hidden; }
      .cunpm-ov-card.small { width:min(360px,100%); }
      .cunpm-ov-head { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:16px 12px 8px 18px; }
      .cunpm-ov-title { font-size:16px; font-weight:700; }
      .cunpm-ov-close { width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:8px; background:transparent; color:var(--text_secondary,#A8A69D); padding:0; }
      .cunpm-ov-close:hover { background:var(--state_hover,rgba(255,255,255,.08)); }
      .cunpm-ov-body { flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:4px 18px 14px; display:flex; flex-direction:column; gap:12px; }
      .cunpm-ov-msg { margin:0; font-size:14px; line-height:1.55; color:var(--text_secondary,#A8A69D); white-space:pre-line; }
      .cunpm-ov-actions { flex:0 0 auto; display:flex; align-items:center; justify-content:flex-end; gap:8px; padding:12px 18px 16px; }
      .cunpm-ov-btn { height:38px; padding:0 16px; border-radius:10px; border:1px solid var(--divider_secondary,#42413D); background:transparent; color:var(--text_primary,#F0EFEB); font-size:14px; font-weight:600; }
      .cunpm-ov-btn:hover { background:var(--state_hover,rgba(255,255,255,.08)); }
      .cunpm-ov-btn.primary { border-color:transparent; background:var(--surface_primary,#FCFCFA); color:var(--text_ivory,#0D0D0C); }
      .cunpm-ov-btn.danger { color:var(--text_brand,#FF6352); }
      .cunpm-ov-btn.primary.danger { background:var(--surface_brand_primary,#FF4432); color:#fff; }
      .cunpm-ov-btn.left { margin-right:auto; }
      .cunpm-f { display:flex; flex-direction:column; gap:6px; }
      .cunpm-f > span { font-size:12px; font-weight:600; color:var(--text_secondary,#A8A69D); }
      .cunpm-f select, .cunpm-f input { height:38px; padding:0 10px; }
      .cunpm-f textarea.cunpm-field { min-height:150px; }
      .cunpm-f textarea.cunpm-code { min-height:130px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:11px; }
      .cunpm-f2 { display:grid; grid-template-columns:minmax(0,2fr) minmax(90px,1fr); gap:8px; align-items:end; }
      .cunpm-help { margin:0; font-size:11px; line-height:1.5; color:var(--text_tertiary,#85837D); }
      .cunpm-review { min-height:min(46vh,420px) !important; }

      /* 미리보기(hover, PC 전용) */
      .cunpm-preview { position:fixed; z-index:2147483600; max-width:320px; max-height:50vh; overflow:auto; white-space:pre-wrap; word-break:break-word; pointer-events:none;
        border:1px solid var(--divider_secondary,#42413D); background:var(--bg_elevated_primary,#242321); color:var(--text_primary,#F0EFEB); box-shadow:0 14px 36px rgba(0,0,0,.38); border-radius:12px; padding:12px; }
      .cunpm-preview-count { font-size:11px; color:var(--text_tertiary,#85837D); margin-bottom:6px; }
      .cunpm-preview-title { font-size:13px; font-weight:700; margin-bottom:8px; }
      .cunpm-preview-body { font-size:12px; line-height:1.5; color:var(--text_secondary,#A8A69D); }

      @media (max-width: 640px) {
        .cunpm-ov { padding:12px; align-items:flex-start; }
        .cunpm-ov-card { width:100%; max-height:min(80vh,600px); }
      }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  /* =========================================================
   * 11. 창 안 오버레이 (크롬 기본 confirm/alert 대신)
   * ======================================================= */
  // dialog 자식으로 붙여 Radix가 '모달 바깥 클릭'으로 오인하지 않게 함.
  function openOverlay({ title = '', body = '', actions = [], small = false, cancelValue = null, onAction = null }) {
    closeOverlay();
    const dialog = activeDialog;
    if (!dialog) return null;
    ensureDialogPositioning(dialog);
    const ov = document.createElement('div');
    ov.className = 'cunpm-ov cunpm-ui-font';
    ov.setAttribute('data-cunpm-ui', 'true');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    if (title) ov.setAttribute('aria-label', title);
    ov.innerHTML = `
      <div class="cunpm-ov-card${small ? ' small' : ''}" data-cunpm-ui="true">
        ${title ? `<div class="cunpm-ov-head"><span class="cunpm-ov-title">${esc(title)}</span><button type="button" class="cunpm-ov-close" data-ov="close" aria-label="닫기">${ICON.x}</button></div>` : ''}
        ${body ? `<div class="cunpm-ov-body"${title ? '' : ' style="padding-top:20px"'}>${body}</div>` : ''}
        <div class="cunpm-ov-actions">${actions.map((a, i) => `<button type="button" class="cunpm-ov-btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}${a.left ? ' left' : ''}" data-ov-i="${i}">${esc(a.label)}</button>`).join('')}</div>
      </div>`;
    const card = ov.firstElementChild;
    card.style.setProperty('--cunpm-bg', getSolidBg(dialog) || '');
    let closed = false;
    const finish = (value) => {
      if (closed) return;
      closed = true;
      if (overlayEl === ov) { overlayEl = null; overlayClose = null; }
      ov.querySelectorAll('input,textarea').forEach((el) => { try { el.blur(); } catch (e) {} });
      ov.remove();
      if (onAction) onAction(value);
    };
    ov.addEventListener('click', (e) => {
      if (e.target === ov) { finish(cancelValue); return; }
      const btn = e.target.closest('button');
      if (!btn || !ov.contains(btn)) return;
      if (btn.dataset.ov === 'close') { finish(cancelValue); return; }
      if (btn.dataset.ovI != null) {
        const a = actions[+btn.dataset.ovI];
        if (a && typeof a.run === 'function') { if (a.run(card) === false) return; }
        finish(a ? a.value : cancelValue);
      }
    });
    dialog.appendChild(ov);
    overlayEl = ov;
    overlayClose = () => finish(cancelValue);
    requestAnimationFrame(() => {
      const f = card.querySelector('[data-autofocus]') || card.querySelector('.cunpm-ov-btn.primary') || card.querySelector('button');
      try { f && f.focus({ preventScroll: true }); } catch (e) {}
    });
    return card;
  }
  function closeOverlay() {
    if (overlayClose) overlayClose();
    else if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  }
  function askInDialog({ title = '', message = '', okText = '확인', cancelText = '취소', danger = false, notice = false }) {
    return new Promise((resolve) => {
      const card = openOverlay({
        title,
        small: true,
        body: `<p class="cunpm-ov-msg">${esc(message)}</p>`,
        actions: notice ? [{ label: '확인', value: true, primary: true }] : [{ label: cancelText, value: false }, { label: okText, value: true, primary: true, danger }],
        cancelValue: notice ? true : false,
        onAction: resolve,
      });
      if (!card) resolve(notice ? true : false);
    });
  }

  // 우리 UI가 떠 있을 때 누른 Esc가 크랙까지 가면 유저노트 창 전체가 닫힌다(저장 안 된 노트 포함).
  // 크랙·Radix는 document 캡처 단계에서 Esc를 받으므로 window 캡처에서 먼저 처리한다.
  function onWindowKeydown(e) {
    if (e.key !== 'Escape' || e.isComposing || !activeDialog) return;
    if (overlayEl) {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeOverlay();
      return;
    }
    const t = e.target;
    if (t && isOurs(t) && t.matches && t.matches('input, textarea, select')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (t.matches('.cunpm-search input') && t.value) { t.value = ''; searchQuery = ''; renderList(); return; }
      try { t.blur(); } catch (err) {}
    }
  }

  /* =========================================================
   * 12. 프리셋 편집기 · AI 설정 · 검토 결과
   * ======================================================= */
  function markNonCredentialField(el) {
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
    el.setAttribute('data-lpignore', 'true');
    el.setAttribute('data-1p-ignore', 'true');
    el.setAttribute('data-form-type', 'other');
  }
  function openEditor(p) {
    editingId = p ? p.id : null;
    const card = openOverlay({
      title: editingId ? '프리셋 수정' : '새 프리셋',
      body: `
        <label class="cunpm-f"><span>프리셋 이름</span><input type="text" class="cunpm-field" data-ed="name" placeholder="프리셋 제목" data-autofocus></label>
        <label class="cunpm-f"><span>내용</span><textarea class="cunpm-field" data-ed="content" rows="7" placeholder="프리셋 내용"></textarea></label>`,
      actions: [
        ...(editingId ? [{ label: '삭제', value: 'delete', danger: true, left: true }] : []),
        { label: '취소', value: null },
        {
          label: '저장', value: 'save', primary: true,
          run: (c) => {
            const name = c.querySelector('[data-ed="name"]').value;
            const content = c.querySelector('[data-ed="content"]').value;
            if (!name.trim() && !content.trim()) return true;
            if (editingId) updatePreset(editingId, { name, content });
            else addPreset({ name, content });
            return true;
          },
        },
      ],
      onAction: async (value) => {
        const id = editingId;
        editingId = null;
        if (value === 'delete' && id) {
          const target = presets.find((x) => x.id === id);
          const ok = await askInDialog({ message: `'${target?.name || '이름 없음'}' 프리셋을 삭제할까요?`, okText: '삭제', danger: true });
          if (ok) { deletePreset(id); activePresetIds.delete(id); }
        }
        renderList({ keepScroll: true });
        applyToTextarea();
      },
    });
    if (!card) return;
    const nameI = card.querySelector('[data-ed="name"]');
    const contentT = card.querySelector('[data-ed="content"]');
    markNonCredentialField(nameI);
    markNonCredentialField(contentT);
    nameI.value = p ? (p.name || '') : '';
    contentT.value = p ? (p.content || '') : '';
  }

  function openSettings() {
    const s = loadAiSettings();
    const modelOptions = (purpose) => GEMINI_MODELS.map((m) => {
      const rec = purpose === 'review' ? ['gemini-3.1-pro-preview', 'gemini-2.5-pro'].includes(m.id) : ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'].includes(m.id);
      return `<option value="${esc(m.id)}">${esc(m.label + (rec ? ' (권장)' : ''))}</option>`;
    }).join('');
    const reasoning = '<option value="low">하</option><option value="medium">중</option><option value="high">상</option>';
    const card = openOverlay({
      title: 'AI 설정',
      body: `
        <label class="cunpm-f"><span>API 종류</span><select class="cunpm-field" data-s="provider"><option value="gemini">Gemini API</option><option value="firebase">Firebase AI Logic (CDN 설정)</option></select></label>
        <div data-s-group="gemini" class="cunpm-f" style="gap:12px">
          <label class="cunpm-f"><span>Gemini API 키</span><input type="password" class="cunpm-field" data-s="geminiApiKey" data-autofocus></label>
          <div class="cunpm-f2"><label class="cunpm-f"><span>작성/압축 모델</span><select class="cunpm-field" data-s="geminiModel">${modelOptions('writing')}</select></label><label class="cunpm-f"><span>추론 강도</span><select class="cunpm-field" data-s="geminiReasoningLevel">${reasoning}</select></label></div>
          <div class="cunpm-f2"><label class="cunpm-f"><span>검토 모델</span><select class="cunpm-field" data-s="geminiReviewModel">${modelOptions('review')}</select></label><label class="cunpm-f"><span>추론 강도</span><select class="cunpm-field" data-s="geminiReviewReasoningLevel">${reasoning}</select></label></div>
          <p class="cunpm-help">기본값: 작성/압축 3.7 Flash · 검토 3.1 Pro. 3.1 Pro는 결제 설정과 API 접근 권한이 필요할 수 있어요.</p>
        </div>
        <div data-s-group="firebase" class="cunpm-f" style="gap:12px">
          <label class="cunpm-f"><span>Firebase CDN 설정 (firebaseConfig)</span><textarea class="cunpm-field cunpm-code" data-s="firebaseConfig" placeholder='const firebaseConfig = {\n  apiKey: "...",\n  projectId: "...",\n  appId: "..."\n};'></textarea></label>
          <p class="cunpm-help">Firebase 콘솔의 웹 앱 설정에 나오는 firebaseConfig 객체를 그대로 붙여넣으세요.</p>
          <div class="cunpm-f2"><label class="cunpm-f"><span>Gemini API 백엔드</span><select class="cunpm-field" data-s="firebaseBackend"><option value="googleAI">Gemini Developer API</option><option value="vertexAI">Vertex AI Gemini API</option></select></label><label class="cunpm-f"><span>Vertex 위치</span><input type="text" class="cunpm-field" data-s="firebaseLocation" placeholder="global"></label></div>
          <div class="cunpm-f2"><label class="cunpm-f"><span>작성/압축 모델</span><select class="cunpm-field" data-s="firebaseModel">${modelOptions('writing')}</select></label><label class="cunpm-f"><span>추론 강도</span><select class="cunpm-field" data-s="firebaseReasoningLevel">${reasoning}</select></label></div>
          <div class="cunpm-f2"><label class="cunpm-f"><span>검토 모델</span><select class="cunpm-field" data-s="firebaseReviewModel">${modelOptions('review')}</select></label><label class="cunpm-f"><span>추론 강도</span><select class="cunpm-field" data-s="firebaseReviewReasoningLevel">${reasoning}</select></label></div>
          <p class="cunpm-help">Gemini 3.x나 Preview 모델을 Vertex AI로 쓸 때는 위치가 global이어야 해요.</p>
        </div>
        <label class="cunpm-f"><span>추가 작성/압축 지침 (선택)</span><textarea class="cunpm-field" data-s="additionalCompressionPrompt" rows="3" placeholder="기본 지침에 더할 내용만 입력하세요." style="min-height:76px"></textarea></label>
        <p class="cunpm-help">압축에는 1차 압축 지침, 검토에는 2차 구조 분석 지침이 자동으로 붙어요.</p>`,
      actions: [
        { label: '취소', value: null },
        {
          label: '저장', value: 'save', primary: true,
          run: (c) => {
            const next = { ...loadAiSettings() };
            c.querySelectorAll('[data-s]').forEach((el) => { next[el.dataset.s] = el.value; });
            saveAiSettings(next);
            return true;
          },
        },
      ],
      onAction: (value) => {
        if (value === 'save') setAiStatus('AI 설정을 저장했어요.', 'success');
        renderAi();
      },
    });
    if (!card) return;
    card.querySelectorAll('[data-s]').forEach((el) => {
      if (el.dataset.s in s) el.value = s[el.dataset.s];
      if (el.matches('input, textarea')) markNonCredentialField(el);
    });
    const syncGroups = () => {
      const provider = card.querySelector('[data-s="provider"]').value;
      card.querySelectorAll('[data-s-group]').forEach((g) => { g.hidden = g.dataset.sGroup !== provider; g.style.display = g.hidden ? 'none' : ''; });
    };
    card.querySelector('[data-s="provider"]').addEventListener('change', syncGroups);
    syncGroups();
  }

  function openReview() {
    if (!ai.review) { setAiStatus('아직 검토 결과가 없어요.', 'error'); return; }
    const card = openOverlay({
      title: '프롬프트 구조 분석 결과',
      body: `<p class="cunpm-help">검토 모델이 2차 지침으로 한글화·우선순위·충돌/반영 방식을 분석한 결과예요.</p><textarea class="cunpm-field cunpm-review" readonly></textarea>`,
      actions: [
        { label: '복사', value: 'copy', run: () => { copyText(ai.review, '검토 결과를 복사했어요.'); return true; } },
        { label: '확인', value: true, primary: true },
      ],
    });
    if (card) card.querySelector('.cunpm-review').value = ai.review;
  }

  /* =========================================================
   * 13. 패널 (PC=왼쪽 탭 패널 / 모바일=창 위 패널)
   * ======================================================= */
  function buildPanel(dialog) {
    const panel = document.createElement('div');
    panel.className = 'cunpm-panel cunpm-ui-font';
    panel.setAttribute('data-cunpm-ui', 'true');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', '유저노트 도우미');
    panel.innerHTML = `
      <div class="cunpm-tabs" role="tablist">
        <button type="button" class="cunpm-tab" role="tab" data-tab="presets">프리셋</button>
        <button type="button" class="cunpm-tab" role="tab" data-tab="drafts">임시저장</button>
        <button type="button" class="cunpm-tab" role="tab" data-tab="ai">${ICON.spark}AI 압축</button>
      </div>
      <div class="cunpm-tabpanel" role="tabpanel" data-panel="presets">
        <div class="cunpm-head"><span class="cunpm-title">유저노트 프리셋</span><button type="button" class="cunpm-btn-sm" data-act="new-preset">${ICON.plus}새 프리셋</button></div>
        <label class="cunpm-search">${ICON.search}<input type="text" placeholder="프리셋 검색" aria-label="프리셋 검색"></label>
        <div class="cunpm-scroll"><div class="cunpm-list"></div></div>
        <div class="cunpm-foot" data-foot="presets"></div>
      </div>
      <div class="cunpm-tabpanel" role="tabpanel" data-panel="drafts" hidden>
        <div class="cunpm-head"><span class="cunpm-title">임시저장</span><button type="button" class="cunpm-btn-sm" data-act="new-draft">${ICON.plus}저장본 만들기</button></div>
        <div class="cunpm-scroll"><div class="cunpm-drafts-list"></div></div>
        <div class="cunpm-foot"><span>자동 저장은 최근 3개, 적용 전은 3개까지 남아요</span></div>
      </div>
      <div class="cunpm-tabpanel" role="tabpanel" data-panel="ai" hidden>
        <div class="cunpm-scroll" style="padding:0"><div class="cunpm-ai" data-ai-host="panel"></div></div>
      </div>`;
    panel.style.setProperty('--cunpm-bg', getSolidBg(dialog) || '');
    const search = panel.querySelector('.cunpm-search input');
    markNonCredentialField(search);
    search.addEventListener('input', debounce((e) => { searchQuery = e.target.value || ''; renderList(); }, 100));
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('.cunpm-handle');
      if (h && panel.contains(h)) onHandleDown(e, h.closest('.cunpm-row'));
    });
    panel.addEventListener('mouseover', onPreviewOver);
    panel.addEventListener('mouseout', onPreviewOut);
    panel.addEventListener('input', onAiInput);
    return panel;
  }

  function setTab(tab) {
    const requested = tab;
    if (mobileMode && tab === 'ai') tab = 'presets';
    ui.tab = tab;
    if (requested === tab) gmSet(KEY_UI, { tab });
    if (!panelEl) return;
    panelEl.querySelectorAll('.cunpm-tab').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
      b.hidden = mobileMode && b.dataset.tab === 'ai';
    });
    panelEl.querySelectorAll('.cunpm-tabpanel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    if (tab === 'presets') renderList();
    if (tab === 'drafts') renderDrafts();
    if (tab === 'ai') renderAi();
    syncFooterButton();
  }

  function onPanelClick(e) {
    const tabBtn = e.target.closest('.cunpm-tab');
    if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
    const btn = e.target.closest('button[data-act]');
    if (!btn || !panelEl.contains(btn)) return;
    const act = btn.dataset.act;
    const row = btn.closest('.cunpm-row');
    const id = row && row.dataset.id;
    if (act === 'new-preset') openEditor(null);
    else if (act === 'toggle' && id) {
      setPresetActive(id, !isPresetActive(id));
      renderList({ keepScroll: true });
      applyToTextarea();
    } else if (act === 'edit' && id) openEditor(presets.find((x) => x.id === id));
    else if (act === 'delete' && id) {
      const p = presets.find((x) => x.id === id);
      askInDialog({ message: `'${p?.name || '이름 없음'}' 프리셋을 삭제할까요?`, okText: '삭제', danger: true }).then((ok) => {
        if (!ok) return;
        deletePreset(id);
        activePresetIds.delete(id);
        renderList({ keepScroll: true });
        applyToTextarea();
      });
    } else if (act === 'new-draft') createManualDraft();
    else if (act === 'load-draft') loadDraft(btn.closest('.cunpm-draft').dataset.id);
    else if (act === 'delete-draft') deleteDraft(btn.closest('.cunpm-draft').dataset.id);
    else onAiAction(act, btn);
  }

  function restoreListScroll(list, top) {
    if (!list) return;
    const maxTop = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTop = Math.max(0, Math.min(top, maxTop));
  }
  function renderList(opts) {
    if (!panelEl) return;
    const list = panelEl.querySelector('.cunpm-list');
    const scroller = list.parentElement;
    const keep = !!(opts && opts.keepScroll);
    const top = keep ? scroller.scrollTop : 0;
    const q = searchQuery.trim().toLowerCase();
    list.setAttribute('data-search', q ? '1' : '0');
    let rows = presets.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    if (q) rows = rows.filter((p) => ((p.name || '') + '\n' + (p.content || '')).toLowerCase().includes(q));
    if (!presets.length) list.innerHTML = '<div class="cunpm-empty">아직 프리셋이 없어요. [새 프리셋]으로 추가해 주세요.</div>';
    else if (!rows.length) list.innerHTML = '<div class="cunpm-empty">검색 결과가 없어요.</div>';
    else {
      list.innerHTML = (q ? '<div class="cunpm-note">검색 중에는 순서를 바꿀 수 없어요</div>' : '') + rows.map((p) => {
        const on = isPresetActive(p.id);
        const name = p.name || '(이름 없음)';
        return `<div class="cunpm-row" data-id="${esc(p.id)}" data-active="${on ? 1 : 0}">
          <span class="cunpm-handle" title="끌어서 순서 바꾸기">${ICON.grip}</span>
          <button type="button" class="cunpm-row-main" data-act="toggle" aria-pressed="${on}"><span class="cunpm-check">${ICON.check}</span><span class="cunpm-name">${esc(name)}</span></button>
          <span class="cunpm-count">${num(presetDisplayCount(p))}자</span>
          <button type="button" class="cunpm-icon" data-act="edit" aria-label="${esc(name)} 편집">${ICON.pencil}</button>
          <button type="button" class="cunpm-icon" data-act="delete" aria-label="${esc(name)} 삭제">${ICON.trash}</button>
        </div>`;
      }).join('');
    }
    if (keep) { restoreListScroll(scroller, top); requestAnimationFrame(() => restoreListScroll(scroller, top)); }
    refreshCounts();
  }
  function renderDrafts() {
    if (!panelEl) return;
    const listEl = panelEl.querySelector('.cunpm-drafts-list');
    const arr = getDrafts(getRoomId()).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!arr.length) {
      listEl.innerHTML = '<div class="cunpm-empty">입력하면 자동으로 저장돼요.<br>필요하면 [저장본 만들기]로 따로 남길 수 있어요.</div>';
      return;
    }
    const tagName = { auto: '자동', manual: '수동', backup: '적용 전' };
    listEl.innerHTML = arr.map((d) => {
      const type = draftType(d);
      const first = (d.content || '').split('\n').find((l) => l.trim()) || '';
      return `<div class="cunpm-draft" data-id="${esc(d.id)}" data-active="${d.id === activeDraftId ? 1 : 0}">
        <button type="button" class="cunpm-draft-main" data-act="load-draft"><span class="cunpm-tag" data-type="${type}">${tagName[type]}</span>
          <span class="cunpm-draft-text"><span class="cunpm-draft-first">${esc(first.trim() || '(빈 내용)')}</span><span class="cunpm-draft-meta">${fmtTime(d.updatedAt)} · ${num((d.content || '').length)}자${d.id === activeDraftId ? ' · 선택됨' : ''}</span></span></button>
        <button type="button" class="cunpm-icon" data-act="delete-draft" aria-label="임시저장 삭제">${ICON.trash}</button>
      </div>`;
    }).join('');
  }

  // 칩 숫자·패널 아래 줄·글자수 옆 배지
  function refreshCounts() {
    const n = activePresetIds.size;
    const add = appliedLength();
    if (chipEl) {
      const c = chipEl.querySelector('.cunpm-chip-count');
      const t = n ? String(n) : '';
      if (c && c.textContent !== t) c.textContent = t;
    }
    const foot = panelEl && panelEl.querySelector('[data-foot="presets"]');
    if (foot) foot.innerHTML = `<span>선택 ${n}개</span>${add ? `<span>노트 끝에 <b>+${num(add)}자</b></span>` : ''}`;
    renderCounterBadge(add);
  }
  const refreshCountsDebounced = debounce(refreshCounts, 80);

  // 순정 글자수(예: 1026/2000)는 크랙이 그리는 값이라 건드리지 않고, 앞에 '프리셋 +N'만 붙인다.
  function renderCounterBadge(add) {
    const dialog = activeDialog;
    if (!dialog) return;
    const counter = findNativeCounter(dialog);
    if (!add || !counter || !counter.parentElement) {
      if (badgeEl) { restoreCounter(); badgeEl.remove(); badgeEl = null; }
      return;
    }
    if (!badgeEl || !badgeEl.isConnected || badgeEl.nextElementSibling !== counter) {
      if (badgeEl) badgeEl.remove();
      badgeEl = document.createElement('span');
      badgeEl.className = 'cunpm-badge';
      badgeEl.setAttribute('data-cunpm-ui', 'true');
      counter.insertAdjacentElement('beforebegin', badgeEl);
      if (!counter.hasAttribute('data-cunpm-flex')) counter.setAttribute('data-cunpm-flex', counter.style.flex || '');
      // 순정 글자수는 flex-1이라, 배지가 margin-left:auto로 붙도록 내용 폭만 쓰게 한다.
      counter.style.flex = '0 0 auto';
    }
    const t = `프리셋 +${num(add)}`;
    if (badgeEl.textContent !== t) badgeEl.textContent = t;
  }
  function restoreCounter() {
    document.querySelectorAll('[data-cunpm-flex]').forEach((c) => {
      c.style.flex = c.getAttribute('data-cunpm-flex') || '';
      c.removeAttribute('data-cunpm-flex');
    });
  }

  /* ---------- 드래그 순서 변경 ---------- */
  function onHandleDown(e, row) {
    if (!row || searchQuery.trim()) return;
    e.preventDefault();
    e.stopPropagation();
    const list = row.parentElement;
    const pointerId = e.pointerId;
    const startY = e.clientY;
    const startRect = row.getBoundingClientRect();
    const pointerOffsetY = startY - startRect.top;
    const oldStyle = row.getAttribute('style') || '';
    let dragging = false;
    let placeholder = null;
    let moved = false;
    const scroller = list.parentElement;
    const setRowY = (clientY) => { row.style.top = Math.round(clientY - pointerOffsetY) + 'px'; };
    const getBeforeNode = (clientY) => {
      for (const r of list.querySelectorAll('.cunpm-row')) {
        const rect = r.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return r;
      }
      return null;
    };
    const movePlaceholder = (clientY) => {
      const before = getBeforeNode(clientY);
      if (before !== placeholder && before !== placeholder.nextSibling) list.insertBefore(placeholder, before);
      else if (!before && placeholder.nextSibling) list.appendChild(placeholder);
    };
    const autoScrollList = (clientY) => {
      const rect = scroller.getBoundingClientRect();
      const edge = 30;
      let delta = 0;
      if (clientY < rect.top + edge) delta = -Math.min(14, rect.top + edge - clientY);
      else if (clientY > rect.bottom - edge) delta = Math.min(14, clientY - (rect.bottom - edge));
      if (delta) scroller.scrollTop += delta;
    };
    const beginDrag = () => {
      dragging = true;
      moved = true;
      placeholder = document.createElement('div');
      placeholder.className = 'cunpm-drag-placeholder';
      placeholder.setAttribute('data-cunpm-ui', 'true');
      placeholder.style.height = Math.max(40, Math.round(startRect.height)) + 'px';
      list.insertBefore(placeholder, row);
      row.classList.add('cunpm-dragging');
      Object.assign(row.style, {
        position: 'fixed', left: Math.round(startRect.left) + 'px', top: Math.round(startRect.top) + 'px',
        width: Math.round(startRect.width) + 'px', height: Math.round(startRect.height) + 'px',
        zIndex: '2147483600', pointerEvents: 'none',
      });
      // 크랙 창은 transform으로 가운데 정렬돼 있어 창 안의 fixed는 어긋난다. 끄는 동안만 body로 옮긴다(원본과 같음).
      document.body.appendChild(row);
    };
    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      ev.preventDefault();
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < 4) return;
        beginDrag();
      }
      setRowY(ev.clientY);
      autoScrollList(ev.clientY);
      movePlaceholder(ev.clientY);
    };
    const finish = (ev) => {
      if (ev && ev.pointerId !== pointerId) return;
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('pointercancel', finish, true);
      if (dragging && placeholder) {
        list.insertBefore(row, placeholder);
        placeholder.remove();
      }
      row.classList.remove('cunpm-dragging');
      if (oldStyle) row.setAttribute('style', oldStyle);
      else row.removeAttribute('style');
      if (moved) {
        reorderByIds([...list.querySelectorAll('.cunpm-row')].map((r) => r.dataset.id));
        renderList({ keepScroll: true });
        applyToTextarea();
      }
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', finish, true);
    document.addEventListener('pointercancel', finish, true);
  }

  /* ---------- 미리보기 (hover, PC 전용) ---------- */
  let previewEl = null;
  let previewTimer = null;
  function closePreview() {
    clearTimeout(previewTimer);
    if (previewEl) { previewEl.remove(); previewEl = null; }
  }
  function onPreviewOver(e) {
    if (mobileMode) return;
    const nameEl = e.target.closest('.cunpm-name');
    if (!nameEl || nameEl === previewEl?.__anchor) return;
    const row = nameEl.closest('.cunpm-row');
    const p = row && presets.find((x) => x.id === row.dataset.id);
    if (!p) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => openPreview(p, nameEl), 120);
  }
  function onPreviewOut(e) {
    if (!e.target.closest('.cunpm-name')) return;
    if (e.relatedTarget && e.target.closest('.cunpm-name').contains(e.relatedTarget)) return;
    closePreview();
  }
  function openPreview(p, anchor) {
    closePreview();
    const card = document.createElement('div');
    card.className = 'cunpm-preview cunpm-ui-font';
    card.setAttribute('data-cunpm-ui', 'true');
    card.innerHTML = `<div class="cunpm-preview-count">${num(presetDisplayCount(p))}자</div><div class="cunpm-preview-title">${esc(p.name || '(이름 없음)')}</div><div class="cunpm-preview-body">${esc(p.content || '')}</div>`;
    card.__anchor = anchor;
    document.body.appendChild(card);
    const r = anchor.getBoundingClientRect();
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let x = r.right + 8, y = r.top;
    if (x + cw > window.innerWidth - 8) x = Math.max(8, r.left - cw - 8);
    if (y + ch > window.innerHeight - 8) y = Math.max(8, window.innerHeight - ch - 8);
    card.style.left = x + 'px';
    card.style.top = y + 'px';
    previewEl = card;
  }

  /* =========================================================
   * 14. AI 화면 (PC=패널 탭 / 모바일=노트 아래 인라인)
   * ======================================================= */
  function statsHtml() {
    if (!ai.result) return '';
    const src = ai.resultSource || 0;
    const res = ai.result.length;
    if (!src) return `<span class="cunpm-stats">${num(res)}자</span>`;
    const r = Math.round((1 - res / src) * 1000) / 10;
    return `<span class="cunpm-stats">${num(src)} → ${num(res)}자 · <b>${r >= 0 ? '−' : '+'}${Math.abs(r)}%</b></span>`;
  }
  function sourceSegHtml() {
    return `<div class="cunpm-mini" role="group" aria-label="원문"><button type="button" data-act="ai-src" data-src="note" aria-pressed="${ai.source === 'note'}">현재 노트</button><button type="button" data-act="ai-src" data-src="custom" aria-pressed="${ai.source === 'custom'}">직접 입력</button></div>`;
  }
  function renderPanelAi(host, s) {
    const lv = levelOf(s.compressionLevel);
    const busy = !!ai.busy;
    const base = getCurrentBase();
    host.innerHTML = `
      <div class="cunpm-ai-row"><span class="cunpm-label">원문</span>${sourceSegHtml()}</div>
      ${ai.source === 'note'
        ? `<div class="cunpm-src">${ICON.note}<span>열린 유저노트 전체</span><span class="cunpm-src-n" data-ai-src-n>${num(base.length)}자</span></div>${activePresetIds.size ? '<div class="cunpm-hint">켜 둔 프리셋은 빼고 가져와요</div>' : ''}`
        : '<textarea class="cunpm-field" data-ai-custom rows="4" placeholder="정리하거나 압축할 RP/캐릭터/세계관 내용을 붙여넣으세요."></textarea>'}
      <div class="cunpm-f" style="gap:8px"><span class="cunpm-label">압축 강도</span>
        <div class="cunpm-levels" role="radiogroup" aria-label="압축 강도">${LEVELS.map((l) => `<button type="button" role="radio" data-act="ai-level" data-level="${l.id}" aria-checked="${l.id === s.compressionLevel}">${l.label}</button>`).join('')}</div>
        <span class="cunpm-level-desc">${esc(lv.desc)}</span></div>
      <button type="button" class="cunpm-primary" data-act="ai-run"${busy ? ' disabled' : ''}>${ai.busy === 'compress' ? `${ICON.ring}압축 중…` : `${ICON.spark}${lv.label} 단계로 압축`}</button>
      <div class="cunpm-f" style="gap:8px">
        <div class="cunpm-ai-row"><span class="cunpm-label">결과</span><span data-ai-stats>${statsHtml()}</span></div>
        <textarea class="cunpm-field cunpm-result" data-ai-result placeholder="${esc(lv.label)} 단계 압축 결과"></textarea>
        <div class="cunpm-grid3">
          <button type="button" class="cunpm-sec" data-act="ai-replace"${busy || !ai.result ? ' disabled' : ''}>${ICON.swap}노트 교체</button>
          <button type="button" class="cunpm-sec" data-act="ai-append"${busy || !ai.result ? ' disabled' : ''}>${ICON.append}아래에 추가</button>
          <button type="button" class="cunpm-sec" data-act="ai-copy"${!ai.result ? ' disabled' : ''}>${ICON.copy}복사</button>
        </div>
      </div>
      <div class="cunpm-status" data-cunpm-ai-status role="status" aria-live="polite"></div>
      <div class="cunpm-ai-foot">
        <button type="button" class="cunpm-link" data-act="ai-review"${busy || !ai.result ? ' disabled' : ''}>${ai.busy === 'review' ? ICON.ring : ICON.review}결과 검토</button>
        ${ai.review ? '<span>·</span><button type="button" class="cunpm-link" data-act="ai-review-open">지난 검토</button>' : ''}
        <span>·</span><span>${esc(modelLabel(s))}</span>
        <button type="button" class="cunpm-gear" data-act="ai-settings" aria-label="AI 설정">${ICON.gear}</button>
      </div>`;
  }
  function renderInlineAi(host, s) {
    const lv = levelOf(s.compressionLevel);
    const busy = !!ai.busy;
    host.innerHTML = `
      <div class="cunpm-inline-top"><span class="cunpm-inline-title">${ICON.spark}AI 정리·압축</span>${sourceSegHtml()}<button type="button" class="cunpm-gear" data-act="ai-settings" aria-label="AI 설정">${ICON.gear}</button></div>
      ${ai.source === 'custom' ? '<textarea class="cunpm-field" data-ai-custom rows="3" placeholder="정리하거나 압축할 내용을 붙여넣으세요."></textarea>' : ''}
      <div class="cunpm-inline-run">
        <div class="cunpm-seg4" role="radiogroup" aria-label="압축 강도">${LEVELS.map((l) => `<button type="button" role="radio" data-act="ai-level" data-level="${l.id}" aria-checked="${l.id === s.compressionLevel}">${l.label}</button>`).join('')}</div>
        <button type="button" class="cunpm-primary" data-act="ai-run"${busy ? ' disabled' : ''}>${ai.busy === 'compress' ? `${ICON.ring}압축 중` : '압축'}</button>
      </div>
      <div class="cunpm-status" data-cunpm-ai-status role="status" aria-live="polite"></div>
      ${ai.result ? `
      <div class="cunpm-card">
        <div class="cunpm-card-head"><span class="cunpm-card-title">${esc(levelOf(ai.resultLevel || s.compressionLevel).label)} 단계 결과</span><span data-ai-stats>${statsHtml()}</span>
          <span class="cunpm-card-tools">
            <button type="button" data-act="ai-copy" aria-label="결과 복사">${ICON.copy}</button>
            <button type="button" data-act="ai-review" aria-label="결과 검토"${busy ? ' disabled' : ''}>${ai.busy === 'review' ? ICON.ring : ICON.review}</button>
            <button type="button" data-act="ai-clear" aria-label="결과 지우기">${ICON.x}</button>
          </span></div>
        <textarea data-ai-result aria-label="압축 결과"></textarea>
        <div class="cunpm-card-actions">
          <button type="button" class="cunpm-sec" data-act="ai-replace"${busy ? ' disabled' : ''}>${ICON.swap}노트 교체</button>
          <button type="button" class="cunpm-sec" data-act="ai-append"${busy ? ' disabled' : ''}>${ICON.append}아래에 추가</button>
        </div>
      </div>` : ''}`;
  }
  function renderAi() {
    const s = loadAiSettings();
    const hosts = [];
    if (panelEl && !mobileMode && ui.tab === 'ai') hosts.push(['panel', panelEl.querySelector('[data-ai-host="panel"]')]);
    if (inlineEl) hosts.push(['inline', inlineEl]);
    for (const [kind, host] of hosts) {
      if (!host) continue;
      const focused = host.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focused && (focused.matches('[data-ai-custom]') ? 'custom' : focused.matches('[data-ai-result]') ? 'result' : '');
      if (kind === 'panel') renderPanelAi(host, s);
      else renderInlineAi(host, s);
      const custom = host.querySelector('[data-ai-custom]');
      if (custom) { custom.value = ai.custom; markNonCredentialField(custom); }
      const result = host.querySelector('[data-ai-result]');
      if (result) { result.value = ai.result; markNonCredentialField(result); }
      if (focusKey) { const el = host.querySelector(focusKey === 'custom' ? '[data-ai-custom]' : '[data-ai-result]'); try { el && el.focus({ preventScroll: true }); } catch (e) {} }
    }
    setAiStatus(ai.status, ai.statusType);
  }
  function refreshAiSourceInfo() {
    const n = panelEl && panelEl.querySelector('[data-ai-src-n]');
    if (n) n.textContent = `${num(getCurrentBase().length)}자`;
  }
  function onAiInput(e) {
    const t = e.target;
    if (t.matches('[data-ai-custom]')) ai.custom = t.value;
    else if (t.matches('[data-ai-result]')) {
      ai.result = t.value;
      for (const s of document.querySelectorAll('[data-ai-stats]')) s.innerHTML = statsHtml();
    }
  }
  function onAiAction(act, btn) {
    if (act === 'ai-src') { ai.source = btn.dataset.src === 'custom' ? 'custom' : 'note'; renderAi(); }
    else if (act === 'ai-level') {
      saveAiSettings({ ...loadAiSettings(), compressionLevel: btn.dataset.level });
      renderAi();
    } else if (act === 'ai-run') runCompress();
    else if (act === 'ai-replace') applyAiResult('replace');
    else if (act === 'ai-append') applyAiResult('append');
    else if (act === 'ai-copy') { if (ai.result.trim()) copyText(ai.result, '결과를 복사했어요.'); }
    else if (act === 'ai-review') runReview();
    else if (act === 'ai-review-open') openReview();
    else if (act === 'ai-settings') openSettings();
    else if (act === 'ai-clear') { ai.result = ''; ai.resultSource = 0; setAiStatus(''); renderAi(); }
  }

  /* =========================================================
   * 15. 칩 · 창 아래 버튼 · 인라인 붙이기
   * ======================================================= */
  function mountChip(dialog) {
    if (chipEl && chipEl.isConnected) return;
    const title = findUsernoteTitleElement(dialog);
    if (!title) return;
    chipEl = document.createElement('button');
    chipEl.type = 'button';
    chipEl.className = 'cunpm-chip cunpm-ui-font';
    chipEl.setAttribute('data-cunpm-ui', 'true');
    chipEl.setAttribute('aria-expanded', String(!!ui.panelOpen));
    chipEl.innerHTML = `${ICON.layers}<span>프리셋</span><span class="cunpm-chip-count"></span>`;
    chipEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (ui.panelOpen) setPanelOpen(false);
      else setPanelOpen(true, ui.tab === 'ai' && mobileMode ? 'presets' : ui.tab);
    });
    title.insertAdjacentElement('afterend', chipEl);
    refreshCounts();
  }
  function mountFooterButton(dialog) {
    if (mobileMode) { if (footerBtnEl) { footerBtnEl.remove(); footerBtnEl = null; } return; }
    if (footerBtnEl && footerBtnEl.isConnected) return;
    const submit = findSubmitButton(dialog);
    if (!submit || !submit.parentElement) return;
    footerBtnEl = document.createElement('button');
    footerBtnEl.type = 'button';
    footerBtnEl.className = 'cunpm-footer-ai cunpm-ui-font';
    footerBtnEl.setAttribute('data-cunpm-ui', 'true');
    footerBtnEl.innerHTML = `${ICON.spark}AI 압축`;
    footerBtnEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (ui.panelOpen && ui.tab === 'ai') setPanelOpen(false);
      else setPanelOpen(true, 'ai');
    });
    submit.parentElement.insertBefore(footerBtnEl, submit);
    syncFooterButton();
  }
  function syncFooterButton() {
    if (!footerBtnEl) return;
    const v = String(!!(ui.panelOpen && ui.tab === 'ai'));
    if (footerBtnEl.getAttribute('aria-expanded') !== v) footerBtnEl.setAttribute('aria-expanded', v);
  }
  function mountInline(dialog) {
    if (!mobileMode) { if (inlineEl) { inlineEl.remove(); inlineEl = null; } return; }
    if (inlineEl && inlineEl.isConnected) return;
    const ta = getTextarea(dialog);
    const submit = findSubmitButton(dialog);
    if (!ta) return;
    // 노트 본문 묶음 바로 뒤(창 아래 버튼 줄 앞)에 붙인다.
    let anchor = ta;
    while (anchor.parentElement && anchor.parentElement !== dialog && !(submit && anchor.parentElement.contains(submit))) anchor = anchor.parentElement;
    inlineEl = document.createElement('div');
    inlineEl.className = 'cunpm-inline cunpm-ui-font';
    inlineEl.setAttribute('data-cunpm-ui', 'true');
    inlineEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (btn && inlineEl.contains(btn)) onAiAction(btn.dataset.act, btn);
    });
    inlineEl.addEventListener('input', onAiInput);
    anchor.insertAdjacentElement('afterend', inlineEl);
    renderAi();
  }

  /* =========================================================
   * 16. 레이아웃 (PC=왼쪽 + 가운데 유지 / 모바일=위)
   * ======================================================= */
  let layoutTimer = null;
  function restoreDialogShift(dialog) {
    if (dialog && dialog.style.marginLeft) dialog.style.marginLeft = '';
  }
  // 패널을 dialog 기준 absolute로 붙임. (PC=왼쪽, 모바일=위)
  function positionPanel(dialog) {
    if (!panelEl || !dialog) return;
    if (mobileMode) {
      restoreDialogShift(dialog);
      const r = dialog.getBoundingClientRect();
      const avail = Math.max(0, r.top - GAP - MOBILE_TOP_SAFE);
      // 위쪽 여유가 140px보다 작으면 남은 공간 안에서만 높이를 잡고, 내용은 목록 안에서 스크롤한다.
      const h = avail < MOBILE_PANEL_MIN_PX ? avail : Math.min(MOBILE_PANEL_MAX_PX, avail);
      Object.assign(panelEl.style, { left: '8px', right: '8px', width: 'auto', top: 'auto', bottom: `calc(100% + ${GAP}px)`, height: Math.round(h) + 'px' });
    } else {
      let shift = (PANEL_W + GAP) / 2;
      dialog.style.marginLeft = Math.round(shift) + 'px';
      // 패널이 화면 왼쪽으로 잘리면 모달을 더 오른쪽으로 밀어 보정
      const r = dialog.getBoundingClientRect();
      const panelLeft = r.left - GAP - PANEL_W;
      if (panelLeft < 8) {
        shift += (8 - panelLeft);
        dialog.style.marginLeft = Math.round(shift) + 'px';
      }
      // 창 테두리(1px)까지 높이를 맞춘다.
      const bt = parseFloat(getComputedStyle(dialog).borderTopWidth) || 0;
      const bb = parseFloat(getComputedStyle(dialog).borderBottomWidth) || 0;
      Object.assign(panelEl.style, { left: 'auto', right: `calc(100% + ${GAP}px)`, top: `${-bt}px`, bottom: 'auto', width: PANEL_W + 'px', height: `calc(100% + ${bt + bb}px)` });
    }
  }
  function applyLayout() {
    const dialog = activeDialog;
    if (!panelEl || !dialog) return;
    clearTimeout(layoutTimer);
    const open = !!ui.panelOpen;
    if (chipEl) chipEl.setAttribute('aria-expanded', String(open));
    syncFooterButton();
    if (!open) {
      panelEl.style.transition = `opacity ${PANEL_CLOSE_MS}ms ease, transform ${PANEL_CLOSE_MS}ms ease`;
      panelEl.style.opacity = '0';
      panelEl.style.transform = mobileMode ? 'translateY(8px)' : 'translateX(-8px)';
      panelEl.style.pointerEvents = 'none';
      panelEl.setAttribute('aria-hidden', 'true');
      closePreview();
      layoutTimer = setTimeout(() => {
        if (panelEl) panelEl.style.display = 'none';
        restoreDialogShift(dialog);
      }, PANEL_CLOSE_MS + 20);
      return;
    }
    panelEl.style.display = 'flex';
    panelEl.style.transition = 'none';
    panelEl.style.opacity = '0';
    panelEl.style.transform = mobileMode ? 'translateY(8px)' : 'translateX(-8px)';
    panelEl.style.pointerEvents = 'none';
    panelEl.setAttribute('aria-hidden', 'false');
    positionPanel(dialog);
    panelEl.getBoundingClientRect(); // reflow
    layoutTimer = setTimeout(() => {
      if (!panelEl) return;
      panelEl.style.transition = `opacity ${PANEL_EXPAND_MS}ms ease-out, transform ${PANEL_EXPAND_MS}ms cubic-bezier(.16,1,.3,1)`;
      panelEl.style.opacity = '1';
      panelEl.style.transform = 'none';
      panelEl.style.pointerEvents = 'auto';
    }, 24);
  }
  function setPanelOpen(open, tab) {
    ui.panelOpen = !!open;
    if (open && tab) setTab(tab);
    else if (open) setTab(ui.tab);
    applyLayout();
  }

  /* =========================================================
   * 17. 주입 / 정리
   * ======================================================= */
  function mountUI(dialog) {
    injectStyle();
    mobileMode = isBottomSheet(dialog);
    ensureDialogPositioning(dialog);
    if (!panelEl || !panelEl.isConnected) {
      if (panelEl) panelEl.remove();
      panelEl = buildPanel(dialog);
      dialog.appendChild(panelEl); // body 아님: dialog 자식이라 '바깥 클릭'으로 안 닫힘
    }
    mountChip(dialog);
    mountFooterButton(dialog);
    mountInline(dialog);
    setTab(ui.tab);
    applyLayout();
  }
  function startSession(dialog) {
    const ta = getTextarea(dialog);
    if (!ta) return;
    resetVolatileState();
    gmDelete(KEY_APPLIED + getRoomId());
    if (ta.getAttribute('maxlength') !== '99999') {
      ta.removeAttribute('maxlength');
      ta.setAttribute('maxlength', '99999');
    }
    if (ta.getAttribute('data-cunpm-listened') !== '1') {
      ta.setAttribute('data-cunpm-listened', '1');
      ta.addEventListener('input', handleUsernoteInput);
    }
    activeDialog = dialog;
    dialog.setAttribute(PROCESSED, '1');
    window.addEventListener('keydown', onWindowKeydown, true);
    mountUI(dialog);
    renderList();
    renderDrafts();
    refreshCounts();
  }
  function teardownUI() {
    closePreview();
    if (overlayEl) { overlayEl.remove(); overlayEl = null; overlayClose = null; }
    restoreCounter();
    for (const el of [panelEl, chipEl, footerBtnEl, inlineEl, badgeEl]) if (el) el.remove();
    panelEl = chipEl = footerBtnEl = inlineEl = badgeEl = null;
  }
  function handleDialogClose() {
    flushAutoSaveDraft();
    clearTimeout(layoutTimer);
    if (activeDialog) {
      restoreDialogShift(activeDialog);
      activeDialog.removeAttribute(PROCESSED);
    }
    teardownUI();
    window.removeEventListener('keydown', onWindowKeydown, true);
    gmDelete(KEY_APPLIED + getRoomId());
    resetVolatileState();
    activeDialog = null;
  }

  /* =========================================================
   * 18. 감시 (창이 열리고 닫히는 것만 본다)
   * ======================================================= */
  let tickQueued = false;
  function scheduleTick() {
    if (tickQueued) return;
    tickQueued = true;
    requestAnimationFrame(() => { tickQueued = false; tick(); });
  }
  function tick() {
    const dialog = findDialog();
    if (!dialog) {
      if (activeDialog) handleDialogClose();
      return;
    }
    if (dialog !== activeDialog) {
      if (activeDialog) handleDialogClose();
      startSession(dialog);
      return;
    }
    // 크랙이 창 안을 다시 그리면서 우리 요소가 빠졌으면 다시 붙인다(상태는 유지).
    if (!panelEl || !panelEl.isConnected || (chipEl && !chipEl.isConnected) || (!chipEl && findUsernoteTitleElement(dialog))
      || (!mobileMode && footerBtnEl && !footerBtnEl.isConnected) || (!mobileMode && !footerBtnEl && findSubmitButton(dialog))
      || (mobileMode && (!inlineEl || !inlineEl.isConnected))) {
      mountUI(dialog);
    }
  }
  function onResize() {
    const dialog = activeDialog;
    if (!dialog) return;
    const nextMobile = isBottomSheet(dialog);
    if (nextMobile !== mobileMode) {
      // PC↔모바일이 바뀌면 붙이는 자리만 바꾼다(켜 둔 프리셋·AI 결과는 유지).
      teardownUI();
      mountUI(dialog);
      renderList();
      renderDrafts();
      refreshCounts();
      return;
    }
    if (ui.panelOpen) positionPanel(dialog);
  }
  function start() {
    const observer = new MutationObserver(scheduleTick);
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', debounce(onResize, 120));
    window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
    // 모바일 키보드 등으로 뷰포트가 바뀔 때만 모바일 패널 높이 재계산.
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (ui.panelOpen && activeDialog) positionPanel(activeDialog); });
    window.addEventListener('pagehide', flushAutoSaveDraft);
    window.addEventListener('beforeunload', flushAutoSaveDraft);
    scheduleTick();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
